// 在开发服务器页面上执行一段表达式并打印结果，附带本次执行期间的控制台错误
// 用法: node cdp-eval.js <端口> '<表达式>' [等待毫秒]
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 9333);
const EXPRESSION = process.argv[3];
const WAIT = Number(process.argv[4] || 0);

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pageMatch = process.env.DSH_PAGE_MATCH || '20201';
  const page = list.find(item => item.type === 'page' && item.url.includes(pageMatch));
  if (!page) throw new Error('没有找到开发服务器的页面目标');
  const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise(resolve => socket.once('open', resolve));

  let nextId = 1;
  const pending = new Map();
  const logs = [];
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      logs.push(message.params.args.map(item => item.description || item.value).join(' ').slice(0, 300));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      logs.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text);
    }
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

  await send('Runtime.enable');
  const response = await send('Runtime.evaluate', {
    expression: EXPRESSION,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (response.result?.exceptionDetails) {
    console.error('页面抛错:', response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
  } else {
    console.log(JSON.stringify(response.result?.result?.value, null, 1));
  }
  if (WAIT > 0) await new Promise(resolve => setTimeout(resolve, WAIT));
  if (logs.length) console.log('控制台错误:', JSON.stringify(logs.slice(-8), null, 1));
  socket.close();
}

main().then(() => process.exit(0)).catch(error => {
  console.error('执行失败:', error.message);
  process.exit(1);
});
