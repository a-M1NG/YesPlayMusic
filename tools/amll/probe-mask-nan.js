// 触发一次歌词视图重建，观察词元素上的遮罩渐变是否仍含 NaN
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 9333);

const READ = `(() => {
  const line = document.querySelector('.amll-lyric-player .FmKaba_active .FmKaba_lyricLine') || document.querySelector('.amll-lyric-player .FmKaba_active');
  if (!line) return { 结果: '没有活动行' };
  const spans = [...line.querySelectorAll('span')];
  const masked = spans.filter(span => span.style.maskImage || span.style.webkitMaskImage);
  return {
    词元素数: spans.length,
    带遮罩的: masked.length,
    含NaN的: masked.filter(span => (span.style.maskImage || '').includes('NaN')).length,
    首个遮罩: (masked[0] && (masked[0].style.maskImage || masked[0].style.webkitMaskImage) || '').slice(0, 120),
    首个词尺寸: masked[0] ? { clientWidth: masked[0].clientWidth, clientHeight: masked[0].clientHeight, padding: getComputedStyle(masked[0]).paddingLeft } : null,
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
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
    return response.result?.result?.value;
  };
  await send('Runtime.enable');
  console.log('重建前:', JSON.stringify(await evaluate(READ)));
  await evaluate(`(() => {
    const host = document.querySelector('.amll-lyric-player-host');
    const player = host.__vue__.player;
    player.rebuildLyricView(player.getCurrentTime());
    return true;
  })()`);
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('重建后:', JSON.stringify(await evaluate(READ)));
  console.log('全量统计:', JSON.stringify(await evaluate(`(() => {
    const spans = [...document.querySelectorAll('.amll-lyric-player span')].filter(span => span.style.maskImage || span.style.webkitMaskImage);
    return {
      带遮罩词元素: spans.length,
      含NaN: spans.filter(span => (span.style.maskImage || '').includes('NaN')).length,
      有效渐变: spans.filter(span => (span.style.maskImage || '').includes('%') && !(span.style.maskImage || '').includes('NaN')).length,
      样例有效: (spans.find(span => !(span.style.maskImage || '').includes('NaN')) || {}).style?.maskImage?.slice(0, 120) || null,
    };
  })()`)));
  socket.close();
}

main().then(() => process.exit(0)).catch(error => { console.error('失败:', error.message); process.exit(1); });
