// 验证保留歌词数据时的请求去重、切歌竞态与隐藏计时器，无网络依赖。
const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;
const { parseComponent } = require('vue-template-compiler');
const root = path.resolve(__dirname, '../..');
const script = parseComponent(
  fs.readFileSync(path.join(root, 'src/views/lyrics.vue'), 'utf8')
).script.content;
const body = script
  .replace(/^import[\s\S]*?;\s*/gm, '')
  .replace('export default', 'return');
const settle = () => new Promise(resolve => setImmediate(resolve));
const results = [];
function fixture({
  active = true,
  deferred = false,
  empty = false,
  clock = false,
  fail = false,
} = {}) {
  const requests = [];
  let colors = 0;
  const events = new Set();
  const env = {
    mapState: () => ({}),
    mapMutations: () => ({}),
    mapActions: () => ({}),
    VueSlider: {},
    ButtonIcon: {},
    ContextMenu: {},
    AmllLyricPlayer: {},
    AmllBackgroundRender: {},
    document: {
      fullscreenElement: null,
      addEventListener: name => events.add(name),
      removeEventListener: name => events.delete(name),
    },
    getLyric(id) {
      const request = { id };
      requests.push(request);
      if (deferred)
        return new Promise((resolve, reject) =>
          Object.assign(request, { resolve, reject })
        );
      if (fail && requests.length === 1)
        return Promise.reject(new Error('test failure'));
      return Promise.resolve({ lrc: { lyric: empty ? '' : String(id) } });
    },
    getCloudLyric() {
      throw new Error('unexpected cloud request');
    },
    parseNeteaseLyric: data => [
      {
        words: [{ word: data.lrc.lyric }],
        translatedLyric: '',
        romanLyric: '',
      },
    ],
    filterNeteaseLyric: lines => lines,
    Vibrant: {
      from() {
        colors++;
        return {
          getPalette: () => Promise.resolve({ DarkMuted: { _rgb: [0, 0, 0] } }),
        };
      },
    },
    Color: {
      rgb() {
        const color = {
          darken: () => color,
          lighten: () => color,
          rotate: () => color,
          rgb: () => color,
          string: () => '#123456',
        };
        return color;
      },
    },
    console: { debug() {} },
  };
  const options = new Function(...Object.keys(env), body)(
    ...Object.values(env)
  );
  const vm = {
    active,
    settings: { lyricsBackground: true, showLyricsTime: clock },
    player: {
      currentTrack: {
        id: 1,
        pc: null,
        cd: null,
        ar: [{ name: 'test' }],
        al: { picUrl: 'cover1' },
      },
    },
    $store: { state: { data: { user: {} } } },
    _isDestroyed: false,
  };
  for (const [name, method] of Object.entries(options.methods))
    vm[name] = method.bind(vm);
  Object.assign(vm, options.data.call(vm));
  Object.defineProperty(vm, 'currentTrack', {
    get: () => vm.player.currentTrack,
  });
  const visibility = value => {
    vm.active = value;
    options.watch.active.call(vm, value);
  };
  const track = id => {
    const previous = vm.currentTrack;
    vm.player.currentTrack = { ...previous, id, al: { picUrl: 'cover' + id } };
    options.watch.currentTrack.call(vm, vm.currentTrack, previous);
  };
  const destroy = () => {
    options.beforeDestroy.call(vm);
    vm._isDestroyed = true;
  };
  options.created.call(vm);
  return {
    vm,
    requests,
    visibility,
    track,
    destroy,
    events,
    colors: () => colors,
  };
}
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log('通过  ' + name);
}
async function main() {
  await check(
    '同曲目反复隐藏/恢复保留歌词引用、类型与配色，不重复请求',
    async () => {
      const f = fixture();
      try {
        await settle();
        const lines = f.vm.lyric;
        f.vm.lyricType = 'romaPronunciation';
        for (let i = 0; i < 5; i++) {
          f.visibility(false);
          f.visibility(true);
          await settle();
        }
        assert.equal(f.requests.length, 1);
        assert.equal(f.colors(), 1);
        assert.equal(f.vm.lyric, lines);
        assert.equal(f.vm.lyricType, 'romaPronunciation');
      } finally {
        f.destroy();
      }
    }
  );
  await check('无歌词成功结果不在恢复窗口时重复请求', async () => {
    const f = fixture({ empty: true });
    try {
      await settle();
      f.visibility(false);
      f.visibility(true);
      await settle();
      assert.equal(f.requests.length, 1);
      assert.equal(f.vm.lyric.length, 0);
    } finally {
      f.destroy();
    }
  });
  await check('恢复时复用同曲目尚未完成的请求', async () => {
    const f = fixture({ deferred: true });
    try {
      f.visibility(false);
      f.visibility(true);
      assert.equal(f.requests.length, 1);
      f.requests[0].resolve({ lrc: { lyric: 'first' } });
      await settle();
      assert.equal(f.vm.lyric[0].words[0].word, 'first');
    } finally {
      f.destroy();
    }
  });
  await check(
    '隐藏期间切歌不发请求；旧响应失效，恢复只请求当前曲目',
    async () => {
      const f = fixture({ deferred: true });
      try {
        f.visibility(false);
        f.track(2);
        assert.equal(f.requests.length, 1);
        f.requests[0].resolve({ lrc: { lyric: 'old' } });
        await settle();
        assert.equal(f.vm.lyric.length, 0);
        f.visibility(true);
        assert.equal(f.requests.length, 2);
        assert.equal(f.requests[1].id, 2);
        f.requests[1].resolve({ lrc: { lyric: 'new' } });
        await settle();
        assert.equal(f.vm.lyric[0].words[0].word, 'new');
      } finally {
        f.destroy();
      }
    }
  );
  await check('网络失败后恢复可重试，成功后不再重复请求', async () => {
    const f = fixture({ fail: true });
    try {
      await settle();
      f.visibility(false);
      f.visibility(true);
      await settle();
      assert.equal(f.requests.length, 2);
      assert.equal(f.vm.lyricLoaded, true);
      f.visibility(false);
      f.visibility(true);
      await settle();
      assert.equal(f.requests.length, 2);
    } finally {
      f.destroy();
    }
  });
  await check('初始隐藏不请求歌词或配色；显示后才加载', async () => {
    const f = fixture({ active: false });
    try {
      assert.equal(f.requests.length, 0);
      assert.equal(f.colors(), 0);
      f.visibility(true);
      await settle();
      assert.equal(f.requests.length, 1);
      assert.equal(f.colors(), 1);
    } finally {
      f.destroy();
    }
  });
  await check('隐藏停止时钟且不接管 F11，销毁解绑所有监听', async () => {
    const f = fixture({ clock: true });
    try {
      assert.ok(f.vm.timer);
      f.visibility(false);
      assert.equal(f.vm.timer, null);
      f.vm.handleFullscreenKey({
        key: 'F11',
        preventDefault() {
          throw new Error('hidden F11 intercepted');
        },
      });
      f.visibility(true);
      assert.ok(f.vm.timer);
    } finally {
      f.destroy();
    }
    assert.equal(f.events.size, 0);
  });
  await check('销毁后到达的歌词结果不能写回', async () => {
    const f = fixture({ deferred: true });
    f.destroy();
    f.requests[0].resolve({ lrc: { lyric: 'late' } });
    await settle();
    assert.equal(f.vm.lyric.length, 0);
  });
  await check(
    'Windows 原生可见性优先，macOS 与网页保留页面隐藏判断',
    async () => {
      const appScript = parseComponent(
        fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8')
      ).script.content;
      const start = appScript.indexOf('    handleVisibilityChange() {');
      const end = appScript.indexOf('    handleKeydown(', start);
      const method = appScript.slice(start, end);
      const visibility = (platform, isElectron, nativeVisible, hidden) => {
        const options = new Function(
          'window',
          'document',
          'return {' + method + '};'
        )({ require: () => ({ platform: () => platform }) }, { hidden });
        const vm = { isElectron, nativeWindowVisible: nativeVisible };
        options.handleVisibilityChange.call(vm);
        return vm.windowVisible;
      };
      assert.equal(visibility('win32', true, true, true), true);
      assert.equal(visibility('win32', true, false, false), false);
      assert.equal(visibility('darwin', true, true, true), false);
      assert.equal(visibility('darwin', true, false, false), false);
      assert.equal(visibility('darwin', true, true, false), true);
      assert.equal(visibility('browser', false, true, true), false);
      assert.equal(visibility('browser', false, true, false), true);
    }
  );
  console.log('\n合计 ' + results.length + ' 项，失败 0 项');
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
