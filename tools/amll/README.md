# tools/amll

## 目录用途

存放 AMLL 歌词集成期间使用的性能测量、页面探针、离线验证与服务驱动脚本。脚本内的全部路径都相对本目录（`tools/amll/`）或仓库根解析，可以任意移动仓库位置后继续使用。

与仓库内其它位置的关系：

- `.dev/amll/`：本机开发资源，已由 `.gitignore` 排除，不随仓库分发。语料、Electron 离线压缩包、分析报告、本地构建产物与接口服务临时目录都放在这里；本目录的脚本默认从这里读取输入、向这里写入运行痕迹。克隆仓库后需要自行准备这些文件（语料可用本地接口服务请求 `/lyric/new` 生成，Electron 压缩包可在联网时由 electron-builder 下载后留存）。
- `applemusic-like-lyrics/`：AMLL 源码子模块（锁定 `86200dea`），用于查阅源码与本地构建 core。运行时的依赖是 npm 上的 `@applemusic-like-lyrics/core@0.6.0` 与 `@applemusic-like-lyrics/lyric@1.1.0`，与子模块无关。
- `src/utils/amllLyrics.js`、`src/components/AmllLyricPlayer.vue`：被验证脚本直接读取的被测对象，脚本只读不写。

## 前置条件

- 仓库根已安装依赖（`node_modules/` 内需要 `ws`、`sass`、`postcss`、`vue-template-compiler`、`@applemusic-like-lyrics/lyric`）。
- `.dev/amll/` 下的资源已经存在：`census-lyrics.json` 语料、`electron-cache/` 压缩包。`netease-tmp/` 与 `electron-profile/` 由脚本按需创建。
- 测量打包版需要 Electron 13（Chromium 91）的安装包，`dist_electron/` 下的应用或 `.dev/amll/electron-cache/` 里的压缩包都可以提供。
- 本机 Node 版本为 22。Node 22 下 webpack 4 使用的 Terser 需要 `NODE_OPTIONS=--openssl-legacy-provider`。
- 需要播放页面的脚本都要求先有一个已经打开的调试目标（Electron 探针或打包版应用），并且该页面处于歌词页、已经登录可用状态。

## 脚本一览

| 脚本 | 用途 | 参数 | 用法示例 | 依赖端口 |
| --- | --- | --- | --- | --- |
| `serve-netease-api.js` | 启动增强版网易云接口服务，接口模块从仓库根上一级的 `../netease-bpm/node_modules/@neteasecloudmusicapienhanced/api` 加载，`TMPDIR` 指向 `.dev/amll/netease-tmp` | 无 | `node tools/amll/serve-netease-api.js` | 3000 |
| `serve-embedded-api.js` | 用仓库内的 `@neteaseapireborn/api` 与 `src/ncmModDef.js` 启动内置接口服务，启动前先切换到仓库根 | 无 | `node tools/amll/serve-embedded-api.js` | 10754 |
| `electron-probe-perf.js` | Electron 主进程脚本，把目标页面装进探针窗口：附加 `--mute-audio` 与调试端口 9333，并关闭窗口遮挡降频 | 目标 URL（默认 `http://127.0.0.1:27232`）；环境变量 `DSH_PROBE_USER_DATA` 覆盖用户数据目录 | `npx electron tools/amll/electron-probe-perf.js http://127.0.0.1:20201` | 9333（探针） |
| `cdp-eval.js` | 在页面里求值一段表达式，打印结果与本次执行期间的控制台错误 | 端口、表达式、等待毫秒 | `node tools/amll/cdp-eval.js 9333 'document.title'` | 9333 / 9555 |
| `perf-metrics.js` | 播放期间测量帧时间、长任务、DOM 属性写入、`setProperty` 调用与主线程计数，输出 JSON | 端口、曲目 ID、秒数、弹簧、翻译、背景、歌词页可见 | `node tools/amll/perf-metrics.js 9333 2117962 10 true true false true` | 9333 / 9555 |
| `perf-summarize.js` | 把 `perf-metrics.js` 的 JSON 压缩成一行，便于批量对比 | 从标准输入读取 JSON | `node tools/amll/perf-metrics.js 9333 2117962 10 true true false true \| node tools/amll/perf-summarize.js` | 无 |
| `perf-ab.js` | 在真实播放中按补丁项做 A/B 测量，判断哪一项样式工作占据主线程 | 端口、曲目 ID、秒数、补丁名、弹簧、翻译 | `node tools/amll/perf-ab.js 9333 2117962 10 skip-timevar true true` | 9333 / 9555 |
| `probe-lyric-dom.js` | 打印歌词页的组件数据与 DOM 状态，核对翻译是否进入歌词行 | 端口 | `node tools/amll/probe-lyric-dom.js 9333` | 9333 / 9555 |
| `probe-animations.js` | 统计页面上的词级动画并按标识分组，先设置弹簧开关再等待 2.5 秒采样 | 端口、弹簧 | `node tools/amll/probe-animations.js 9333 true` | 9333 / 9555 |
| `probe-mask-usage.js` | 检查活动行词元素的遮罩内联样式与 `CSS.supports` 结果，确认回退路径是否在被消费 | 端口 | `node tools/amll/probe-mask-usage.js 9333` | 9333 / 9555 |
| `probe-mask-progress.js` | 以 250 毫秒间隔连续采样 6 次带遮罩词元素的计算遮罩位置，判断逐字擦除是否推进（会先把音量置零） | 端口 | `node tools/amll/probe-mask-progress.js 9333` | 9333 / 9555 |
| `probe-mask-computed.js` | 对比词元素遮罩属性的内联值与计算值，确认回退路径在 Chromium 91 上是否生效 | 端口 | `node tools/amll/probe-mask-computed.js 9333` | 9333 / 9555 |
| `probe-mask-nan.js` | 触发一次 `rebuildLyricView`，统计遮罩渐变里是否还含 `NaN` | 端口 | `node tools/amll/probe-mask-nan.js 9333` | 9333 / 9555 |
| `verify-translation-merge.mjs` | 读 `.dev/amll/census-lyrics.json`，核对翻译合并规则的写入行数、受影响曲目与容差窗口 | 无 | `node --experimental-default-type=module tools/amll/verify-translation-merge.mjs` | 无 |
| `verify-controlled-player-time.mjs` | 离线验证 `src/components/AmllLyricPlayer.vue` 的时间推送节流、间奏重算、入位保护与销毁恢复，共 24 项 | 无 | `node tools/amll/verify-controlled-player-time.mjs` | 无 |
| `verify-runtime-effects.js` | 在运行中的页面验证逐字擦除仍在推进，以及暂停后滚动仍会重绘 | 端口、曲目 ID | `node tools/amll/verify-runtime-effects.js 9333 2117962` | 9333 / 9555 |

`verify-translation-merge.mjs` 必须带 `--experimental-default-type=module` 运行：它按 ESM 加载 `src/utils/amllLyrics.js`。

需要连接页面的脚本一律用 `DSH_PAGE_MATCH`（默认 `20201`）在 `/json/list` 的页面目标里挑选页面；探测打包版时把它设为打包版页面 URL 里的一段（例如 `27232`），端口参数写 9555。

## 端口一览

| 端口 | 用途 |
| --- | --- |
| 3000 | 网易云接口服务（`serve-netease-api.js`） |
| 10754 | 内置接口服务（`serve-embedded-api.js`，与应用的 `background.js` 使用同一端口） |
| 20201 | 开发服务器，由 `DEV_SERVER_PORT` 指定，本机 `.env` 里是 20201 |
| 9333 | Electron 探针的调试端口（`electron-probe-perf.js`） |
| 9555 | 打包版调试端口，启动 DMG 里的应用时附加 `--remote-debugging-port=9555` |
| 9222 | 无头 Chrome 调试端口，此前几轮用 headless Chrome 采集时使用 |

## 测量注意事项

- 所有播放都必须静音：探针脚本已经附加 `--mute-audio`，测量脚本还会把 `player.volume` 置零。不要把声音放出来。
- `perf-metrics.js` 会在起播后等待 2.5 秒、播放、再 `seek(45)` 跳过前奏，然后才开始采样；采样前会按参数写入 `amllEnableSpring`、`amllEnableScale`、`amllEnableBlur`、`amllHidePassedLines`、`showLyricsTranslation`、`lyricsBackground`。
- `perf-ab.js` 每次测量前会先还原上一次的补丁与注入样式，并把模糊、缩放开关恢复为开启。可用的补丁名：`baseline`、`skip-timevar`、`cv-visible`、`no-wrapper-filter`、`no-mask-anim`、`no-blur`、`no-scale`、`pause`、`lyrics-hidden`、`no-lyrics`、`throttle2`、`throttle3`、`throttle4`。
- `perf-summarize.js` 从标准输入接收 `perf-metrics.js` 的 JSON，两者用管道连接使用。
- 帧时间测量必须在窗口可见且前台的情况下进行：探针脚本已附加 `--disable-backgrounding-occluded-windows`、`--disable-renderer-backgrounding`、`--disable-background-timer-throttling` 与 `--disable-features=CalculateNativeWinOcclusion`。
- 一次测量只覆盖一首曲目的一段固定区间，跨补丁或跨版本对比时保持曲目、秒数、弹簧、翻译、背景与歌词页可见这几项参数一致。

## 构建 arm64 DMG

```sh
NODE_OPTIONS=--openssl-legacy-provider npx vue-cli-service electron:build -p never -m --arm64
```

- `NODE_OPTIONS=--openssl-legacy-provider`：Node 17 及以上，webpack 4 的压缩环节需要这个开关，否则打包阶段会失败。
- `ELECTRON_CACHE`：可选。electron-builder 默认从 GitHub 下载 Electron 压缩包，网络不通时把已有的压缩包放进任意本地目录，用这个变量指过去即可复用，例如本机放在 `.dev/amll/electron-cache`。
- 产物：`dist_electron/YesPlayMusic-mac-<版本>-arm64.dmg`，版本取自 `package.json` 的 `version`（当前为 0.4.11-beta），同时生成 `.dmg.blockmap`。

## `.dev/amll/` 部件说明

| 部件 | 用途 |
| --- | --- |
| `electron-cache/` | Electron 13.6.9 的离线压缩包（darwin-arm64、darwin-x64）以及解压缓存目录，供 `ELECTRON_CACHE` 复用 |
| `census-lyrics.json` | 1694 首 `/lyric/new` 原始响应语料，`verify-translation-merge.mjs` 的输入 |
| `census-rows.json` | 1694 首的逐首汇总：接口返回码、各字段长度、纯音乐标记与首行摘录 |
| `raw-index.json`、`accept-lyrics.json`、`census-current-logic.json` | 语料索引、验收样本与当前合并逻辑的输出快照 |
| `reports/` | 此前几轮的分析报告（动画、歌词格式、歌词加载、统计表） |
| `build/` | 本地构建产物：`amllLyrics.mjs` 与压缩版 `amll-min.mjs`，都是把 `@applemusic-like-lyrics/lyric` 与 `src/utils/amllLyrics.js` 打成一个模块，导出 `parseNeteaseLyric`、`normalizeNeteaseLyricText`、`getLyricLineContent`、`filterNeteaseLyric` |
| `netease-tmp/` | 两个接口服务脚本使用的 `TMPDIR`，存放 `anonymous_token`、`neapi_key`、`xeapi_public_key` |
| `electron-profile/` | Electron 探针的用户数据目录，首次运行探针脚本时创建 |
