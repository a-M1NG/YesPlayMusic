<template>
  <div class="loading-spinner">
    <div class="ring"></div>
  </div>
</template>

<script>
/**
 * 封面加载动画：半透明遮罩加一个旋转圆环。
 *
 * 遮罩让圆环在任意封面上都能看清，同时压暗底下的旧封面，避免与画面里的
 * 高对比区域混在一起。
 */
export default {
  name: 'LoadingSpinner',
};
</script>

<style lang="scss" scoped>
.loading-spinner {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: inherit;
  background: rgba(0, 0, 0, 0.16);
}

.ring {
  width: 14%;
  height: 14%;
  box-sizing: border-box;
  border: 3px solid rgba(255, 255, 255, 0.28);
  border-top-color: rgba(255, 255, 255, 0.88);
  border-radius: 50%;
  animation: loading-spinner-rotate 0.9s linear infinite;
}

@keyframes loading-spinner-rotate {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}
</style>
