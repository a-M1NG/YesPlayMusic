// 验证逐字擦除仍在推进，并验证暂停期间滚动仍会重绘
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 9333);
const TRACK = Number(process.argv[3] || 2117962);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const SAMPLE = `(() => {
  const player = document.querySelector('.amll-lyric-player');
  const spans = [...document.querySelectorAll('.amll-lyric-player span')].filter(span => span.style.maskPosition || span.style.webkitMaskPosition);
  const sample = spans[0];
  const groups = [...document.querySelectorAll('.amll-lyric-player [class*=lyricLineWrapper]')];
  return {
    时间变量: player.style.getPropertyValue('--amll-player-time'),
    遮罩位置: sample ? getComputedStyle(sample).webkitMaskPosition : null,
    遮罩数: spans.length,
    行位移: groups.slice(0, 4).map(group => group.style.transform),
  };
})()`;

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pageMatch = process.env.DSH_PAGE_MATCH || '20201';
  const page = list.find(item => item.type === 'page' && item.url.includes(pageMatch));
  const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 });
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
  const store = body => evaluate(`(() => { const store = document.querySelector('#app').__vue__.$store; ${body} })()`);

  await send('Runtime.enable');
  await store(`store.state.player.volume = 0; store.state.player.replacePlaylist([${TRACK}], 0, 'playlist'); return true;`);
  await wait(2500);
  await store('store.state.player.volume = 0; store.state.player.play(); return true;');
  await wait(1500);
  await store('store.state.player.seek(60); return true;');
  await wait(1000);

  const first = await evaluate(SAMPLE);
  await wait(800);
  const second = await evaluate(SAMPLE);
  console.log('播放中第一次采样:', JSON.stringify(first));
  console.log('播放中第二次采样:', JSON.stringify(second));
  console.log('遮罩位置是否推进:', first.遮罩位置 !== second.遮罩位置);
  console.log('时间变量是否推进:', first.时间变量 !== second.时间变量);

  // 暂停后滚动，检查位移是否仍然写入 DOM
  await store('store.state.player.pause(); return true;');
  await wait(600);
  const beforeScroll = await evaluate(SAMPLE);
  await evaluate(`(() => {
    const player = document.querySelector('.amll-lyric-player');
    player.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, deltaMode: WheelEvent.DOM_DELTA_PIXEL, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await wait(500);
  const afterScroll = await evaluate(SAMPLE);
  console.log('暂停后滚动前:', JSON.stringify(beforeScroll.行位移));
  console.log('暂停后滚动后:', JSON.stringify(afterScroll.行位移));
  console.log('暂停时滚动是否重绘:', JSON.stringify(beforeScroll.行位移) !== JSON.stringify(afterScroll.行位移));
  await store('store.state.player.pause(); return true;');
  socket.close();
}

main().then(() => process.exit(0)).catch(error => { console.error('失败:', error.message); process.exit(1); });
