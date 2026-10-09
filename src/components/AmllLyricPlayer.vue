<template>
  <div ref="host" class="amll-lyric-player-host" :style="hostStyle"></div>
</template>

<script>
import { LyricPlayer } from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';

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
  data() {
    return {
      player: null,
      frameId: 0,
      lastFrameTime: -1,
      // 入位保护还需要持续的帧数，含义见 holdEnteringLines
      holdFrames: 0,
    };
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
      if (!this.player) return;
      this.player.setLyricLines(lines, this.getCurrentTime());
      // 换歌时所有歌词行都是新建的，入位同样不能带过渡
      this.holdEnteringLines(this.player, true);
      this.player.update(0);
    },
    playing(playing) {
      if (!this.player) return;
      if (playing) this.player.resume();
      else this.player.pause();
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
      // 字号变化不会改变播放组件的尺寸，需要主动重新读取字号并重建视图
      if (!this.player) return;
      this.player.onResize();
      this.rebuildLayout();
    },
    disabled(disabled) {
      if (disabled) {
        this.stopFrameLoop();
        return;
      }
      // 隐藏期间歌词元素尺寸归零，排版窗口会被算到歌曲的其它位置，
      // 重新显示时必须整体重建视图才能回到当前播放的行
      this.rebuildLayout();
      this.startFrameLoop();
    },
  },
  mounted() {
    const player = new LyricPlayer();
    this.player = player;
    this.$refs.host.appendChild(player.getElement());

    player.setAlignAnchor(this.alignAnchor);
    player.setAlignPosition(this.alignPosition);
    player.setEnableSpring(this.enableSpring);
    player.setEnableBlur(this.enableBlur);
    player.setEnableScale(this.enableScale);
    player.setHidePassedLines(this.hidePassedLines);
    player.setWordFadeWidth(this.wordFadeWidth);

    player.addEventListener('line-click', this.handleLineClick);
    player.addEventListener('line-contextmenu', this.handleLineContextMenu);

    player.setLyricLines(this.lines, this.getCurrentTime());
    this.holdEnteringLines(player, true);
    if (this.playing) player.resume();
    else player.pause();

    if (!this.disabled) this.startFrameLoop();
  },
  beforeDestroy() {
    this.stopFrameLoop();
    this.player?.dispose();
    this.player = null;
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
      // 重建会把所有歌词行重新放回页面，入位同样不能带过渡
      this.holdEnteringLines(this.player, true);
      this.player.update(0);
    },
    startFrameLoop() {
      if (this.frameId || !this.player) return;
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
      const delta =
        this.lastFrameTime === -1 ? 0 : frameTime - this.lastFrameTime;
      this.lastFrameTime = frameTime;
      player.setCurrentTime(this.getCurrentTime());
      this.syncPausedInterlude(player);
      this.holdEnteringLines(player);
      player.update(delta);
      this.frameId = requestAnimationFrame(this.handleFrame);
    },
    /**
     * 暂停期间处在某段间奏里时，间奏演出会被锚定在跳转那一刻，
     * 入场延迟要靠媒体时钟推进才能走完，而暂停时媒体时钟不动，
     * 圆点就一直不可见。这里每一帧都把演出区间清掉再按正常播放的排版理由重算，
     * 锚点回到间奏起点，圆点停在播放进度对应的位置。
     *
     * @param {object} player AMLL 歌词播放器实例
     */
    syncPausedInterlude(player) {
      const interlude =
        player.timelineController?.getSnapshot?.().activeInterlude;
      if (this.playing || !interlude) return;
      player.interludeDots.clearInterlude(true);
      player.calcLayout('playback-tick');
    },
    /**
     * 歌词行回到页面上时，位移要等这一帧的样式提交才会写入，
     * 这中间浏览器已经按没有位移的样子算过一次样式，关闭弹簧动画时
     * 用于补位的 transition 会把这次入位当成一次位移过渡，
     * 歌词从容器顶部滑到自己的位置，页面上方因此闪过一行歌词。
     * 这里在歌词行入位以及整体重建后排版还在调整的这几帧里先关掉过渡，
     * 等位置定下来再交还给样式表。
     *
     * @param {object} player AMLL 歌词播放器实例
     * @param {boolean} force 是否重新开始入位保护，用于整体重建这种一次定位全部歌词行的场合
     */
    holdEnteringLines(player, force = false) {
      if (force) this.holdFrames = 3;
      const holding = this.holdFrames > 0;
      if (holding) this.holdFrames -= 1;
      let touched = false;
      for (const group of player.currentLyricGroups) {
        const element = group.element;
        if (!element) continue;
        const needsHold =
          holding || !element.parentElement || !element.style.transform;
        if (needsHold) {
          if (element.style.transition !== 'none') {
            element.style.transition = 'none';
            touched = true;
          }
          continue;
        }
        if (element.style.transition) {
          element.style.transition = '';
          touched = true;
        }
      }
      // 先让浏览器按当前位移算一次样式，交还过渡后起点才会是当前位置
      if (touched && this.$refs.host) this.$refs.host.offsetHeight;
    },
    handleLineClick(event) {
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
