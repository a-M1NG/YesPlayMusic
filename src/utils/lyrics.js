/**
 * @param {string} lyric
 */
export async function copyLyric(lyric) {
  const textToCopy = lyric;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch (err) {
      alert('复制失败，请手动复制！');
    }
  } else {
    const tempInput = document.createElement('textarea');
    tempInput.value = textToCopy;
    tempInput.style.position = 'absolute';
    tempInput.style.left = '-9999px';
    document.body.appendChild(tempInput);
    tempInput.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      alert('复制失败，请手动复制！');
    }
    document.body.removeChild(tempInput);
  }
}
