// 对比词元素上遮罩属性的内联值与计算值，确认回退路径在 Chromium 91 上是否真的生效
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 9333);

const EXPRESSION = `(() => {
  const line = document.querySelector('.amll-lyric-player .FmKaba_active .FmKaba_lyricLine') || document.querySelector('.amll-lyric-player .FmKaba_active');
  if (!line) return { 结果: '没有找到活动歌词行' };
  const spans = [...line.querySelectorAll('span')].filter(span => span.style.maskPosition || span.style.webkitMaskPosition || span.style.maskImage || span.style.webkitMaskImage);
  return spans.slice(0, 3).map(span => {
    const computed = getComputedStyle(span);
    return {
      文本: span.textContent.slice(0, 8),
      内联maskPosition: span.style.maskPosition,
      内联webkitMaskPosition: span.style.webkitMaskPosition,
      内联maskImage: (span.style.maskImage || '').slice(0, 70),
      内联webkitMaskImage: (span.style.webkitMaskImage || '').slice(0, 70),
      计算maskImage: (computed.maskImage || '').slice(0, 70),
      计算webkitMaskImage: (computed.webkitMaskImage || '').slice(0, 70),
      计算webkitMaskPosition: computed.webkitMaskPosition,
      计算maskRepeat: computed.maskRepeat || computed.webkitMaskRepeat,
      计算maskSize: computed.maskSize || computed.webkitMaskSize,
    };
  });
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
