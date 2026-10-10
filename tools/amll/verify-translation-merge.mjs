import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseLrc,
  parseYrc,
} from '../../node_modules/@applemusic-like-lyrics/lyric/dist/amll-lyric.mjs';
import {
  getLyricLineContent,
  normalizeNeteaseLyricText,
  parseNeteaseLyric,
} from '../../src/utils/amllLyrics.js';

// 脚本位于 <仓库根>/tools/amll，向上两级即仓库根，本地资源都相对它定位
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

const wordLevelLinePattern = /^\[\d+,\d+\]\s*\(\d+,\d+,\d+\)/m;

// 复现测试脚本里独立的一遍解析，用来核对主歌词行没有因为合并规则的改动而变化
function parseText(text) {
  const normalized = normalizeNeteaseLyricText(text);
  if (!normalized) return [];
  return wordLevelLinePattern.test(normalized)
    ? parseYrc(normalized)
    : parseLrc(normalized);
}

function baselineMainLines(payload) {
  const wordLevelLines = parseText(payload?.yrc?.lyric);
  const lines = wordLevelLines.length
    ? wordLevelLines
    : parseText(payload?.lrc?.lyric);
  return lines.filter(
    line => getLyricLineContent(line) && line.endTime > line.startTime
  );
}

// 改动前的合并规则与翻译字段来源，用于得到对照数字
function mergeLegacy(lines, auxiliaryLines, field) {
  const pending = new Map();
  for (const auxiliary of auxiliaryLines) {
    const content = getLyricLineContent(auxiliary);
    if (!content) continue;
    const time = Math.round(auxiliary.startTime);
    const queue = pending.get(time);
    if (queue) queue.push(content);
    else pending.set(time, [content]);
  }
  for (const line of lines) {
    const queue = pending.get(Math.round(line.startTime));
    if (!queue?.length) continue;
    line[field] = queue.shift();
  }
}

function auxiliaryContents(payload, source) {
  const text =
    source === 'new'
      ? payload?.ytlrc?.lyric || payload?.tlyric?.lyric
      : payload?.ytlyric?.lyric || payload?.tlyric?.lyric;
  return parseText(text)
    .map(getLyricLineContent)
    .filter(Boolean);
}

const corpus = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, '.dev/amll/census-lyrics.json'), 'utf8')
);

const totals = {
  tracks: 0,
  tracksWithTranslation: 0,
  ytlrcTracks: 0,
  tlyricTracks: 0,
  mainLines: 0,
  mainLineMismatchTracks: [],
  newAux: 0,
  newWritten: 0,
  newUnwritten: 0,
  newAnyUnwrittenTracks: 0,
  newZeroWrittenTracks: 0,
  newEmptyTranslationTracks: 0,
  oldAux: 0,
  oldWritten: 0,
  oldUnwritten: 0,
  oldAnyUnwrittenTracks: 0,
  oldZeroWrittenTracks: 0,
  oldEmptyTranslationTracks: 0,
  legacyUnmatchedGaps: [],
};

const spotChecks = ['2117962', '20036073', '1039333', '28364367', '29414561'];
const spotResults = [];

for (const [id, payload] of Object.entries(corpus)) {
  totals.tracks += 1;
  const lines = parseNeteaseLyric(payload);
  if (!lines.length) continue;

  const baseline = baselineMainLines(payload);
  totals.mainLines += lines.length;
  const sameTimes =
    baseline.length === lines.length &&
    baseline.every((line, index) => line.startTime === lines[index].startTime);
  if (!sameTimes) totals.mainLineMismatchTracks.push(id);

  const newAux = auxiliaryContents(payload, 'new');
  const oldAux = auxiliaryContents(payload, 'legacy');
  if (!newAux.length) {
    totals.newEmptyTranslationTracks += 1;
    continue;
  }
  totals.tracksWithTranslation += 1;
  if (payload?.ytlrc?.lyric) totals.ytlrcTracks += 1;
  else totals.tlyricTracks += 1;

  const newWritten = lines.filter(line => line.translatedLyric).length;
  totals.newAux += newAux.length;
  totals.newWritten += newWritten;
  totals.newUnwritten += newAux.length - newWritten;
  if (newWritten === 0) totals.newZeroWrittenTracks += 1;
  else if (newWritten < newAux.length) totals.newAnyUnwrittenTracks += 1;

  for (const line of lines) line.translatedLyric = '';
  mergeLegacy(lines, parseText(payload?.tlyric?.lyric), 'translatedLyric');
  const oldWritten = lines.filter(line => line.translatedLyric).length;
  totals.oldAux += oldAux.length;
  totals.oldWritten += oldWritten;
  totals.oldUnwritten += oldAux.length - oldWritten;
  if (oldWritten === 0) totals.oldZeroWrittenTracks += 1;
  else if (oldWritten < oldAux.length) totals.oldAnyUnwrittenTracks += 1;
  else totals.oldEmptyTranslationTracks += 1;

  if (spotChecks.includes(id)) {
    spotResults.push({
      id,
      mainLines: lines.length,
      newAux: newAux.length,
      newWritten,
      oldAux: oldAux.length,
      oldWritten,
    });
  }
}

// 改动前未能配上的辅助行，到最近主歌词行的距离分布，用来核对容差上限的取值
for (const payload of Object.values(corpus)) {
  const lines = parseNeteaseLyric(payload);
  if (!lines.length) continue;
  const auxiliaryLines = parseText(payload?.tlyric?.lyric);
  for (const auxiliary of auxiliaryLines) {
    if (!getLyricLineContent(auxiliary)) continue;
    const rounded = Math.round(auxiliary.startTime);
    const hit = lines.some(line => Math.round(line.startTime) === rounded);
    if (hit) continue;
    totals.legacyUnmatchedGaps.push(
      Math.min(...lines.map(line => Math.abs(line.startTime - auxiliary.startTime)))
    );
  }
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const position = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * ratio)
  );
  return sorted[position];
}

const gaps = [...totals.legacyUnmatchedGaps].sort((a, b) => a - b);
const report = {
  语料曲目数: totals.tracks,
  有翻译字段且主歌词非空的曲目数: totals.tracksWithTranslation,
  使用ytlrc的曲目数: totals.ytlrcTracks,
  退回tlyric的曲目数: totals.tlyricTracks,
  主歌词行总数: totals.mainLines,
  主歌词行与独立解析不一致的曲目: totals.mainLineMismatchTracks,
  改动后: {
    翻译行总数: totals.newAux,
    成功写入翻译行数: totals.newWritten,
    未写入翻译行数: totals.newUnwritten,
    部分行未写入的曲目数: totals.newAnyUnwrittenTracks,
    一行都没写入的曲目数: totals.newZeroWrittenTracks,
    受影响曲目数_存在未写入行: totals.newAnyUnwrittenTracks + totals.newZeroWrittenTracks,
  },
  改动前: {
    翻译行总数: totals.oldAux,
    成功写入翻译行数: totals.oldWritten,
    未写入翻译行数: totals.oldUnwritten,
    部分行未写入的曲目数: totals.oldAnyUnwrittenTracks,
    一行都没写入的曲目数: totals.oldZeroWrittenTracks,
    受影响曲目数_存在未写入行: totals.oldAnyUnwrittenTracks + totals.oldZeroWrittenTracks,
  },
  改动前未匹配辅助行的最近主歌词行距离: {
    样本数: gaps.length,
    中位数: percentile(gaps, 0.5),
    p75: percentile(gaps, 0.75),
    p90: percentile(gaps, 0.9),
    p95: percentile(gaps, 0.95),
    超过500ms的条数: gaps.filter(gap => gap > 500).length,
  },
  抽样曲目: spotResults,
  改动后仍未匹配的辅助行: [],
  音译对照: {},
  行为核对: [],
};

// 改动后仍然配不上的辅助行，逐条列出原因相关的数字
for (const [id, payload] of Object.entries(corpus)) {
  const lines = parseNeteaseLyric(payload);
  if (!lines.length) continue;
  const auxiliaryLines = parseText(payload?.ytlrc?.lyric || payload?.tlyric?.lyric);
  const used = new Set();
  for (const line of lines) {
    if (!line.translatedLyric) continue;
    const index = auxiliaryLines.findIndex(
      (auxiliary, position) =>
        !used.has(position) &&
        getLyricLineContent(auxiliary) === line.translatedLyric &&
        Math.abs(auxiliary.startTime - line.startTime) <=
          Math.min((line.endTime - line.startTime) / 2, 500)
    );
    if (index >= 0) used.add(index);
  }
  for (const [position, auxiliary] of auxiliaryLines.entries()) {
    const content = getLyricLineContent(auxiliary);
    if (!content || used.has(position)) continue;
    const nearest = Math.min(
      ...lines.map(line => Math.abs(line.startTime - auxiliary.startTime))
    );
    report.改动后仍未匹配的辅助行.push({
      曲目: id,
      辅助行开始时间: auxiliary.startTime,
      辅助行内容: content,
      最近主歌词行距离: nearest,
    });
  }
}

// 音译沿用原来的字段来源，这里单独核对容差合并没有让它倒退
{
  const roman = {
    有音译字段且主歌词非空的曲目数: 0,
    音译行总数: 0,
    改动后写入行数: 0,
    改动前写入行数: 0,
  };
  for (const payload of Object.values(corpus)) {
    const romanText = payload?.yromalrc?.lyric || payload?.romalrc?.lyric;
    if (!romanText) continue;
    const lines = parseNeteaseLyric(payload);
    if (!lines.length) continue;
    const auxiliaryLines = parseText(romanText);
    const contents = auxiliaryLines.map(getLyricLineContent).filter(Boolean);
    if (!contents.length) continue;
    roman.有音译字段且主歌词非空的曲目数 += 1;
    roman.音译行总数 += contents.length;
    roman.改动后写入行数 += lines.filter(line => line.romanLyric).length;
    for (const line of lines) line.romanLyric = '';
    mergeLegacy(lines, auxiliaryLines, 'romanLyric');
    roman.改动前写入行数 += lines.filter(line => line.romanLyric).length;
  }
  report.音译对照 = roman;
}

// 合成用例核对窗口、顺序与「一条辅助行只用一次」的行为
function synthetic(yrcText, tlyricText) {
  return parseNeteaseLyric({ yrc: { lyric: yrcText }, tlyric: { lyric: tlyricText } })
    .map(line => [line.startTime, line.translatedLyric]);
}

report.行为核对 = [
  {
    用例: '同一时间点多条辅助行按出现顺序取用',
    结果: synthetic(
      '[1000,1000](1000,1000,0)一\n[1000,1000](1000,1000,0)二',
      '[00:01.000]X\n[00:01.000]Y'
    ),
  },
  {
    用例: '窗口内取时间最接近的一条',
    结果: synthetic(
      '[1000,2000](1000,2000,0)主',
      '[00:01.100]近\n[00:01.400]远'
    ),
  },
  {
    用例: '超过主歌词行时长一半的辅助行不写入',
    结果: synthetic(
      '[1000,100](1000,100,0)短',
      '[00:01.300]偏'
    ),
  },
  {
    用例: '窗口上限 500ms 之外的辅助行不写入',
    结果: synthetic(
      '[1000,4000](1000,4000,0)长',
      '[00:01.600]偏'
    ),
  },
];

console.log(JSON.stringify(report, null, 2));
