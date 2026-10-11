<template>
  <div ref="host" class="amll-background-host"></div>
</template>

<script>
import {
  BackgroundRender,
  MeshGradientRenderer,
} from '@applemusic-like-lyrics/core';

/**
 * AMLL 的动态背景组件，把专辑封面渲染成类似 Apple Music 的流动渐变。
 *
 * 背景渲染器自带动画循环，不需要逐帧驱动，只需在播放状态变化时同步暂停与恢复。
 *
 * 换封面时纹理与配色都要在渲染器内部重新计算，直接复用同一个渲染器会让画面跳变。
 * 这里维护两个渲染器：当前显示的那个继续绘制旧封面，新封面交给另一个渲染器在后台
 * 加载，等它就绪之后两张画布做透明度交叉过渡。过渡结束把两个渲染器的角色互换，
 * 上一次显示的渲染器留作下一次的备用实例，因此每次换歌都不会新建 WebGL 上下文。
 */
export default {
  name: 'AmllBackgroundRender',
  props: {
    /** 专辑封面链接 */
    album: {
      type: String,
      default: '',
    },
    /** 是否正在播放，且歌词页面处于可见状态 */
    playing: {
      type: Boolean,
      default: false,
    },
    /** 当前歌曲是否有歌词，渲染器会据此调整动态效果 */
    hasLyric: {
      type: Boolean,
      default: true,
    },
    /** 背景动画帧率 */
    fps: {
      type: Number,
      default: 30,
    },
    /** 背景渲染比例，数值越高越清晰，也越消耗性能 */
    renderScale: {
      type: Number,
      default: 0.5,
    },
  },
  watch: {
    album(album) {
      this.applyAlbum(album);
    },
    playing(playing) {
      // 调用方传入的是播放状态与歌词页可见性的合成结果：画布被隐藏时绘制没有任何意义，
      // 停掉帧循环可以避免无谓的 GPU 提交；重新显示时 resume() 会立即请求下一帧，
      // 所以暂停期间不会漏掉需要重绘的内容
      //
      // 恢复之前必须先把渲染器的时间戳对齐到当前时刻：MeshGradientRenderer 暂停期间
      // 帧循环直接返回，lastFrameTime 停留在暂停前的最后一帧，恢复后第一帧的
      // frameDelta 就等于整段暂停时长，动画相位 frameTime 一次跨过整段空档，流动图案
      // 跳到另一个角度。AMLL 的 IsolationRenderer 在 resume() 里调用 resetFrameClock()
      // 把 lastFrameTime 与 lastTickTime 一起对齐到 performance.now()，这里照同样做法
      // 手动对齐两个时间戳
      if (!this.active) return;
      if (playing) this.resumeRenderer(this.active);
      else this.active.pause();
    },
    hasLyric(hasLyric) {
      this.active?.setHasLyric(hasLyric);
      this.standby?.setHasLyric(hasLyric);
    },
    fps(fps) {
      this.active?.setFPS(fps);
      this.standby?.setFPS(fps);
    },
    renderScale(scale) {
      this.active?.setRenderScale(scale);
      this.standby?.setRenderScale(scale);
    },
  },
  created() {
    // 图形渲染器无需响应式观察，避免 Vue 遍历 WebGL 内部状态。
    this.active = null;
    this.standby = null;
    // 两张画布交叉过渡的时长，单位毫秒，与画布上的 transition 保持一致
    this.crossfadeDuration = 600;
    // 单调递增的请求序号，用于丢弃过期的封面加载结果
    this.albumRequestToken = 0;
    // 正在淡入的渲染器，为空表示没有进行中的过渡；收尾时以它为准，
    // 不去读可能已被新一次换歌改动的 standby
    this.crossfadeTarget = null;
    // 等待上一轮过渡走完的 resolve 列表，换封面要等过渡结束后再动渲染器
    this.crossfadeWaiters = [];
    this.crossfadeTimer = null;
    this.crossfadeFrame = null;
  },
  mounted() {
    this.active = this.createRenderer();
    this.applyAlbum(this.album);
  },
  beforeDestroy() {
    if (this.crossfadeTimer) clearTimeout(this.crossfadeTimer);
    if (this.crossfadeFrame) cancelAnimationFrame(this.crossfadeFrame);
    this.crossfadeTarget = null;
    this.crossfadeTimer = null;
    this.crossfadeFrame = null;
    // 等待中的换封面靠 _isDestroyed 校验退出，这里只负责让它们继续执行
    this.flushCrossfadeWaiters();
    this.active?.dispose();
    this.standby?.dispose();
    this.active = null;
    this.standby = null;
  },
  methods: {
    /** 新建渲染器并挂到宿主节点，尺寸与帧率等设置随创建一起下发 */
    createRenderer() {
      const renderer = BackgroundRender.new(MeshGradientRenderer);
      const element = renderer.getElement();
      // 两个画布绝对定位叠放，正在显示的那个盖在上面
      element.style.position = 'absolute';
      element.style.top = '0';
      element.style.left = '0';
      element.style.zIndex = '1';
      element.style.opacity = '0';
      element.style.transition = 'opacity 0.6s ease';
      this.$refs.host.appendChild(element);

      renderer.setFPS(this.fps);
      renderer.setRenderScale(this.renderScale);
      renderer.setHasLyric(this.hasLyric);
      renderer.pause();
      return renderer;
    },
    /** 惰性创建备用渲染器，避免在没有换过封面时就占用第二个 WebGL 上下文 */
    ensureStandby() {
      if (!this.standby) this.standby = this.createRenderer();
      return this.standby;
    },
    /** 把暂停期间累积的时间空档抹掉，再恢复帧循环 */
    resumeRenderer(renderer) {
      const gl = renderer.getRenderer();
      const now = performance.now();
      gl.lastFrameTime = now;
      gl.lastTickTime = now;
      renderer.resume();
    },
    /** 等到没有进行中的过渡，没有过渡时立即返回 */
    waitForCrossfade() {
      if (!this.crossfadeTarget) return Promise.resolve();
      return new Promise(resolve => {
        this.crossfadeWaiters.push(resolve);
      });
    },
    /** 放行等待中的换封面，resolve 只是微任务，恢复执行时收尾已经同步完成 */
    flushCrossfadeWaiters() {
      const waiters = this.crossfadeWaiters;
      this.crossfadeWaiters = [];
      waiters.forEach(resolve => resolve());
    },
    /**
     * 切换封面。
     *
     * 新封面加载到备用渲染器上，加载完成之前画面一直由当前渲染器绘制旧封面；
     * 被更晚的调用取代的加载结果由 albumRequestToken 丢弃，连点下一曲时只有
     * 最后一次换歌会改变画面。
     */
    async applyAlbum(album) {
      if (!this.active || !album) return;
      // 过渡进行中的两张画布都处于半透明状态，此刻替换任何一张的纹理都会硬切；
      // 等上一轮过渡走完，旧画布已经完全透明并让出角色，再换纹理就不可见
      await this.waitForCrossfade();
      // 等待期间可能被销毁或者又换了一次封面
      if (this._isDestroyed) return;
      const requestToken = ++this.albumRequestToken;
      const incoming = this.ensureStandby();
      // MeshGradientRenderer.setAlbum 内部已经吞掉封面拉取与解码的失败并打印错误，
      // 但拿不到 2D 上下文或者图片尺寸为 0 时仍然会抛出，这个 Promise 因此可能变成
      // rejected：在此记录失败，避免产生未处理的 Promise 拒绝
      try {
        await incoming.setAlbum(album);
      } catch (error) {
        console.debug('[AMLL] background album unavailable', error);
        return;
      }
      // 加载期间可能又换了一次封面，这一次的结果已经过期
      if (this._isDestroyed || requestToken !== this.albumRequestToken) return;
      this.crossfade(incoming);
    },
    /** 承载新封面的渲染器已经就绪，把画面交叉过渡到它 */
    crossfade(incoming) {
      // 备用渲染器一创建就是暂停状态，而 MeshGradientRenderer 在暂停时不会绘制，
      // 直接淡入会先淡出一块空白画布；先恢复帧循环，让它在过渡期间就画出新封面
      this.resumeRenderer(incoming);
      this.crossfadeTarget = incoming;
      incoming.getElement().style.opacity = '1';
      // 让浏览器先把备用画布以透明状态绘制出来，下一帧再改透明度才会产生过渡
      this.crossfadeFrame = requestAnimationFrame(() => {
        this.crossfadeFrame = null;
        if (this._isDestroyed) return;
        this.active.getElement().style.opacity = '0';
        this.crossfadeTimer = setTimeout(() => {
          this.crossfadeTimer = null;
          this.finishCrossfade();
        }, this.crossfadeDuration);
      });
    },
    /** 过渡结束，交换两个渲染器的角色，并让新的可见画布继续绘制 */
    finishCrossfade() {
      if (this.crossfadeTimer) clearTimeout(this.crossfadeTimer);
      if (this.crossfadeFrame) cancelAnimationFrame(this.crossfadeFrame);
      this.crossfadeTimer = null;
      this.crossfadeFrame = null;
      // 没有进行中的过渡时不要互换角色，但等待中的换封面仍然要放行
      if (!this.crossfadeTarget) {
        this.flushCrossfadeWaiters();
        return;
      }
      const outgoing = this.active;
      const incoming = this.crossfadeTarget;
      this.crossfadeTarget = null;
      this.active = incoming;
      this.standby = outgoing;
      incoming.getElement().style.zIndex = '1';
      incoming.getElement().style.opacity = '1';
      outgoing.getElement().style.zIndex = '0';
      outgoing.getElement().style.opacity = '0';
      outgoing.pause();
      // setAlbum 结束时渲染器处于运行状态，收尾时按当前播放状态对齐
      if (this.playing) this.resumeRenderer(incoming);
      else incoming.pause();
      this.flushCrossfadeWaiters();
    },
  },
};
</script>

<style lang="scss" scoped>
.amll-background-host {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  pointer-events: none;

  // 背景画布带有尺寸隔离（contain: strict），没有显式尺寸时高度会塌缩为 0
  ::v-deep canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
}
</style>
