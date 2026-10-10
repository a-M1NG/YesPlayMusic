// 在真实播放中按补丁项做 A/B 测量，用来判断哪一项样式工作占据主线程
// 用法: node perf-ab.js <端口> <曲目ID> <秒数> <补丁名> [弹簧] [翻译]
// 补丁名: baseline | skip-timevar | cv-visible | no-wrapper-filter | no-mask-anim | no-blur | no-scale
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 9333);
const TRACK = Number(process.argv[3] || 2117962);
const SECONDS = Number(process.argv[4] || 10);
const PATCH = process.argv[5] || 'baseline';
const SPRING = (process.argv[6] || 'true') === 'true';
const TRANSLATE = (process.argv[7] || 'true') === 'true';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const PATCHES = {
  baseline: 'true',
  'skip-timevar': `(() => {
    if (window.__abTimeVar) return true;
    const original = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      if (name === '--amll-player-time') return undefined;
      return original.call(this, name, value, priority);
    };
    window.__abTimeVar = original;
    return true;
  })()`,
  'cv-visible': `(() => {
    if (document.getElementById('ab-style')) return true;
    const style = document.createElement('style');
    style.id = 'ab-style';
    style.textContent = '.amll-lyric-player .FmKaba_lyricLine{content-visibility:visible !important;contain-intrinsic-size:auto !important}';
    document.head.appendChild(style);
    return true;
  })()`,
  'no-wrapper-filter': `(() => {
    if (document.getElementById('ab-style')) return true;
    const style = document.createElement('style');
    style.id = 'ab-style';
    style.textContent = '.amll-lyric-player .FmKaba_lyricLineWrapper{transition:opacity .4s, background-color .25s !important;filter:none !important}';
    document.head.appendChild(style);
    return true;
  })()`,
  'no-mask-anim': `(() => {
    if (window.__abAnimate) return true;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (options && typeof options === 'object' && typeof options.id === 'string' && options.id.startsWith('fade-word')) {
        return { id: options.id, play() {}, pause() {}, cancel() {}, finish() {}, set currentTime(value) {}, get currentTime() { return 0; }, get effect() { return null; }, get playState() { return 'paused'; } };
      }
      return original.call(this, keyframes, options);
    };
    window.__abAnimate = original;
    return true;
  })()`,
  'no-blur': `(() => { const host = document.querySelector('.amll-lyric-player-host'); if (host && host.__vue__) host.__vue__.player.setEnableBlur(false); return true; })()`,
  'no-scale': `(() => { const host = document.querySelector('.amll-lyric-player-host'); if (host && host.__vue__) host.__vue__.player.setEnableScale(false); return true; })()`,
  pause: `(() => { const store = document.querySelector('#app').__vue__.$store; store.state.player.pause(); return store.state.player.playing; })()`,
  'lyrics-hidden': `(() => { const store = document.querySelector('#app').__vue__.$store; if (store.state.showLyrics) store.commit('toggleLyrics'); return store.state.showLyrics; })()`,
  'no-lyrics': `(() => { const store = document.querySelector('#app').__vue__.$store; store.state.player.replacePlaylist([35345754], 0, 'playlist'); return true; })()`,
  throttle2: `(() => {
    if (window.__abTimeVar) return true;
    const original = CSSStyleDeclaration.prototype.setProperty;
    let frame = 0;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      if (name === '--amll-player-time') { frame += 1; if (frame % 2 !== 0) return undefined; }
      return original.call(this, name, value, priority);
    };
    window.__abTimeVar = original;
    return true;
  })()`,
  throttle3: `(() => {
    if (window.__abTimeVar) return true;
    const original = CSSStyleDeclaration.prototype.setProperty;
    let frame = 0;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      if (name === '--amll-player-time') { frame += 1; if (frame % 3 !== 0) return undefined; }
      return original.call(this, name, value, priority);
    };
    window.__abTimeVar = original;
    return true;
  })()`,
  throttle4: `(() => {
    if (window.__abTimeVar) return true;
    const original = CSSStyleDeclaration.prototype.setProperty;
    let frame = 0;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      if (name === '--amll-player-time') { frame += 1; if (frame % 4 !== 0) return undefined; }
      return original.call(this, name, value, priority);
    };
    window.__abTimeVar = original;
    return true;
  })()`,
};

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
  // 每次测量前清掉上一次的补丁与样式注入
  await evaluate(`(() => {
    if (window.__abTimeVar) { CSSStyleDeclaration.prototype.setProperty = window.__abTimeVar; window.__abTimeVar = null; }
    if (window.__abAnimate) { Element.prototype.animate = window.__abAnimate; window.__abAnimate = null; }
    const style = document.getElementById('ab-style');
    if (style) style.remove();
    const host = document.querySelector('.amll-lyric-player-host');
    if (host && host.__vue__ && host.__vue__.player) { host.__vue__.player.setEnableBlur(true); host.__vue__.player.setEnableScale(true); }
    return true;
  })()`);

  await storeEval(`
    store.commit('updateSettings', { key: 'amllEnableSpring', value: ${SPRING} });
    store.commit('updateSettings', { key: 'showLyricsTranslation', value: ${TRANSLATE} });
    store.commit('updateSettings', { key: 'lyricsBackground', value: false });
    return true;
  `);
  if (!(await storeEval('return store.state.showLyrics;'))) await storeEval("store.commit('toggleLyrics'); return true;");

  await storeEval(`store.state.player.replacePlaylist([${TRACK}], 0, 'playlist'); store.state.player.volume = 0; return true;`);
  await wait(2500);
  await storeEval('store.state.player.play(); return true;');
  await wait(1200);
  await storeEval('store.state.player.seek(45); return true;');
  await wait(800);

  await evaluate(PATCHES[PATCH] || 'true');
  await wait(600);

  const before = (await send('Performance.getMetrics')).result;
  await evaluate(INSTRUMENT_START);
  await wait(SECONDS * 1000);
  const collected = await evaluate(INSTRUMENT_STOP);
  const after = (await send('Performance.getMetrics')).result;

  const metricsBefore = new Map(before.metrics.map(item => [item.name, item.value]));
  const metricsAfter = new Map(after.metrics.map(item => [item.name, item.value]));
  const delta = name => Number(((metricsAfter.get(name) || 0) - (metricsBefore.get(name) || 0)).toFixed(4));
  const frames = collected.frames.slice(1).sort((a, b) => a - b);
  const percentile = ratio => Number((frames[Math.min(frames.length - 1, Math.floor(frames.length * ratio))] || 0).toFixed(2));
  const timeVarWrites = (collected.setProps.find(item => item[0] === '--amll-player-time') || [null, 0])[1];

  console.log([
    `补丁=${PATCH}`,
    `曲目=${TRACK}`,
    `弹簧=${SPRING ? '开' : '关'}`,
    `帧/秒=${Number((collected.frames.length / SECONDS).toFixed(1))}`,
    `p95=${percentile(0.95)}`,
    `超25ms=${frames.filter(value => value > 25).length}`,
    `样式写入=${collected.mutationsTotal}`,
    `时间变量写入=${PATCH === 'skip-timevar' ? timeVarWrites : timeVarWrites}`,
    `布局=${delta('LayoutCount')}`,
    `样式重算=${delta('RecalcStyleCount')}`,
    `重算耗时=${delta('RecalcStyleDuration')}s`,
    `脚本耗时=${delta('ScriptDuration')}s`,
    `任务耗时=${delta('TaskDuration')}s`,
  ].join('  '));
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
