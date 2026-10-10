// 测量播放期间的帧时间、长任务、DOM 样式写入与浏览器主线程计数
// 用法: node perf-metrics.js <端口> <曲目ID> <秒数> <spring> <translate> <background> <lyricsVisible>
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 9333);
const TRACK = Number(process.argv[3] || 3949384);
const SECONDS = Number(process.argv[4] || 10);
const SPRING = (process.argv[5] || 'true') === 'true';
const TRANSLATE = (process.argv[6] || 'true') === 'true';
const BACKGROUND = process.argv[7] || 'false';
const LYRICS_VISIBLE = (process.argv[8] || 'true') === 'true';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pageMatch = process.env.DSH_PAGE_MATCH || '20201';
  const page = list.find(item => item.type === 'page' && item.url.includes(pageMatch));
  if (!page) throw new Error('没有找到开发服务器的页面目标');
  const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise(resolve => socket.once('open', resolve));

  let nextId = 1;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise(resolve => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
    }
    return result.result?.result?.value;
  };
  const storeEval = body => evaluate(`(() => { const store = document.querySelector('#app').__vue__.$store; ${body} })()`);

  await send('Runtime.enable');
  await send('Performance.enable');

  // 统一设置环境
  await storeEval(`
    store.commit('updateSettings', { key: 'amllEnableSpring', value: ${SPRING} });
    store.commit('updateSettings', { key: 'amllEnableScale', value: true });
    store.commit('updateSettings', { key: 'amllEnableBlur', value: true });
    store.commit('updateSettings', { key: 'amllHidePassedLines', value: false });
    store.commit('updateSettings', { key: 'showLyricsTranslation', value: ${TRANSLATE} });
    store.commit('updateSettings', { key: 'lyricsBackground', value: ${BACKGROUND === 'true' ? 'true' : BACKGROUND === 'false' ? 'false' : JSON.stringify(BACKGROUND)} });
    return true;
  `);

  const lyricsVisible = await storeEval('return store.state.showLyrics;');
  if (lyricsVisible !== LYRICS_VISIBLE) await storeEval("store.commit('toggleLyrics'); return store.state.showLyrics;");

  // 起播并跳到歌词开始之后的位置，跳过前奏
  await storeEval(`store.state.player.replacePlaylist([${TRACK}], 0, 'playlist'); store.state.player.volume = 0; return true;`);
  await wait(2500);
  await storeEval('store.state.player.play(); return true;');
  await wait(1200);
  await storeEval('store.state.player.seek(45); return true;');
  await wait(800);

  const before = (await send('Performance.getMetrics')).result;
  await evaluate(INSTRUMENT_START);
  await wait(SECONDS * 1000);
  const collected = await evaluate(INSTRUMENT_STOP);
  const after = (await send('Performance.getMetrics')).result;

  const pick = (result, names) => {
    const map = new Map(result.metrics.map(item => [item.name, item.value]));
    return Object.fromEntries(names.map(name => [name, map.get(name) ?? null]));
  };
  const names = [
    'LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration',
    'ScriptDuration', 'TaskDuration', 'JSHeapUsedSize', 'Nodes', 'Frames',
  ];
  const beforeMetrics = pick(before, names);
  const afterMetrics = pick(after, names);
  const delta = Object.fromEntries(names.map(name => [name, Number(((afterMetrics[name] ?? 0) - (beforeMetrics[name] ?? 0)).toFixed(4))]));

  const frames = collected.frames.slice(1).sort((a, b) => a - b);
  const percentile = ratio => (frames.length ? frames[Math.min(frames.length - 1, Math.floor(frames.length * ratio))] : 0);
  const longTaskTotal = collected.longTasks.reduce((sum, value) => sum + value, 0);

  console.log(JSON.stringify({
    配置: { 曲目: TRACK, 秒数: SECONDS, 弹簧: SPRING, 翻译: TRANSLATE, 背景: BACKGROUND, 歌词页可见: LYRICS_VISIBLE },
    实际播放状态: await storeEval('return { playing: store.state.player.playing, progress: Math.round(store.state.player.progress), 行数: (document.querySelector(".amll-lyric-player-host")?.__vue__?.player?.getLyricLines?.() || []).length };'),
    帧: {
      总数: collected.frames.length,
      每秒: Number((collected.frames.length / SECONDS).toFixed(1)),
      中位数毫秒: Number(percentile(0.5).toFixed(2)),
      p95毫秒: Number(percentile(0.95).toFixed(2)),
      最大值毫秒: Number((frames[frames.length - 1] || 0).toFixed(2)),
      超过25毫秒帧数: frames.filter(value => value > 25).length,
      超过50毫秒帧数: frames.filter(value => value > 50).length,
    },
    长任务: { 次数: collected.longTasks.length, 总毫秒: Number(longTaskTotal.toFixed(1)), 最长毫秒: Number(Math.max(0, ...collected.longTasks).toFixed(1)) },
    样式写入: { 总数: collected.mutationsTotal, 分类: collected.mutations.slice().sort((a, b) => b[1] - a[1]).slice(0, 8) },
    setProperty: collected.setProps.slice().sort((a, b) => b[1] - a[1]).slice(0, 8),
    主线程计数: delta,
  }, null, 1));
  socket.close();
}

const INSTRUMENT_START = `(() => {
  const state = { frames: [], longTasks: [], mutations: new Map(), setProps: new Map() };
  let last = performance.now();
  let running = true;
  const tick = now => {
    state.frames.push(now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
  });
  try { observer.observe({ entryTypes: ['longtask'] }); } catch (error) { state.longTasks.push(-1); }
  const playerElement = document.querySelector('.amll-lyric-player');
  const mutationObserver = new MutationObserver(records => {
    for (const record of records) {
      if (record.type !== 'attributes') continue;
      const name = record.attributeName;
      state.mutations.set(name, (state.mutations.get(name) || 0) + 1);
    }
  });
  if (playerElement) mutationObserver.observe(playerElement, { attributes: true, childList: true, subtree: true });
  const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
    state.setProps.set(name, (state.setProps.get(name) || 0) + 1);
    return originalSetProperty.call(this, name, value, priority);
  };
  window.__perfStop = () => {
    running = false;
    observer.disconnect();
    mutationObserver.disconnect();
    CSSStyleDeclaration.prototype.setProperty = originalSetProperty;
    const mutations = [...state.mutations.entries()];
    return {
      frames: state.frames,
      longTasks: state.longTasks,
      mutations,
      mutationsTotal: mutations.reduce((sum, item) => sum + item[1], 0),
      setProps: [...state.setProps.entries()],
    };
  };
  return true;
})()`;

const INSTRUMENT_STOP = 'window.__perfStop()';

main().then(() => process.exit(0)).catch(error => {
  console.error('测量失败:', error.message);
  process.exit(1);
});
