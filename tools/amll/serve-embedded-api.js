const fs = require('node:fs');
const path = require('node:path');

// 脚本位于 <仓库根>/tools/amll，向上两级即仓库根
const projectDir = path.resolve(__dirname, '../..');

// 内置接口服务会读取临时目录里的匿名令牌，这里把它放到仓库内的 .dev/amll 下
const tmpDir = path.join(projectDir, '.dev/amll/netease-tmp');
fs.mkdirSync(tmpDir, { recursive: true });
process.env.TMPDIR = tmpDir;

const tokenPath = path.join(tmpDir, 'anonymous_token');
if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', 'utf-8');

process.chdir(projectDir);

const server = require(path.join(projectDir, 'node_modules/@neteaseapireborn/api/server.js'));
const moduleDefs = require(path.join(projectDir, 'src/ncmModDef.js'));

console.log('已注册的路由数量:', moduleDefs.length);
console.log(
  '已注册的歌词路由:',
  moduleDefs.filter(item => item.route.includes('lyric')).map(item => item.route)
);

server
  .serveNcmApi({ port: 10754, host: '127.0.0.1', moduleDefs, checkVersion: false })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
