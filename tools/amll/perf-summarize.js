// 把 perf-metrics.js 的 JSON 输出压缩成一行，便于批量对比
let buffer = '';
process.stdin.on('data', chunk => { buffer += chunk; });
process.stdin.on('end', () => {
  const data = JSON.parse(buffer);
  const row = [
    `曲目=${data.配置.曲目}`,
    `秒=${data.配置.秒数}`,
    `弹簧=${data.配置.弹簧 ? '开' : '关'}`,
    `翻译=${data.配置.翻译 ? '开' : '关'}`,
    `背景=${data.配置.背景}`,
    `歌词页=${data.配置.歌词页可见 ? '显示' : '隐藏'}`,
    `播放=${data.实际播放状态.playing ? '是' : '否'}`,
    `行数=${data.实际播放状态.行数}`,
    `帧/秒=${data.帧.每秒}`,
    `中位=${data.帧.中位数毫秒}`,
    `p95=${data.帧.p95毫秒}`,
    `超25ms=${data.帧.超过25毫秒帧数}`,
    `长任务=${data.长任务.次数}/${data.长任务.总毫秒}ms`,
    `样式写入=${data.样式写入.总数}`,
    `时间变量写入=${(data.setProperty.find(item => item[0] === '--amll-player-time') || [null, 0])[1]}`,
    `布局次数=${data.主线程计数.LayoutCount}`,
    `样式重算=${data.主线程计数.RecalcStyleCount}`,
    `重算耗时=${data.主线程计数.RecalcStyleDuration}s`,
    `脚本耗时=${data.主线程计数.ScriptDuration}s`,
    `任务耗时=${data.主线程计数.TaskDuration}s`,
  ];
  console.log(row.join('  '));
});
