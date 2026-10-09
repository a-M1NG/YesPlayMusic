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
 */
export default {
  name: 'AmllBackgroundRender',
  props: {
    /** 专辑封面链接 */
    album: {
      type: String,
      default: '',
    },
    /** 是否正在播放 */
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
  data() {
    return {
      background: null,
    };
  },
  watch: {
    album(album) {
      this.applyAlbum(album);
    },
    playing(playing) {
      if (!this.background) return;
      if (playing) this.background.resume();
      else this.background.pause();
    },
    hasLyric(hasLyric) {
      this.background?.setHasLyric(hasLyric);
    },
    fps(fps) {
      this.background?.setFPS(fps);
    },
    renderScale(scale) {
      this.background?.setRenderScale(scale);
    },
  },
  mounted() {
    const background = BackgroundRender.new(MeshGradientRenderer);
    this.background = background;
    this.$refs.host.appendChild(background.getElement());

    background.setFPS(this.fps);
    background.setRenderScale(this.renderScale);
    background.setHasLyric(this.hasLyric);
    if (this.playing) background.resume();
    else background.pause();

    this.applyAlbum(this.album);
  },
  beforeDestroy() {
    this.background?.dispose();
    this.background = null;
  },
  methods: {
    applyAlbum(album) {
      if (!this.background || !album) return;
      this.background.setAlbum(album);
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
