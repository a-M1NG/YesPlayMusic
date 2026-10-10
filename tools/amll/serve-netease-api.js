const fs = require('node:fs');
const path = require('node:path');

// 脚本位于 <仓库根>/tools/amll，向上两级即仓库根
const REPO_ROOT = path.resolve(__dirname, '../..');

// 把临时目录放到仓库内的 .dev/amll 下，避免污染系统临时目录
const tmpDir = path.join(REPO_ROOT, '.dev/amll/netease-tmp');
fs.mkdirSync(tmpDir, { recursive: true });
process.env.TMPDIR = tmpDir;

// 接口模块取自仓库根的上一级目录里的 netease-bpm
const apiRoot = path.resolve(
  REPO_ROOT,
  '../netease-bpm/node_modules/@neteasecloudmusicapienhanced/api'
);

// request.js 会在加载时读取这个文件，因此需要先准备好
const anonymousTokenPath = path.join(tmpDir, 'anonymous_token');
if (!fs.existsSync(anonymousTokenPath)) {
  fs.writeFileSync(anonymousTokenPath, '', 'utf-8');
}

const generateConfig = require(path.join(apiRoot, 'generateConfig.js'));
const { serveNcmApi } = require(path.join(apiRoot, 'server.js'));

generateConfig()
  .then(() => serveNcmApi({ port: 3000, host: '127.0.0.1', checkVersion: false }))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
