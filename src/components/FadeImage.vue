<template>
  <div class="fade-image">
    <div
      v-for="(layerStyle, index) in layerStyles"
      :key="index"
      class="fade-image-layer"
      :class="{ 'is-visible': index === visibleLayer }"
      :style="layerStyle"
    >
      <slot :visible="index === visibleLayer" />
    </div>
  </div>
</template>

<script>
/**
 * 交叉渐变图层组件。
 *
 * 内部维护两层绝对定位叠放的图层。新图先由 new Image() 预载，预载完成之前旧
 * 图层一直可见，因此换图过程中不会出现空白或者破图；预载成功后把新图交给另一个
 * 图层并淡入，旧图层在同一帧里淡出，两者交叠出透明度过渡。
 *
 * 新内容一律等上一轮渐变走完再入画：渐变进行中两个图层都处于半透明状态，此时
 * 改写任何一层都等于硬切。被取代的预载与排队中的入画由 pendingSource 比对丢弃，
 * 所以连续换图时画面始终来自一张已经预载完成的图片。
 */
export default {
  name: 'FadeImage',
  props: {
    /** 图片地址，内容变化即触发一次交叉渐变 */
    src: {
      type: String,
      default: '',
    },
    /** 交叉渐变的时长，单位为毫秒 */
    duration: {
      type: Number,
      default: 500,
    },
  },
  data() {
    return {
      // 两个图层各自的 background-image 值，与 visibleLayer 共同决定画面
      layerBackgrounds: ['', ''],
      // 当前可见图层的下标，图层承载的图片都已经预载完成
      visibleLayer: 0,
    };
  },
  computed: {
    layerStyles() {
      return this.layerBackgrounds.map(background => ({
        backgroundImage: background ? `url(${background})` : '',
        transitionDuration: `${this.duration}ms`,
      }));
    },
  },
  watch: {
    src: {
      immediate: true,
      handler(src) {
        this.load(src);
      },
    },
  },
  created() {
    // 本轮渐变的结束时刻，早于它到达的新图一律排队等待
    this.fadeEndTime = 0;
    // 推迟入画的定时器句柄
    this.swapTimer = 0;
  },
  beforeDestroy() {
    this.cancelPendingLoad();
  },
  methods: {
    /** 丢弃上一次的预载与排队中的入画，避免被取代的结果影响画面 */
    cancelPendingLoad() {
      this.pendingSource = '';
      this.pendingImage = null;
      if (this.swapTimer) {
        clearTimeout(this.swapTimer);
        this.swapTimer = 0;
      }
    },
    /**
     * 预载新图片。
     *
     * 正在预载的地址直接返回，那次预载完成即可；其余情况一律先作废上一次预载，
     * 因为上一次预载的目标可能已经不再是当前地址（A→B→A 时 B 仍在进行中），
     * 放任它完成会把画面切到过期的图片上。
     *
     * 新地址已经是可见图层的图片时不需要重新预载，但必须发出 load 事件：调用方
     * 靠这个事件收起加载动画，而两首歌共用一张封面时不会再有第二次预载。
     *
     * 可见图层的图片在渐变结束之后才会被替换，因此这时发出的 load 事件可能早于
     * 画面更新：它代表资源就绪，与入画时机无关。
     */
    load(src) {
      if (!src || src === this.pendingSource) return;
      this.cancelPendingLoad();
      if (this.layerBackgrounds[this.visibleLayer] === src) {
        this.$emit('load', src);
        return;
      }
      this.pendingSource = src;
      const image = new Image();
      this.pendingImage = image;
      image.onload = () => this.handleLoad(image, src);
      image.onerror = () => this.handleError(src);
      image.src = src;
    },
    /**
     * 图片就绪，安排入画。
     *
     * 上一轮渐变还在进行时两个图层都处于半透明状态，此刻把新图写进其中任何一个
     * 都会让画面硬切，所以推迟到本轮渐变结束之后再入画。等待期间保留
     * pendingSource，preload 的早退因此仍然成立，同一地址不会被重复排队。
     */
    handleLoad(image, src) {
      if (this._isDestroyed || this.pendingImage !== image) return;
      // 同一张图不会再来第二次，先释放引用
      this.pendingImage = null;
      const remaining = this.fadeEndTime - Date.now();
      if (remaining > 0) {
        this.swapTimer = setTimeout(() => {
          this.swapTimer = 0;
          this.swapIn(src);
        }, remaining);
        return;
      }
      this.swapIn(src);
    },
    /**
     * 把已经预载完成的图片写进图层。
     *
     * pendingSource 就是这次入画的凭据：等待期间换图会由 cancelPendingLoad 把
     * 它清空，过期的入画在此直接丢弃。
     */
    swapIn(src) {
      if (this._isDestroyed || this.pendingSource !== src) return;
      this.pendingSource = '';
      const nextLayer = this.visibleLayer === 0 ? 1 : 0;
      // 新图先写进尚未显示的图层，等浏览器完成一次绘制之后再切换可见图层，
      // 否则同一个样式批次里元素从无到有，透明度过渡不会触发
      this.$set(this.layerBackgrounds, nextLayer, src);
      this.$nextTick(() => {
        if (this._isDestroyed) return;
        this.visibleLayer = nextLayer;
        // 记下本轮渐变的结束时刻，更早到达的新图要等它走完
        this.fadeEndTime = Date.now() + this.duration;
        // 事件名沿用原生 img 的 load，调用方可以像监听一张图片那样接收就绪通知
        this.$emit('load', src);
      });
    },
    handleError(src) {
      if (this._isDestroyed || this.pendingSource !== src) return;
      this.cancelPendingLoad();
      console.debug('[FadeImage] image unavailable', src);
    },
  },
};
</script>

<style lang="scss" scoped>
.fade-image {
  position: relative;
  width: 100%;
  height: 100%;
}

.fade-image-layer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  opacity: 0;
  transition-property: opacity;
  transition-timing-function: ease;
  // 图层自带尺寸，background-size 直接把图片裁成图层大小
  background-repeat: no-repeat;
  background-position: center;
  background-size: cover;
}

.fade-image-layer.is-visible {
  opacity: 1;
}
</style>
