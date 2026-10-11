<template>
  <div ref="host" class="amll-lyric-player-host" :style="hostStyle"></div>
</template>

<script>
import { LyricPlayer } from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';

/** 播放器写在根元素上的播放进度变量，逐字擦除动画由它驱动 */
const PLAYER_TIME_PROPERTY = '--amll-player-time';

/**
 * 播放进度变量每推进多少帧写一次。
 *
 * Chromium 91 不支持无前缀 mask-image，AMLL 因此退回计算遮罩动画，
 * 把词元素的 mask-position 写成依赖这个变量的 calc 表达式，再每帧往根元素写变量。
 * 它没有注册为自定义属性，值一变整棵歌词子树都要重新计算样式，
 * 实测逐字歌词 8 秒里样式重算耗时 1.19 秒、任务耗时 2.84 秒；
 * 隔一帧写一次同样能看出擦除在推进，开销却降回普通歌词的水平。
 */
const PLAYER_TIME_WRITE_INTERVAL = 2;

/**
 * 鼠标移出歌词区域后多久自动翻回当前歌词行，单位为毫秒。
 *
 * 鼠标已经离开歌词区域，说明用户多半没有在细看歌词，等待时间不必太长。
 */
const MOUSE_LEAVE_RESUME_DELAY_MS = 3000;

/**
 * 最后一次滚动输入之后多久自动翻回当前歌词行，单位为毫秒。
 *
 * 用户可能停在某一行细看歌词，因此这个等待时间要比鼠标离开更长。
 */
const SCROLL_IDLE_RESUME_DELAY_MS = 10000;

/**
 * 位置由 JS 逐帧驱动时，歌词行容器要写的过渡列表。
 *
 * 取容器在关闭弹簧动画时的过渡列表去掉 transform，透明度与模糊的过渡保持原样。
 * 为什么必须去掉 transform，见 holdLineTransitions。
 */
const DIRECT_MOTION_LINE_TRANSITION =
  'opacity 0.4s ease, filter 0.4s ease, background-color 0.25s ease';

/**
 * 位置由 JS 逐帧驱动时，间奏圆点容器要写的过渡列表。
 *
 * 同样取圆点容器在关闭弹簧动画时的过渡列表去掉 transform。圆点容器的透明度由
 * 演出按时间算出、不经过过渡，因此这份列表里没有 opacity。
 */
const DIRECT_MOTION_DOTS_TRANSITION =
  'filter 0.25s, background-color 0.25s, box-shadow 0.25s';

/**
 * 归位补间的时长下限，单位为毫秒。
 *
 * 距离很短时也要让用户看出这是一次平移，不能一闪就到位。
 */
const RETURN_SCROLL_MIN_DURATION_MS = 260;

/**
 * 归位补间的时长上限，单位为毫秒。
 *
 * 距离再远也要在这个时长内走完，否则挡住歌词的时间过长。
 */
const RETURN_SCROLL_MAX_DURATION_MS = 700;

/**
 * 归位补间的基础时长，单位为毫秒。
 *
 * 每像素距离在这个基础之上再折算时长，见 RETURN_SCROLL_DURATION_PER_PX。
 */
const RETURN_SCROLL_BASE_DURATION_MS = 150;

/**
 * 每像素距离折算的时长，单位为毫秒。
 *
 * 滚动得越远需要走的距离越长，时长按这个系数随距离增长。
 */
const RETURN_SCROLL_DURATION_PER_PX = 0.16;

/**
 * 滚动输入监听的选项。
 *
 * 滚动输入监听只登记用户滚动过这个事实，不阻止默认行为；
 * AMLL 自己也在歌词层上听这些事件，声明成 passive 才不会让浏览器
 * 把合成线程上的滚动退回主线程。
 */
const PASSIVE_LISTENER_OPTIONS = { passive: true };

/**
 * 判断歌词行里有没有词级时间信息。
 *
 * 普通歌词每行只解析出一个音节，音节时间与整行时间完全一致；
 * 只要某个音节的时间与所在行不一致，或者一行里拆出多个音节，
 * 擦除动画就需要播放进度变量逐帧驱动。
 *
 * @param {Array} lines AMLL 歌词行数组
 * @returns {boolean} 是否存在词级时间信息
 */
function hasWordLevelLines(lines) {
  for (const line of lines) {
    const words = line?.words;
    if (!words?.length) continue;
    if (words.length > 1) return true;
    if (words[0].startTime !== line.startTime) return true;
    if (words[0].endTime !== line.endTime) return true;
  }
  return false;
}

/**
 * AMLL 歌词播放组件在 Vue 2 下的封装。
 *
 * AMLL 的歌词组件本身与框架无关，只暴露一个元素和一组命令式接口，
 * 官方的 Vue 绑定只支持 Vue 3，因此这里直接封装核心组件。
 *
 * 播放进度不走响应式数据：AMLL 需要逐帧拿到高精度的进度，
 * 让父组件每帧更新一次数据会带动整个视图重新渲染，
 * 因此改为由本组件持有一个逐帧循环，每帧调用 timeSource 取得进度。
 */
export default {
  name: 'AmllLyricPlayer',
  props: {
    /** AMLL 歌词行数组，时间单位为毫秒 */
    lines: {
      type: Array,
      required: true,
    },
    /** 返回当前播放进度（毫秒）的函数 */
    timeSource: {
      type: Function,
      required: true,
    },
    /** 是否正在播放 */
    playing: {
      type: Boolean,
      default: false,
    },
    /** 是否停用组件，停用后不再逐帧更新动画，用于歌词页面被隐藏时省下开销 */
    disabled: {
      type: Boolean,
      default: false,
    },
    /** 歌词页是否处于整页关闭状态，用于区分整页关闭与最小化一类的隐藏 */
    pageClosed: {
      type: Boolean,
      default: false,
    },
    fps: {
      type: Number,
      default: 60,
    },
    /** 目标歌词行的垂直对齐方式 */
    alignAnchor: {
      type: String,
      default: 'center',
    },
    /** 目标歌词行在组件高度上的对齐比例 */
    alignPosition: {
      type: Number,
      default: 0.5,
    },
    /** 是否启用弹簧动画 */
    enableSpring: {
      type: Boolean,
      default: true,
    },
    /** 是否模糊非当前歌词行 */
    enableBlur: {
      type: Boolean,
      default: true,
    },
    /** 是否缩放非当前歌词行 */
    enableScale: {
      type: Boolean,
      default: true,
    },
    /** 是否隐藏已经播放过的歌词行 */
    hidePassedLines: {
      type: Boolean,
      default: false,
    },
    /** 逐字动画的渐变宽度，以歌词字体大小的倍数为单位 */
    wordFadeWidth: {
      type: Number,
      default: 0.5,
    },
    /** 歌词字体大小（像素），为 0 时使用 AMLL 的默认字号 */
    fontSize: {
      type: Number,
      default: 0,
    },
  },
  computed: {
    hostStyle() {
      return this.fontSize > 0
        ? { '--amll-lp-font-size': `${this.fontSize}px` }
        : {};
    },
  },
  watch: {
    lines(lines) {
      // 新一批歌词行会重新定位，上一批歌词的手动滚动状态不再有意义
      this.cleanupManualScroll();
      // 是否逐字只跟这批歌词行有关，在这里算一次缓存下来，逐帧不再查询词元素
      this.lineRevision += 1;
      this.wordLevel = hasWordLevelLines(lines);
      this.lastPushedTime = -1;
      this.lastFrameTime = -1;
      // 让换歌后紧跟着的这一次 update 立刻写入变量，免得它还停在上一批歌词的进度上
      this.playerTimePending = PLAYER_TIME_WRITE_INTERVAL - 1;
      if (!this.player) return;
      this.player.setLyricLines(lines, this.getCurrentTime());
      // 换歌时所有歌词行都是新建的，入位同样不能带过渡
      this.holdLineTransitions(this.player, true);
      this.player.update(0);
      // 没有歌词行时逐帧循环没有任何可以推进的内容
      if (!lines.length) {
        this.stopFrameLoop();
        return;
      }
      if (!this.disabled) this.startFrameLoop();
    },
    playing(playing) {
      if (!this.player) return;
      this.lastFrameTime = -1;
      if (playing) this.player.resume();
      else this.player.pause();
    },
    fps() {
      this.lastFrameTime = -1;
    },
    alignAnchor() {
      this.rebuildLayout();
    },
    alignPosition() {
      this.rebuildLayout();
    },
    enableSpring(enable) {
      this.player?.setEnableSpring(enable);
    },
    enableBlur(enable) {
      this.player?.setEnableBlur(enable);
    },
    enableScale(enable) {
      this.player?.setEnableScale(enable);
    },
    hidePassedLines(hide) {
      this.player?.setHidePassedLines(hide);
    },
    wordFadeWidth(width) {
      this.player?.setWordFadeWidth(width);
    },
    fontSize() {
      // 用户 watcher 的调度序号小于渲染 watcher，直接执行时宿主上的
      // --amll-lp-font-size 还是旧值，要等样式落到 DOM 之后再量字号；
      // 字号变了换行与行高都需要重算，因此这里仍然重建视图。
      this.$nextTick(() => {
        if (!this.player) return;
        this.player.onResize();
        this.rebuildLayout();
      });
    },
    disabled(disabled) {
      if (disabled) {
        // 宿主已经不可见，此时触发排版计算只会照着 0 高度去排，
        // 因此这里只把定时器、手动滚动状态与归位补间清掉，不触发排版计算
        this.cleanupManualScroll();
        // 整页关闭会把宿主置成 display:none，AMLL 会把歌词行高度写成 0 并取消观察，
        // 这种情况下重新启用必须整体重建，否则这些行不会再回到 DOM。
        if (this.pageClosed) this.needsRebuildOnEnable = true;
        this.stopFrameLoop();
        return;
      }
      if (this.needsRebuildOnEnable) {
        this.needsRebuildOnEnable = false;
        this.rebuildLayout();
      } else {
        // 实例与歌词元素都还在，位置由 AMLL 的 ResizeObserver → calcLayout(Resize)
        // 与正常播放路径收敛；整体重建会把弹簧、滚动偏移与实测行高清零，
        // 恢复时看起来像重载。
        this.player?.onResize();
        this.lastFrameTime = -1;
        this.playerTimePending = PLAYER_TIME_WRITE_INTERVAL - 1;
      }
      this.startFrameLoop();
    },
  },
  created() {
    // 以下字段逐帧读写，不能放进 data：
    // Vue 2 会把 data 里的对象整棵遍历并建立 Observer，类实例会被判定为可观察对象，
    // 它自身的可枚举属性连同嵌套数组的元素都会变成访问器属性，
    // 于是逐帧写入多走一层响应式 setter，播放器实例内部也会被一并接管
    this.player = null;
    this.frameId = 0;
    this.lastFrameTime = -1;
    // 入位保护还需要持续的帧数，含义见 holdLineTransitions
    this.holdFrames = 0;
    // 已经被写过内联过渡的容器元素，值为写上去的过渡列表，含义见 holdLineTransitions
    this.heldElements = new Map();
    // 当前这批歌词行是否带词级时间信息，决定播放进度变量要不要写
    this.wordLevel = false;
    // 距离下一次写入播放进度变量还差几次
    this.playerTimePending = 0;
    // 上一次交给播放器的进度，暂停时用它判断进度有没有被拖动
    this.lastPushedTime = -1;
    // 歌词行的批次编号，含义见 syncPausedInterlude
    this.lineRevision = 0;
    // 上一次同步过的暂停间奏组合，含义见 syncPausedInterlude
    this.pausedInterludeKey = '';
    // 被接管的 style 对象与它原本的 setProperty，含义见 installPlayerTimeWrite
    this.playerTimeStyle = null;
    this.playerSetProperty = null;
    // 本次停用是否由整页关闭造成，决定重新启用时要不要整体重建，含义见 disabled watcher
    this.needsRebuildOnEnable = false;
    // 用户是否手动滚动过歌词且尚未恢复自动对齐，含义见 handleScrollInput
    this.manualScrolled = false;
    // 鼠标离开歌词区域后等待自动回归的定时器
    this.mouseLeaveResumeTimer = 0;
    // 最后一次滚动输入之后等待自动回归的定时器
    this.scrollIdleResumeTimer = 0;
    // 正在进行的归位补间，由帧循环逐帧推进，null 表示当前没有归位
    this.returnScroll = null;
  },
  mounted() {
    const player = new LyricPlayer();
    this.player = player;
    this.wordLevel = hasWordLevelLines(this.lines);
    this.$refs.host.appendChild(player.getElement());
    this.installPlayerTimeWrite(player);

    player.setAlignAnchor(this.alignAnchor);
    player.setAlignPosition(this.alignPosition);
    player.setEnableSpring(this.enableSpring);
    player.setEnableBlur(this.enableBlur);
    player.setEnableScale(this.enableScale);
    player.setHidePassedLines(this.hidePassedLines);
    player.setWordFadeWidth(this.wordFadeWidth);

    player.addEventListener('line-click', this.handleLineClick);
    player.addEventListener('line-contextmenu', this.handleLineContextMenu);

    // 滚动输入与指针进出都发生在根元素上。滚动监听必须是 passive，
    // AMLL 自己也要在歌词层上听这些事件，非 passive 会让浏览器把合成线程的滚动改成主线程滚动
    const host = this.$refs.host;
    host.addEventListener(
      'wheel',
      this.handleScrollInput,
      PASSIVE_LISTENER_OPTIONS
    );
    host.addEventListener(
      'touchstart',
      this.handleScrollInput,
      PASSIVE_LISTENER_OPTIONS
    );
    host.addEventListener(
      'touchmove',
      this.handleScrollInput,
      PASSIVE_LISTENER_OPTIONS
    );
    host.addEventListener('mouseenter', this.handleHostMouseEnter);
    host.addEventListener('mouseleave', this.handleHostMouseLeave);

    player.setLyricLines(this.lines, this.getCurrentTime());
    this.holdLineTransitions(player, true);
    if (this.playing) player.resume();
    else player.pause();

    if (!this.disabled) this.startFrameLoop();
  },
  beforeDestroy() {
    const host = this.$refs.host;
    host.removeEventListener('wheel', this.handleScrollInput);
    host.removeEventListener('touchstart', this.handleScrollInput);
    host.removeEventListener('touchmove', this.handleScrollInput);
    host.removeEventListener('mouseenter', this.handleHostMouseEnter);
    host.removeEventListener('mouseleave', this.handleHostMouseLeave);
    this.cleanupManualScroll();
    this.stopFrameLoop();
    this.restorePlayerTimeWrite();
    this.player?.dispose();
    this.player = null;
    // 歌词行元素已随播放器一起销毁，集合不能再留着这些引用
    this.heldElements.clear();
  },
  methods: {
    /** 取得当前的播放进度，单位为毫秒 */
    getCurrentTime() {
      return Math.max(0, Math.round(Number(this.timeSource()) || 0));
    },
    /** 重新构建歌词视图，对齐方式一类的排版选项变更后需要调用 */
    rebuildLayout() {
      if (!this.player) return;
      this.player.rebuildLyricView(this.getCurrentTime());
      // 重建会重新定位全部歌词行，让紧随其后的 update 立刻写入播放进度变量
      this.playerTimePending = PLAYER_TIME_WRITE_INTERVAL - 1;
      // 重建会把所有歌词行重新放回页面，入位同样不能带过渡
      this.holdLineTransitions(this.player, true);
      this.player.update(0);
    },
    startFrameLoop() {
      if (this.frameId || !this.player) return;
      // 停用或没有歌词行时循环推不动任何东西
      if (this.disabled || this.lines.length === 0) return;
      this.lastFrameTime = -1;
      this.frameId = requestAnimationFrame(this.handleFrame);
    },
    stopFrameLoop() {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    },
    handleFrame(frameTime) {
      const player = this.player;
      if (!player) return;
      if (this.disabled || this.lines.length === 0) {
        this.stopFrameLoop();
        return;
      }
      const delta =
        this.lastFrameTime === -1 ? 0 : frameTime - this.lastFrameTime;
      const time = this.getCurrentTime();
      // 滚动交互进行中（惯性滑动阶段也算）与归位补间进行中，位置由 JS 逐帧给出，
      // 这两段时间必须按屏幕刷新率更新：暂停时那套 15 FPS 会把每一步位置都留在画面上，
      // 滚动看着一格一格跳
      const directMotion =
        Boolean(player.scrollEngine?.isInteracting) ||
        this.returnScroll !== null;
      // 高刷新率屏幕也按目标帧率更新；暂停时其余场合保留 15 FPS 响应拖动与滚动。
      const interval = 1000 / (this.playing ? Math.max(1, this.fps) : 15);
      const pausedSeek = !this.playing && time !== this.lastPushedTime;
      if (
        this.lastFrameTime !== -1 &&
        delta < interval - 1 &&
        !pausedSeek &&
        !directMotion
      ) {
        this.frameId = requestAnimationFrame(this.handleFrame);
        return;
      }
      this.lastFrameTime = frameTime;
      const interlude =
        player.timelineController?.getSnapshot?.().activeInterlude;
      // 暂停时媒体时钟不动，进度没有变化就不必再推一次时间
      if (this.playing || interlude || time !== this.lastPushedTime) {
        this.lastPushedTime = time;
        player.setCurrentTime(time);
        this.syncPausedInterlude(player, interlude, time);
      }
      // 归位补间排在这里推进：setCurrentTime 可能触发一次带逐行延迟的播放排版，
      // 补间用的连续滚动排版不带延迟、当帧把位置写死，这一次重算会把上面那些
      // 延迟目标整个覆盖掉，update 写进 DOM 的就是补间位置，不会出现一行按
      // 延迟目标停在旧位置而另一行已经走掉的那一帧。
      const tween = this.returnScroll;
      if (tween) {
        const progress = Math.min(
          1,
          (frameTime - tween.startedAt) / tween.duration
        );
        const eased = progress * progress * (3 - 2 * progress);
        player.scrollEngine.offset = tween.offset * (1 - eased);
        player.calcLayout('continuous-scroll');
        if (progress >= 1) this.returnScroll = null;
      }
      // update 必须逐帧调用：滚动、窗口尺寸变化引起的排版都由它写进 DOM。
      // 暂停期间跳过它会让歌词列表不再响应拖动。
      this.holdLineTransitions(player);
      player.update(delta);
      this.frameId = requestAnimationFrame(this.handleFrame);
    },
    /**
     * 暂停期间处在某段间奏里时，间奏演出会被锚定在跳转那一刻，
     * 入场延迟要靠媒体时钟推进才能走完，而暂停时媒体时钟不动，
     * 圆点就一直不可见。这里把演出区间清掉再按正常播放的排版理由重算，
     * 锚点回到间奏起点，圆点停在播放进度对应的位置。
     *
     * 重算会让整棵子树重新排版，因此只在曲目、暂停时的进度与间奏区间
     * 组成的组合发生变化时做一次，而不是逐帧重复。恢复播放时把记录清空，
     * 这样下一次暂停进入间奏还能重新同步一次。
     *
     * @param {object} player AMLL 歌词播放器实例
     * @param {object} interlude 当前生效的间奏区间，可能为空
     * @param {number} time 当前播放进度（毫秒）
     */
    syncPausedInterlude(player, interlude, time) {
      if (this.playing || !interlude) {
        this.pausedInterludeKey = '';
        return;
      }
      const key = [
        this.lineRevision,
        time,
        interlude.startTime,
        interlude.endTime,
      ].join('|');
      if (key === this.pausedInterludeKey) return;
      this.pausedInterludeKey = key;
      player.interludeDots.clearInterlude(true);
      player.calcLayout('playback-tick');
    },
    /**
     * 接管播放器根元素上的播放进度变量写入。
     *
     * Chromium 91 缺少无前缀 mask-image，AMLL 走计算遮罩动画这条回退路径，
     * 由播放器每帧往根元素写 `--amll-player-time`，词元素的 mask-position
     * 再按这个变量做 calc。它不是注册过的自定义属性，每写一次都会让
     * 播放器整棵子树重新计算样式，实测逐字歌词 8 秒里样式重算耗时 1.19 秒，
     * 普通歌词没有任何元素消费它，这笔开销纯属浪费。
     *
     * 因此只拦截这一个属性：普通歌词整帧跳过写入，逐字歌词按帧节流。
     *
     * @param {object} player AMLL 歌词播放器实例
     */
    installPlayerTimeWrite(player) {
      const style = player.getElement().style;
      const setProperty = style.setProperty;
      this.playerTimeStyle = style;
      this.playerSetProperty = setProperty;
      const owner = this;
      Object.defineProperty(style, 'setProperty', {
        // configurable 让销毁时能删掉这个自有属性，原型上的方法随即重新可见，
        // writable 保持原型方法原本可写的语义
        configurable: true,
        writable: true,
        value(property, value, priority) {
          if (property === PLAYER_TIME_PROPERTY) {
            if (!owner.wordLevel) return;
            owner.playerTimePending += 1;
            if (owner.playerTimePending < PLAYER_TIME_WRITE_INTERVAL) return;
            // 计数涨到写入间隔就归零，暂停期间不再被调用，也不会一直累积
            owner.playerTimePending = 0;
          }
          return setProperty.call(style, property, value, priority);
        },
      });
    },
    /** 删除接管时定义在 style 实例上的属性，恢复播放器原本的写入行为 */
    restorePlayerTimeWrite() {
      const style = this.playerTimeStyle;
      if (style && this.playerSetProperty) delete style.setProperty;
      this.playerTimeStyle = null;
      this.playerSetProperty = null;
    },
    /**
     * 位置不该由样式表的过渡承担时，给容器写一份去掉 transform 的过渡列表。
     *
     * 两种情况需要这样做：
     *
     * 1. 歌词行刚回到页面上。它的位移要等这一帧的样式提交才会写入，这中间浏览器
     *    已经按没有位移的样子算过一次样式，样式表里的 `transform` 过渡会把这次
     *    入位当成一次位移过渡，歌词行从容器顶部滑到自己的位置，页面上方因此闪过
     *    一行歌词。
     * 2. 位置正由 JS 逐帧驱动：滚动交互进行中（惯性滑动阶段也算），或者归位补间
     *    进行中。关闭弹簧动画时样式表给歌词行容器与圆点容器挂了 `transform 0.5s`，
     *    位置一帧改写一次，这条过渡就一帧重启一次，渲染出来的位置因此落后 JS 记录
     *    的位置约一秒的距离。AMLL 判断一行该不该留在 DOM 里用的正是 JS 位置
     *    （`isInRenderRange` → `hide()` 直接摘掉元素），滞后会让行在画面里被移出
     *    DOM，重新进入范围时又一步跳到终点、压在还没走完的邻行上。
     *
     * 保护窗口结束后只剩被写过过渡的元素需要收尾，用集合记住它们即可，
     * 不必再遍历全部歌词行。
     *
     * @param {object} player AMLL 歌词播放器实例
     * @param {boolean} force 是否重新开始入位保护，用于整体重建这种一次定位全部歌词行的场合
     */
    holdLineTransitions(player, force = false) {
      if (force) {
        this.holdFrames = 3;
        // 整体重建会把旧的歌词行元素整批丢弃，集合里留下的引用再也回不来
        this.heldElements.clear();
      }
      const directMotion =
        Boolean(player.scrollEngine?.isInteracting) ||
        this.returnScroll !== null;
      const holding = this.holdFrames > 0 || directMotion;
      if (this.holdFrames > 0) this.holdFrames -= 1;
      const held = this.heldElements;
      if (!holding && held.size === 0) return;
      let written = null;
      const hold = (element, transition) => {
        if (element.style.transition !== transition) {
          element.style.transition = transition;
          if (element.isConnected) written = element;
        }
        held.set(element, transition);
      };
      const release = element => {
        if (element.style.transition) {
          element.style.transition = '';
          if (element.isConnected) written = element;
        }
        held.delete(element);
      };
      const apply = (element, transition) => {
        const needsHold =
          holding || !element.parentElement || !element.style.transform;
        if (needsHold) hold(element, transition);
        else release(element);
      };
      if (holding) {
        for (const group of player.currentLyricGroups) {
          if (group.element) {
            apply(group.element, DIRECT_MOTION_LINE_TRANSITION);
          }
        }
        // 圆点容器与歌词行容器共用同一条样式表规则，滚动时位置同样要跟住内容
        const dotsElement = player.interludeDots?.getElement?.();
        if (dotsElement) apply(dotsElement, DIRECT_MOTION_DOTS_TRANSITION);
      } else {
        // 只处理写过的元素；删掉元素不会影响本次遍历的其余条目
        for (const [element, transition] of held) apply(element, transition);
      }
      // 先让浏览器按当前位移算一次样式，交还过渡后起点才会是当前位置。
      // 读发生写入的那个元素本身即可，读宿主元素会把整棵歌词子树连带算进来
      if (written) written.offsetHeight;
    },
    handleLineClick(event) {
      // 点击歌词行会触发 Seek，AMLL 自己会回到当前行，这里的手动滚动状态随即失效
      this.cleanupManualScroll();
      const payload = {
        lineIndex: event.lineIndex,
        line: event.line.getLine(),
      };
      // 双击会先触发两次 click，第二次的 detail 为 2
      this.$emit(event.detail >= 2 ? 'line-dblclick' : 'line-click', payload);
    },
    handleLineContextMenu(event) {
      // 由使用方弹出自带的菜单，因此这里不再显示浏览器默认菜单
      event.preventDefault();
      this.$emit('line-contextmenu', {
        lineIndex: event.lineIndex,
        line: event.line.getLine(),
        nativeEvent: event,
      });
    },
    /**
     * 滚轮或触摸滑动时登记手动滚动，并重置滚动静止定时器。
     *
     * AMLL 只在当前播放行发生变化、该行仍在渲染范围内、且滚动结束已超过
     * 500 毫秒时才恢复自动对齐，用户滚得太远就再也回不到正在播放的那一行，
     * 因此这里自己安排一次回归。
     */
    handleScrollInput() {
      // 用户重新滚动，正在进行的归位补间到此为止
      const returning = this.returnScroll !== null;
      this.cancelReturnScroll();
      // 补间期间焦点已经切回当前播放行、挂起标记也被清掉，用户重新滚动要把它设回来，
      // 免得播放换行时视图自己走掉。滚轮路径 AMLL 自己会设，触摸路径要等移动超过
      // 10 像素才设，这里补上
      if (returning) this.player.scrollState.isAutoAlignSuspended = true;
      // 滚动输入发生说明指针已经落在歌词区域里，鼠标离开的倒计时不再成立
      this.clearMouseLeaveResumeTimer();
      this.manualScrolled = true;
      this.clearScrollIdleResumeTimer();
      this.scrollIdleResumeTimer = window.setTimeout(
        this.handleScrollIdleResumeTimer,
        SCROLL_IDLE_RESUME_DELAY_MS
      );
    },
    /** 指针进入歌词区域说明用户可能正在看歌词，取消鼠标离开后的回归 */
    handleHostMouseEnter() {
      this.clearMouseLeaveResumeTimer();
    },
    /** 指针离开歌词区域后开始倒计时，超时仍没有回来就翻回当前行 */
    handleHostMouseLeave() {
      this.clearMouseLeaveResumeTimer();
      if (!this.manualScrolled) return;
      this.mouseLeaveResumeTimer = window.setTimeout(
        this.handleMouseLeaveResumeTimer,
        MOUSE_LEAVE_RESUME_DELAY_MS
      );
    },
    /** 鼠标离开歌词区域已超过等待时长，回到当前播放行 */
    handleMouseLeaveResumeTimer() {
      this.mouseLeaveResumeTimer = 0;
      this.resumeAutoAlign();
    },
    /** 最后一次滚动输入之后已超过等待时长，回到当前播放行 */
    handleScrollIdleResumeTimer() {
      this.scrollIdleResumeTimer = 0;
      this.resumeAutoAlign();
    },
    /**
     * 把视图翻回正在播放的那一行。
     *
     * 用户滚动留下的偏移量记在滚动引擎上，AMLL 的排版再按这个偏移把整层歌词
     * 一起平移，因此归位就是把这个偏移补间回零。排版理由取连续滚动，
     * 它关掉逐行延迟并让每行的位置当帧落到算出的值上，全部歌词行拿到的是
     * 同一个纵向平移量，行与行之间不会错位，两种弹簧模式也走同一条路径。
     */
    resumeAutoAlign() {
      this.clearMouseLeaveResumeTimer();
      this.clearScrollIdleResumeTimer();
      if (!this.manualScrolled) return;
      this.manualScrolled = false;
      if (!this.player || this.lines.length === 0) return;
      // 用户滚了又滚回原位，没有可走的距离，不必重算排版
      if (Math.abs(this.player.scrollEngine.offset) < 1) return;
      this.startReturnScroll();
    },
    /**
     * 开始一次归位补间。
     *
     * 偏移量每减一像素整层歌词就下移一像素，补到零歌词行就回到当前播放行。
     * 补间的起点由归位后的落位反推：先按目标排版算一次落位，它与当前落位的
     * 差值就是视图此刻的偏移。这两次排版计算之间不调用 update，结果没有写进 DOM，
     * 画面仍然停在原处。
     *
     * 补间只在这里建立状态，逐帧推进交给帧循环（见 handleFrame）：独立注册的
     * 帧回调与帧循环的先后次序不确定，排在帧循环之后时那一帧写进 DOM 的会是
     * 播放排版的逐行延迟目标，交给帧循环推进才能保证每帧先算补间再写 DOM。
     */
    startReturnScroll() {
      const player = this.player;
      const scrollEngine = player?.scrollEngine;
      const index = player?.timelineController?.getSnapshot?.().scrollToIndex;
      const group = player?.currentLyricGroups?.[index];
      if (!scrollEngine || !group) {
        this.player.resetScroll();
        this.player.calcLayout('playback-tick');
        return;
      }
      const startY = group.posY.getCurrentPosition();
      player.resetScroll();
      player.calcLayout('continuous-scroll');
      const endY = group.posY.getCurrentPosition();
      const startOffset = endY - startY;
      if (Math.abs(startOffset) < 1) return;
      // 按反推出的偏移重写一次，起点与画面上的位置一致
      scrollEngine.offset = startOffset;
      player.calcLayout('continuous-scroll');
      this.returnScroll = {
        offset: startOffset,
        startedAt: performance.now(),
        duration: Math.min(
          RETURN_SCROLL_MAX_DURATION_MS,
          Math.max(
            RETURN_SCROLL_MIN_DURATION_MS,
            RETURN_SCROLL_BASE_DURATION_MS +
              Math.abs(startOffset) * RETURN_SCROLL_DURATION_PER_PX
          )
        ),
      };
    },
    /**
     * 取消正在进行的归位补间。
     *
     * 偏移留在取消时的位置上，AMLL 接着这个偏移处理后续的滚动输入，画面不会回跳。
     */
    cancelReturnScroll() {
      this.returnScroll = null;
    },
    /**
     * 清掉两个等待定时器并复位手动滚动标记。
     *
     * 歌词批次更新、点击歌词行跳转、歌词页隐藏、组件销毁这些时机下，手动滚动状态
     * 都已经失效，正在进行的归位补间也要停下；补间被打断时视图停在半路，
     * 此时把滚动偏移交回自动归位。resetScroll 只改滚动状态与挂起标记、不做排版计算，
     * 宿主不可见时调用也安全。
     */
    cleanupManualScroll() {
      const returning = this.returnScroll !== null;
      this.clearMouseLeaveResumeTimer();
      this.clearScrollIdleResumeTimer();
      this.cancelReturnScroll();
      if (returning) this.player?.resetScroll();
      this.manualScrolled = false;
    },
    clearMouseLeaveResumeTimer() {
      if (!this.mouseLeaveResumeTimer) return;
      clearTimeout(this.mouseLeaveResumeTimer);
      this.mouseLeaveResumeTimer = 0;
    },
    clearScrollIdleResumeTimer() {
      if (!this.scrollIdleResumeTimer) return;
      clearTimeout(this.scrollIdleResumeTimer);
      this.scrollIdleResumeTimer = 0;
    },
  },
};
</script>

<style lang="scss" scoped>
.amll-lyric-player-host {
  width: 100%;
  height: 100%;

  ::v-deep .amll-lyric-player {
    // AMLL 默认把歌词层以叠加混合的方式压在动态背景上，
    // 这里改用普通混合并跟随主题文字颜色，让歌词在任意背景与主题下都清晰可读
    mix-blend-mode: normal;
    --amll-lp-color: var(--color-text);

    // 非当前行的默认外观只做模糊，明度与当前行一样，当前行因此不够突出。
    // 这里把非当前行一并压暗，当前行保持全亮。
    // 过渡必须声明在不区分当前行的选择器上：写在非当前行那一侧会让进入当前行时
    // 没有透明度过渡，并且会把 AMLL 自己的遮罩变量过渡整条替换掉，
    // 于是退出当前行时明暗瞬间跌落，行与行之间的切换显得生硬
    [class*='lyricLine']:not([class*='Wrapper']) {
      transition: box-shadow 0.25s, opacity 0.4s ease-out,
        --bright-mask-alpha var(--mask-alpha-duration, 0.45s) ease-out,
        --dark-mask-alpha var(--mask-alpha-duration, 0.45s) ease-out;

      &:not([class*='active']) {
        opacity: 0.35;
      }
    }

    // 关闭弹簧动画后，AMLL 改用 transition 播放歌词行的缩放与位移，
    // 上面那份过渡列表里没有 transform，会把这一份过渡整条顶替掉，
    // 暂停与恢复时的缩放因此失去过渡直接跳变，这里按该模式补全
    &[class*='disableSpring'] [class*='lyricLine']:not([class*='Wrapper']) {
      transition: box-shadow 0.25s, opacity 0.4s ease-out, filter 0.25s,
        transform 0.5s, background-color 0.25s,
        --bright-mask-alpha var(--mask-alpha-duration, 0.45s) ease-out,
        --dark-mask-alpha var(--mask-alpha-duration, 0.45s) ease-out;
    }

    // 缩放作用在主行上（见 AMLL core 的补丁），上面那份过渡盖不到主行，
    // 关闭弹簧动画时主行的缩放会一步跳到位，这里按同样的时长补上
    &[class*='disableSpring'] [class*='lyricMainLine'] {
      transition: transform 0.5s;
    }

    // 同一个模式的兜底过渡会把歌词组的过渡整条替换成不含 opacity 的一份，
    // 当前行的明暗变化因此瞬间完成，逐行歌词的行间切换显得生硬，
    // 这里补回透明度与模糊的过渡，同时保留位移的过渡
    &[class*='disableSpring'] [class*='lyricLineWrapper'] {
      transition: opacity 0.4s ease, filter 0.4s ease,
        background-color 0.25s ease, transform 0.5s;
    }
  }
}
</style>
