# Windows 资源优化

本次修改针对切歌后音频 Blob 累积、启动时读取整个音频缓存，以及歌词页隐藏后的资源保留。播放器使用的 Electron 版本与音质设置保持原样。

## 行为变化

- 音频 URL 清理由遍历数组下标改为遍历 URL，旧 Blob 能够释放。下一首预缓存仅检查缓存索引并写磁盘，不创建预播 Blob。
- 缓存大小通过 IndexedDB 游标逐条统计，避免 `toArray()` 同时读入全部音频。同歌曲并发下载合并，覆盖缓存扣除旧大小；并发清理避免重复删除，清空缓存等待提交并阻止旧下载写回。
- 歌词页首次打开才创建数据组件。关闭、隐藏或最小化时只销毁歌词与背景渲染器，保留当前曲目的解析结果、翻译类型和配色；恢复后根据播放进度重建渲染器，同一首歌不再请求歌词或重算配色。隐藏期间切歌只失效旧结果，恢复时加载新歌，旧响应不能写回。
- Electron 13 在 Win11 上的 `document.hidden` 在最小化及恢复后都可能不准确，因此 Windows 使用原生窗口事件经 IPC 判断可见性；macOS 和网页继续结合页面可见性。
- 移除歌词组件销毁后的键盘和全屏监听，图形渲染器与只读歌词数据不进行 Vue 深层观察，页面缓存最多保留三个组件。
- 播放进度独立保存，跳过重复状态赋值；缓存音频不再额外预取三种尺寸的封面。歌曲详情按主键查询缓存，并复用同一个网络请求，避免缓存未命中时重复请求。
- 节能模式默认关闭，保留背景、模糊与弹簧的原设置，播放时歌词最高 60 FPS、暂停时最高 15 FPS。用户主动开启节能模式后，播放最高 30 FPS，并关闭非当前行模糊及动态背景。音质不变。

## 验证

6 项真实 Blob/IndexedDB 检查、24 项歌词播放器回归、9 项歌词数据生命周期及跨平台可见性逻辑检查通过，修改文件通过 ESLint。连续创建 40 次音频后仅当前 Blob 可访问，39 个旧 URL 均失效。

本次源码完成 Windows 渲染/主进程生产构建，实际 Electron 13 窗口验证了播放、暂停后恢复、跳转进度、最小化后继续播放、数据组件及解析结果保留、旧渲染器 dispose、恢复时新渲染器创建、节能模式切换、关闭后恢复页面滚动。开关歌词五轮后只有一个数据组件和一个当前渲染器；隐藏时歌词及背景画布数量均为零。

在线账号歌曲播放、macOS 和 Linux 运行时没有验证。接口不可用时的日志不作为播放成功证据。

## 本机测量

以下为本次修订后的同机单次离线样本。原版为 v0.4.11 的原始打包代码，使用相同 Electron 13.6.9 探针、1440×840 窗口、独立用户目录、60 秒静音 WAV、120 行逐字歌词，各状态采样 8 秒。探针关闭窗口遮挡降频以避免测量受前台应用影响，此开关不加入产品。

原版与新版默认设置均保留 AMLL 背景、模糊、缩放和弹簧。新版另外限制歌词播放更新为最高 60 FPS、暂停更新为 15 FPS；因此第一组比较分离了关闭特效的作用，但仍包含帧率策略的作用，并非仅音频 Blob 修复的收益。节能模式单列，不能混作默认优化结果。

| 逐字歌词播放 | 原版 | 新版默认，特效保留 | 主动开启节能模式 |
| --- | ---: | ---: | ---: |
| 应用进程私有提交内存总和 | 565.3 MiB | 534.3 MiB | 460.4 MiB |
| 渲染主线程活动时间 / 8 秒 | 5.828 秒 | 4.370 秒 | 3.359 秒 |
| 渲染脚本执行时间 / 8 秒 | 0.459 秒 | 0.279 秒 | 0.164 秒 |
| 样式重算时间 / 8 秒 | 1.829 秒 | 0.995 秒 | 0.567 秒 |

私有提交内存和任务管理器默认内存列不同，进程工作集总和还包含共享页。这是单次离线样本，真实曲目、缓存、FLAC、窗口大小与显卡可能改变结果，不能保证所有场景都降到固定内存。原始 JSON 保存于被忽略的 `.dev/reports/`，不作为源码提交。

## 重复验证

安装仓库依赖后，歌词离线回归可直接运行：

```powershell
node tools/amll/verify-controlled-player-time.mjs
node tools/optimization/verify-lyrics-lifecycle.cjs
```

其余验证使用 Electron 内的真实浏览器 API。先按仓库流程构建桌面应用，再通过独立用户目录启动探针：

```powershell
node_modules\.bin\electron.cmd tools/optimization/app-probe.cjs optimized
```

在另一个 PowerShell 窗口中运行：

```powershell
$env:DSH_PAGE_MATCH = '27232'
$taskRoot = (Get-Location).Path.Replace('\', '/')
node tools/amll/cdp-eval.js 9333 "require('$taskRoot/tools/optimization/verify-resource-fixes.cjs')('$taskRoot')"
node tools/optimization/measure-app.cjs optimized
node tools/amll/cdp-eval.js 9333 "require('$taskRoot/tools/optimization/verify-ui.cjs')()"
```

测量脚本自动生成静音 WAV 和封面，测试数据库与探针配置均独立于用户数据。UI 验证依赖前一步测量创建的歌词 fixture，运行后结束探针即可。

原版 A/B 探针还需要将原版 `app.asar` 解包到 `.dev/original-source/`，然后将探针与测量参数改为 `original`。为避免媒体结束时切到下一首，UI 脚本会重新装载静音 fixture。

另用新的独立探针配置运行 `node tools/optimization/measure-app.cjs optimized --energy-saving` 测量主动开启节能模式；输出文件区分该组与默认设置。只验证窗口行为时可加 `--fixture-only`，跳过性能采样。

macOS/Linux 合并前建议手动确认：播放中开关歌词页、最小化/隐藏再恢复，音乐继续播放、当前歌词正确、背景按原设置恢复；暂停后重复该流程，再测试拖动歌词、跳转进度与全屏。逻辑测试中的 macOS/Web 分支并不替代这些实机检查。
