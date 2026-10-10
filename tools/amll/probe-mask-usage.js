// 检查当前行词元素的遮罩内联样式，确认回退路径是否在被消费
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 9333);

const EXPRESSION = `(() => {
  const active = document.querySelector('.amll-lyric-player .FmKaba_active .FmKaba_lyricLine');
  const line = active || document.querySelector('.amll-lyric-player .FmKaba_active');
  if (!line) return { 结果: '没有找到活动歌词行' };
  const spans = [...line.querySelectorAll('span')];
  const withMask = spans.filter(span => span.style.maskPosition || span.style.webkitMaskPosition || span.style.maskImage || span.style.webkitMaskImage);
  const sample = withMask.slice(0, 2).map(span => ({
    文本: span.textContent.slice(0, 8),
    maskPosition: span.style.maskPosition || span.style.webkitMaskPosition || '',
    maskImage: (span.style.maskImage || span.style.webkitMaskImage || '').slice(0, 90),
  }));
  const player = document.querySelector('.amll-lyric-player');
  return {
    活动行词元素数: spans.length,
    带遮罩样式的词元素数: withMask.length,
    样例: sample,
    播放器上的时间变量: player.style.getPropertyValue('--amll-player-time'),
    maskImage受支持: CSS.supports('mask-image', 'none'),
    webkitMaskImage受支持: CSS.supports('-webkit-mask-image', 'none'),
  };
})()`;

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(item => item.type === 'page' && item.url.includes('20201'));
  const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(resolve => socket.once('open', resolve));
  let nextId = 1;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const send = (method, params = {}) =>
    new Promise(resolve => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send('Runtime.enable');
  const response = await send('Runtime.evaluate', { expression: EXPRESSION, returnByValue: true, awaitPromise: true, userGesture: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  console.log(JSON.stringify(response.result?.result?.value, null, 1));
  socket.close();
}

main().then(() => process.exit(0)).catch(error => { console.error('失败:', error.message); process.exit(1); });
