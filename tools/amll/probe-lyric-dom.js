// 打印当前歌词页的数据与 DOM 状态，用于核对翻译是否进入歌词行
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 9333);

const EXPRESSION = `(() => {
  const host = document.querySelector('.amll-lyric-player-host');
  const component = host && host.__vue__;
  const lines = (component && component.$props && component.$props.lines) || [];
  const withTranslation = lines.filter(line => line.translatedLyric).length;
  const withRoman = lines.filter(line => line.romanLyric).length;
  const subLines = [...document.querySelectorAll('.amll-lyric-player .FmKaba_lyricSubLine')];
  const subLinesWithText = subLines.filter(element => element.textContent.trim()).length;
  const store = document.querySelector('#app').__vue__.$store;
  return {
    曲目: store.state.player.currentTrack && store.state.player.currentTrack.name,
    翻译开关: store.state.settings.showLyricsTranslation,
    歌词行总数: lines.length,
    带翻译的行数: withTranslation,
    带音译的行数: withRoman,
    前五行: lines.slice(0, 5).map(line => ({
      原文: (line.words || []).map(word => word.word).join('').slice(0, 24),
      翻译: line.translatedLyric,
    })),
    已挂载翻译元素数: subLines.length,
    其中非空: subLinesWithText,
  };
})()`;

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pageMatch = process.env.DSH_PAGE_MATCH || '20201';
  const page = list.find(item => item.type === 'page' && item.url.includes(pageMatch));
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
