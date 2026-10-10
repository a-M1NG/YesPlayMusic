module.exports = async function verifyUI() {
  const assert = require('assert').strict;
  const path = require('path');
  const taskRoot = path.resolve(__dirname, '../..');
  const localFile = name =>
    require('url').pathToFileURL(path.join(taskRoot, '.dev', name)).href;
  const root = document.querySelector('#app').__vue__;
  const store = root.$store;
  const player = store.state.player;
  const win = require('electron').remote.getCurrentWindow();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const results = [];
  win.restore();
  win.show();
  win.focus();
  player._enabled = true;
  player._isPersonalFM = false;
  player._currentTrack = window.__perfTrack || {
    id: 0,
    name: '本地验证',
    dt: 60000,
    ar: [{ id: 0, name: '静音测试' }],
    al: {
      id: 0,
      name: 'Offline fixture',
      picUrl: localFile('fixture-cover.png'),
    },
    pc: null,
    cd: null,
  };
  player._playAudioSource(
    window.__perfAudioSource || localFile('silence.wav'),
    true
  );
  await wait(500);
  await window.__reopenPerfLyrics();
  player.play();
  await wait(500);
  assert.equal(player.playing, true);
  player.seek(25);
  await wait(500);
  assert.ok(player.seek() >= 25);
  results.push('本地音频播放、暂停后恢复与进度跳转正常');
  const before = player.seek();
  const lyrics = root.$children.find(x => x.$options.name === 'Lyrics');
  const parsedLines = lyrics.lyric;
  const renderer = lyrics.$refs.amllLyricPlayer;
  const background = lyrics.$children.find(
    x => x.$options.name === 'AmllBackgroundRender'
  );
  win.minimize();
  await wait(1100);
  assert.equal(root.windowVisible, false);
  assert.equal(document.querySelectorAll('.amll-lyric-player').length, 0);
  assert.equal(
    root.$children.find(x => x.$options.name === 'Lyrics'),
    lyrics
  );
  assert.equal(lyrics.lyric, parsedLines);
  assert.equal(renderer.player, null);
  if (background) assert.equal(background.background, null);
  assert.equal(player.playing, true);
  assert.ok(player.seek() > before);
  results.push('最小化释放渲染器但保留歌词数据，音乐播放继续');
  win.restore();
  win.show();
  win.focus();
  for (let i = 0; i < 20 && !root.windowVisible; i++) await wait(100);
  await wait(500);
  assert.equal(root.windowVisible, true);
  assert.equal(lyrics.lyric, parsedLines);
  assert.notEqual(lyrics.$refs.amllLyricPlayer, renderer);
  await window.__reopenPerfLyrics();
  store.commit('updateSettings', { key: 'lowResourceMode', value: false });
  await wait(500);
  assert.equal(
    document.querySelectorAll('.amll-background-host canvas').length,
    1
  );
  store.commit('updateSettings', { key: 'lowResourceMode', value: true });
  await wait(500);
  assert.equal(
    document.querySelectorAll('.amll-background-host canvas').length,
    0
  );
  results.push('节能模式可切换，动态背景按需创建与销毁');
  store.state.showLyrics = false;
  await wait(500);
  assert.equal(store.state.enableScrolling, true);
  assert.equal(document.querySelectorAll('.amll-lyric-player').length, 0);
  assert.equal(
    root.$children.find(x => x.$options.name === 'Lyrics'),
    lyrics
  );
  assert.equal(lyrics.lyric, parsedLines);
  results.push('关闭歌词恢复页面滚动，保留已解析歌词并销毁渲染器');
  player.pause();
  return results;
};
