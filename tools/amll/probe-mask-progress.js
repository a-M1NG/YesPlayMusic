// 统计所有带遮罩词元素的计算遮罩位置，用于确认逐字擦除确实在推进
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 9333);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const SAMPLE = `(() => {
  const spans = [...document.querySelectorAll('.amll-lyric-player span')].filter(span => span.style.maskPosition || span.style.webkitMaskPosition);
  const positions = spans.map(span => getComputedStyle(span).webkitMaskPosition);
  const inMotion = positions.filter(value => value !== '0px 0px' && value !== 'none');
  return {
    遮罩数: spans.length,
    位置非零数: inMotion.length,
    位置样例: inMotion.slice(0, 6),
    时间变量: document.querySelector('.amll-lyric-player').style.getPropertyValue('--amll-player-time'),
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
  await send('Runtime.enable');
  const store = body => evaluate(`(() => { const store = document.querySelector('#app').__vue__.$store; ${body} })()`);
  await store('store.state.player.volume = 0; if (!store.state.player.playing) store.state.player.play(); return true;');

  const samples = [];
  for (let index = 0; index < 6; index += 1) {
    samples.push(await evaluate(SAMPLE));
    await wait(250);
  }
  for (const sample of samples) console.log(JSON.stringify(sample));
  const changed = new Set(samples.map(sample => sample.位置样例.join(','))).size;
  console.log('不同遮罩位置组合数:', changed, changed > 1 ? '（推进中）' : '（未推进）');
  socket.close();
}

main().then(() => process.exit(0)).catch(error => { console.error('失败:', error.message); process.exit(1); });
