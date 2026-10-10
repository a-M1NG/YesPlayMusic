# Windows 资源优化

本次修改针对切歌后音频 Blob 累积、启动时读取整个音频缓存，以及歌词页隐藏后的资源保留。播放器使用的 Electron 版本与音质设置保持原样。

## 行为变化

- 音频 URL 清理由遍历数组下标改为遍历 URL，旧 Blob 能够释放。下一首预缓存仅检查缓存索引并写磁盘，不创建预播 Blob。
- 缓存大小通过 IndexedDB 游标逐条统计，避免 `toArray()` 同时读入全部音频。同歌曲并发下载合并，覆盖缓存扣除旧大小；并发清理避免重复删除，清空缓存等待提交并阻止旧下载写回。
- 歌词页关闭、窗口隐藏或最小化时销毁歌词与背景渲染器；重新显示后根据当前播放进度恢复。Electron 13 在 Win11 上有时仍报告最小化窗口的 `document.hidden === false`，因此原生窗口事件通过 IPC 补充可见性。
- 移除歌词组件销毁后的键盘和全屏监听，图形渲染器与只读歌词数据不进行 Vue 深层观察，页面缓存最多保留三个组件。
- 播放进度独立保存，跳过重复状态赋值；缓存音频不再额外预取三种尺寸的封面。歌曲详情按主键查询缓存，并复用同一个网络请求。
- 新增默认开启、可在设置关闭的节能模式：歌词最高 30 FPS，暂停时最高 15 FPS，关闭非当前行模糊及动态背景。关闭节能模式可恢复背景和模糊，播放时歌词最高 60 FPS。音质不变。

## 验证

6 项真实 Blob/IndexedDB 检查与 24 项歌词回归检查通过，修改文件通过 ESLint。连续创建 40 次音频后仅当前 Blob 可访问，39 个旧 URL 均失效。实际 Windows EXE 已验证播放、暂停后恢复、跳转进度、最小化后继续播放并释放歌词、恢复窗口、节能模式切换及背景画布销毁。开关歌词五轮后仅有一个当前实例，关闭后歌词和背景画布数量为零。

在线账号歌曲播放、macOS 和 Linux 运行时没有验证。接口不可用时的日志不作为播放成功证据。

## 本机测量

原版为 v0.4.11 Release 中内部版本仍为 0.4.10 的免安装包；测量时的本地优化包内部版本为 `0.4.11-optimized.1`。两者直接运行 EXE，使用同一 Electron 13.6.9、1440×840 窗口、独立用户目录、60 秒本地静音 WAV 和 120 行逐字歌词，各状态采样 8 秒。原版开启 AMLL 背景，优化包开启节能模式，数据包含资源管理修复和特效调整的共同效果。

| 逐字歌词播放 | 原版 | 优化包 | 变化 |
| --- | ---: | ---: | ---: |
| 应用进程私有提交内存总和 | 553.2 MiB | 438.2 MiB | -20.8% |
| 应用进程工作集总和 | 575.2 MiB | 515.8 MiB | -10.3% |
| 渲染主线程活动时间 / 8 秒 | 6.076 秒 | 3.442 秒 | -43.4% |
| 渲染脚本执行时间 / 8 秒 | 0.465 秒 | 0.176 秒 | -62.2% |
| 样式重算时间 / 8 秒 | 1.878 秒 | 0.577 秒 | -69.3% |

首次启动空闲工作集分别约为 365.5 和 346.7 MiB。私有提交内存、工作集和任务管理器默认内存列不同；工作集总和包含共享页。这是单次离线样本，真实曲目、缓存、FLAC、窗口大小与显卡可能改变结果，不能保证所有场景都降到固定内存。原始数据见 `windows-performance-results.json`。

## 重复验证

安装仓库依赖后，歌词离线回归可直接运行：

```powershell
node tools/amll/verify-controlled-player-time.mjs
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
