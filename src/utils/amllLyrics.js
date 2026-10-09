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
 * 按开始时间把翻译、音译歌词合并到主歌词行上。
 *
 * 同一时间可能出现多行歌词（例如开头的制作人员名单），
 * 因此每个时间点维护一个队列，按出现的先后顺序依次取用。
 *
 * @param {import('@applemusic-like-lyrics/core').LyricLine[]} lines 主歌词行
 * @param {import('@applemusic-like-lyrics/core').LyricLine[]} auxiliaryLines 辅助歌词行
 * @param {'translatedLyric' | 'romanLyric'} field 要写入的字段
 */
function mergeAuxiliaryLines(lines, auxiliaryLines, field) {
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
    parseLyricText(payload?.ytlyric?.lyric || payload?.tlyric?.lyric),
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
