// 统计当前页面上的词级动画，并按弹簧开关对比
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 9333);
const SPRING = (process.argv[3] || 'true') === 'true';

const COUNT_EXPRESSION = `(() => {
  const animations = document.getAnimations ? document.getAnimations() : [];
  const groups = {};
  for (const animation of animations) {
    const id = (animation.id || '(无)').replace(/-.*$/, '');
    groups[id] = (groups[id] || 0) + 1;
  }
  const playerElement = document.querySelector('.amll-lyric-player');
  const active = document.querySelector('.amll-lyric-player .FmKaba_active');
  const store = document.querySelector('#app').__vue__.$store;
  return {
    弹簧设置: store.state.settings.amllEnableSpring,
    播放器带disableSpring: Boolean(playerElement && playerElement.className.includes('disableSpring')),
    动画总数: animations.length,
    按标识分组: groups,
    当前行动画: active ? active.getAnimations({ subtree: true }).map(a => a.id).slice(0, 8) : [],
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
  const store = body => `(() => { const store = document.querySelector('#app').__vue__.$store; ${body} })()`;
  await evaluate(store(`store.commit('updateSettings', { key: 'amllEnableSpring', value: ${SPRING} }); return true;`));
  await new Promise(resolve => setTimeout(resolve, 2500));
  console.log(JSON.stringify(await evaluate(COUNT_EXPRESSION), null, 1));
  socket.close();
}

main().then(() => process.exit(0)).catch(error => { console.error('失败:', error.message); process.exit(1); });
