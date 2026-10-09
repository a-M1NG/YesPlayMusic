import { parseLrc, parseYrc } from '@applemusic-like-lyrics/lyric';

/**
 * 网易云音乐的逐词歌词（YRC）每行都以 `[开始时间,时长](开始时间,时长,保留)` 开头，
 * `]` 与 `(` 之间偶尔夹着空格；翻译与音译有时沿用这种写法，有时是普通的 LRC，
 * 因此需要按行首格式判断交给哪个解析器。
 */
const wordLevelLinePattern = /^\[\d+,\d+\]\s*\(\d+,\d+,\d+\)/m;

/**
 * LRC 时间戳，支持 `[mm:ss]`、`[mm:ss.xx]`、`[mm:ss.xxx]` 与 `[mm:ss:xx]` 写法。
 * 网易云音乐历史上把毫秒分隔符写成冒号，`[00:20:97]` 表示 20.970 秒。
 * `[00:00.00-1]` 这类带尾随数字的标签不是合法时间戳，匹配不上。
 */
const lrcTimestampSource = String.raw`\[\d+:\d+(?:[.:]\d+)*\]`;
const lrcTimestampPattern = new RegExp(`^(?:${lrcTimestampSource})+`, 'm');

/**
 * `/lyric/new` 把制作人员行换成裸 JSON 富文本，
 * 形如 `{"t":开始毫秒,"c":[{"tx":"文本","li":"链接","or":"链接"},...]}`，
 * `c` 里所有 `tx` 依次拼接就是纯文本内容；没有时间的行写成 `{"c":[...]}`，
 * 行首还可能已经带有 LRC 时间戳前缀。正则先行判定行的形状，判定通过后 JSON.parse 不会失败。
 */
const richTextElementSource = String.raw`\{"tx":"(?:[^"\\]|\\.)*"(?:,"[A-Za-z_][A-Za-z0-9_]*":"(?:[^"\\]|\\.)*")*\}`;
const richTextLinePattern = new RegExp(
  String.raw`^(?:${lrcTimestampSource})?\{"(?:t":-?\d+(?:\.\d+)?,")?c":\[${richTextElementSource}(?:,${richTextElementSource})*\]\}$`
);

/**
 * 毫秒转换为 LRC 时间戳。毫秒写成三位小数，`t` 的精度不会被截断。
 *
 * @param {number} milliseconds 毫秒
 * @returns {string} 形如 `[01:52.421]` 的时间戳
 */
function formatLrcTimestamp(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const fraction = String(milliseconds % 1000).padStart(3, '0');
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return `[${minutes}:${rest}.${fraction}]`;
}

/**
 * 把网易云音乐歌词接口返回的歌词文本规范化为纯 LRC 或纯 YRC。
 *
 * 富文本行还原成与所在文本同格式的普通行，时间取 JSON 的 `t`，
 * 时长只由紧随其后的下一条富文本行决定，之后没有富文本行时沿用上一条
 * 已算出的时长。制作人员行集中在歌曲开头与结尾，让时长延伸到下一句
 * 歌词的开始会把整段前奏并进这一行，前奏的间奏区间随之消失，
 * 歌词组件便不再演出间奏点。
 *
 * `t` 缺失或为负数的富文本行丢弃，不带时间戳的普通行同样丢弃，
 * 否则 `parseLrc` 会让它们沿用上一行的时间戳，变成重复出现的歌词行。
 *
 * @param {string} text 接口返回的歌词文本
 * @returns {string} 规范化后的歌词文本
 */
export function normalizeNeteaseLyricText(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const wordLevel = wordLevelLinePattern.test(text);
  const timedLinePattern = wordLevel
    ? wordLevelLinePattern
    : lrcTimestampPattern;

  // 富文本行先统一解析出来，`t` 不是非负整数的整行丢弃
  const richTextLines = new Map();
  for (const [index, line] of lines.entries()) {
    if (!richTextLinePattern.test(line)) continue;
    richTextLines.set(index, null);
    const parsed = JSON.parse(line.replace(lrcTimestampPattern, ''));
    if (!Number.isInteger(parsed.t) || parsed.t < 0) continue;
    richTextLines.set(index, {
      time: parsed.t,
      content: parsed.c.map(item => item.tx).join(''),
    });
  }

  const richTextEntries = [...richTextLines.entries()]
    .filter(([, value]) => value !== null)
    .map(([index, value]) => ({ index, time: value.time }));

  const output = [];
  let previousDuration = 1000;
  for (const [index, line] of lines.entries()) {
    if (richTextLines.has(index)) {
      const richText = richTextLines.get(index);
      if (!richText) continue;
      const next = richTextEntries.find(entry => entry.index > index);
      const delta = next === undefined ? 0 : next.time - richText.time;
      const duration = delta > 0 ? delta : previousDuration;
      previousDuration = duration;
      output.push(
        wordLevel
          ? `[${richText.time},${duration}](${richText.time},${duration},0)${richText.content}`
          : `${formatLrcTimestamp(richText.time)}${richText.content}`
      );
      continue;
    }
    if (timedLinePattern.test(line)) output.push(line);
  }
  return output.join('\n');
}

/**
 * 解析歌词文本。逐词歌词交给 parseYrc，其余 LRC 家族的格式交给 parseLrc。
 *
 * @param {string} text 歌词文本
 * @returns {import('@applemusic-like-lyrics/core').LyricLine[]} 歌词行
 */
function parseLyricText(text) {
  const normalized = normalizeNeteaseLyricText(text);
  if (!normalized) return [];
  return wordLevelLinePattern.test(normalized)
    ? parseYrc(normalized)
    : parseLrc(normalized);
}

/**
 * 取出一行歌词的完整文本
 *
 * @param {import('@applemusic-like-lyrics/core').LyricLine} line 歌词行
 * @returns {string} 歌词内容
 */
export function getLyricLineContent(line) {
  return line.words
    .map(word => word.word)
    .join('')
    .trim();
}

/**
 * 翻译、音译歌词与主歌词来自接口的不同字段，两者的时间轴只在部分行上完全相等：
 * 语料里开始时间与主歌词行不等的辅助行时间差中位数 244ms、p75 470ms、p90 810ms，
 * 取 500ms 作为上限既能配上绝大多数同一句歌词，又不会够到相邻的一句。
 * 容差同时不得超过主歌词行时长的一半，否则一句短歌词会越过自己的结束时间
 * 去取下一句的翻译，因此实际窗口取两者中较小的值。
 */
const maximumAuxiliaryMatchGap = 500;

/**
 * 按开始时间把翻译、音译歌词合并到主歌词行上。
 *
 * 两边的开始时间都不完全相等，所以按时间顺序为每条主歌词行挑选窗口内时间最接近的辅助行。
 * 主歌词行按开始时间升序处理，辅助行同样排序后用另一个游标推进：
 * 落在「主歌词行开始时间减去容差上限」之前的辅助行配不上当前行，也配不上开始时间更晚的行，
 * 可以直接跳过，不必为每条主歌词行从头扫描。
 *
 * 同一时间可能出现多行歌词（例如开头的制作人员名单），这些行的距离相同，
 * 取距离时用严格小于比较，因此保留先出现的那条，按出现顺序依次取用。
 * 一条辅助行只能写入一条主歌词行，写入后从候选里移除。
 *
 * @param {import('@applemusic-like-lyrics/core').LyricLine[]} lines 主歌词行
 * @param {import('@applemusic-like-lyrics/core').LyricLine[]} auxiliaryLines 辅助歌词行
 * @param {'translatedLyric' | 'romanLyric'} field 要写入的字段
 */
function mergeAuxiliaryLines(lines, auxiliaryLines, field) {
  const candidates = [];
  for (const auxiliary of auxiliaryLines) {
    const content = getLyricLineContent(auxiliary);
    if (!content) continue;
    candidates.push({ content, time: auxiliary.startTime });
  }
  // Array.prototype.sort 是稳定排序，同一时间的辅助行保持接口下发的先后顺序
  candidates.sort((a, b) => a.time - b.time);
  const orderedLines = [...lines].sort((a, b) => a.startTime - b.startTime);

  let cursor = 0;
  for (const line of orderedLines) {
    const gap = Math.min(
      (line.endTime - line.startTime) / 2,
      maximumAuxiliaryMatchGap
    );
    while (
      cursor < candidates.length &&
      candidates[cursor].time < line.startTime - maximumAuxiliaryMatchGap
    ) {
      cursor += 1;
    }
    let best = -1;
    for (let index = cursor; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate.time > line.startTime + gap) break;
      if (candidate.time < line.startTime - gap) continue;
      if (
        best === -1 ||
        Math.abs(candidate.time - line.startTime) <
          Math.abs(candidates[best].time - line.startTime)
      ) {
        best = index;
      }
    }
    if (best === -1) continue;
    line[field] = candidates[best].content;
    candidates.splice(best, 1);
  }
}

/**
 * 把网易云音乐歌词接口返回的数据转换为 AMLL 的歌词行。
 *
 * 有逐词歌词时以逐词歌词为准，它同时给出每行与每个词的精确时间；
 * 翻译与音译优先取随逐词歌词一起下发的字段，没有时退回普通歌词的字段。
 *
 * @param {object} payload 网易云音乐 `/lyric/new` 接口的返回值
 * @returns {import('@applemusic-like-lyrics/core').LyricLine[]} 歌词行
 */
export function parseNeteaseLyric(payload) {
  const wordLevelLines = parseLyricText(payload?.yrc?.lyric);
  const lines = wordLevelLines.length
    ? wordLevelLines
    : parseLyricText(payload?.lrc?.lyric);

  // 逐词歌词会把开头的制作人员名单压缩成零时长的行，这类行没有任何可以显示的时间
  const usableLines = lines.filter(
    line => getLyricLineContent(line) && line.endTime > line.startTime
  );

  mergeAuxiliaryLines(
    usableLines,
    parseLyricText(payload?.ytlrc?.lyric || payload?.tlyric?.lyric),
    'translatedLyric'
  );
  mergeAuxiliaryLines(
    usableLines,
    parseLyricText(payload?.yromalrc?.lyric || payload?.romalrc?.lyric),
    'romanLyric'
  );

  return usableLines;
}

const emptyCreditPattern = /^作(词|曲)\s*(:|：)\s*无$/;
const creditPattern = /^作(词|曲)\s*(:|：)\s*/;
const pureMusicHint = '纯音乐，请欣赏';

/**
 * 沿用 YesPlayMusic 原有的制作人员名单处理规则。
 *
 * 先去掉内容为「无」的作词、作曲行；当歌词很短且带有纯音乐提示时，
 * 再去掉与歌手同名的作词、作曲行，此时如果只剩下纯音乐提示，则视为没有歌词。
 *
 * @param {import('@applemusic-like-lyrics/core').LyricLine[]} lines 歌词行
 * @param {string} artistName 歌手名称
 * @returns {import('@applemusic-like-lyrics/core').LyricLine[]} 处理后的歌词行
 */
export function filterNeteaseLyric(lines, artistName) {
  const withoutEmptyCredit = lines.filter(
    line => !emptyCreditPattern.test(getLyricLineContent(line))
  );
  const contents = withoutEmptyCredit.map(getLyricLineContent);
  if (withoutEmptyCredit.length > 10 || !contents.includes(pureMusicHint)) {
    return withoutEmptyCredit;
  }
  const withoutArtistCredit = withoutEmptyCredit.filter(line => {
    const content = getLyricLineContent(line);
    const matched = content.match(creditPattern);
    return !matched || content.replace(matched[0], '') !== artistName;
  });
  return withoutArtistCredit.length === 1 ? [] : withoutArtistCredit;
}
