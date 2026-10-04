/* ============================================================
   播放内核：队列 / 取链 / 播放控制 / 播放模式
   ============================================================ */

(function () {
  const audio = document.getElementById('audio');

  const state = {
    queue: [],          // 播放队列（歌曲对象数组）
    index: -1,          // 当前在队列中的位置
    current: null,      // 当前歌曲
    urlInfo: null,      // 取链结果 { url, quality, actualQuality, sourceName, tier }
    quality: '320k',
    mode: 'list',       // list | one | order | random
    volume: 0.8,
    muted: false,
    loading: false,
    error: '',
    deviceId: '',
    rate: 1,
    preservesPitch: true,
  };

  const listeners = new Map();

  function on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, []);
    listeners.get(evt).push(fn);
  }

  function emit(evt, payload) {
    (listeners.get(evt) || []).forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  }

  /* ---------------- 音量 ---------------- */

  function applyVolume() {
    audio.volume = state.muted ? 0 : Math.max(0, Math.min(1, state.volume));
  }

  function setVolume(v) {
    state.volume = Math.max(0, Math.min(1, v));
    state.muted = false;
    applyVolume();
    emit('volume', { volume: state.volume, muted: state.muted });
  }

  function toggleMute() {
    state.muted = !state.muted;
    applyVolume();
    emit('volume', { volume: state.volume, muted: state.muted });
  }

  /* ---------------- 输出设备 ---------------- */

  async function listDevices() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      const all = await navigator.mediaDevices.enumerateDevices();
      const outs = all.filter((d) => d.kind === 'audiooutput');
      return outs.map((d, i) => ({
        id: d.deviceId,
        label: d.label || `音频输出设备 ${i + 1}`,
        active: d.deviceId === state.deviceId,
        isDefault: d.deviceId === 'default' || d.deviceId === '',
      }));
    } catch (_) {
      return [];
    }
  }

  async function setDevice(id) {
    try {
      if (typeof audio.setSinkId !== 'function') {
        return { ok: false, error: '当前环境不支持切换输出设备' };
      }
      await audio.setSinkId(id || '');
      state.deviceId = id || '';
      emit('device', state.deviceId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || '切换失败' };
    }
  }

  /* ---------------- 倍速 ---------------- */

  function setRate(r) {
    state.rate = Math.max(0.5, Math.min(2, Number(r) || 1));
    try {
      audio.preservesPitch = state.preservesPitch !== false;
      audio.playbackRate = state.rate;
    } catch (_) {}
    emit('rate', state.rate);
  }

  /* ---------------- 队列 ---------------- */

  function setQueue(songs, startIndex = 0, autoPlay = true) {
    state.queue = Array.isArray(songs) ? songs.slice() : [];
    state.index = state.queue.length ? Math.max(0, Math.min(startIndex, state.queue.length - 1)) : -1;
    emit('queue', state.queue);
    if (state.index >= 0 && autoPlay) {
      load(state.queue[state.index]);
    }
  }

  function addToQueue(song, next = false) {
    if (!song) return;
    if (next && state.index >= 0) state.queue.splice(state.index + 1, 0, song);
    else state.queue.push(song);
    emit('queue', state.queue);
  }

  function removeFromQueue(song) {
    const i = state.queue.findIndex(sameSong(song));
    if (i < 0) return;
    state.queue.splice(i, 1);
    if (i < state.index) state.index -= 1;
    else if (i === state.index) {
      state.index = Math.min(state.index, state.queue.length - 1);
      emit('queue', state.queue);
      if (state.queue.length) load(state.queue[Math.max(0, state.index)]);
      else stop();
      return;
    }
    emit('queue', state.queue);
  }

  function clearQueue() {
    state.queue = [];
    state.index = -1;
    emit('queue', state.queue);
  }

  function sameSong(a) {
    return (b) => b && a && b.songId === a.songId && b.platform === a.platform;
  }

  /* ---------------- 取链 + 播放 ---------------- */

  function nextIndex(step = 1) {
    const n = state.queue.length;
    if (!n) return -1;
    if (state.mode === 'random') {
      if (n === 1) return 0;
      let r = state.index;
      while (r === state.index) r = Math.floor(Math.random() * n);
      return r;
    }
    const i = state.index + step;
    if (state.mode === 'order') return i >= n ? -1 : i;
    return ((i % n) + n) % n;
  }

  async function load(song) {
    if (!song) return;
    state.current = song;
    state.error = '';
    state.loading = true;
    state.urlInfo = null;
    emit('song', song);
    emit('loading', true);

    // 清掉上一首，避免残留音频
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch (_) {}

    // 按降级链依次尝试：所选档位拿不到就自动往下取，不报错
    const chain = window.API.qualityChain(state.quality);
    let res = null;
    for (const q of chain) {
      res = await window.API.playUrl({
        platform: song.platform,
        songId: song.songId,
        quality: q,
        name: song.name,
        singer: song.singer,
      });
      if (res && res.ok) break;
      // 卡密 / 平台权限问题，换音质也解决不了，直接跳出
      if (res && (res.needCardKey || res.forbidden)) break;
    }

    // 平台/音质受限或失败时，自动换源重试一次
    if (!res || !res.ok) {
      const alt = await findAlternative(song);
      if (alt) {
        for (const q of chain) {
          res = await window.API.playUrl({
            platform: alt.platform,
            songId: alt.songId,
            quality: q,
            name: alt.name,
            singer: alt.singer,
          });
          if (res && res.ok) break;
          if (res && (res.needCardKey || res.forbidden)) break;
        }
        if (res && res.ok) {
          song = { ...alt };
          state.current = alt;
          emit('song', alt);
          emit('notice', { type: 'ok', text: `已自动切换到 ${window.API.platformOf(alt.platform).name} 播放` });
        }
      }
    }

    if (!res || !res.ok) {
      state.loading = false;
      state.error = (res && res.error) || '取链失败';
      emit('loading', false);
      emit('error', state.error);
      return;
    }

    state.urlInfo = res.data;
    audio.src = res.data.url;
    applyVolume();

    try {
      await audio.play();
    } catch (err) {
      state.loading = false;
      emit('loading', false);
      if (err && err.name !== 'AbortError') {
        state.error = '播放失败：' + (err.message || err.name);
        emit('error', state.error);
      }
      return;
    }

    state.loading = false;
    emit('loading', false);
    emit('url', state.urlInfo);
  }

  /** 在当前平台之外找一个同名歌曲 */
  async function findAlternative(song) {
    const others = ['wy', 'tx', 'kg', 'kw', 'mg', 'qs'].filter((p) => p !== song.platform);
    const key = String(song.name || '').toLowerCase().replace(/\s+/g, '');
    const singer = String(song.singer || '').toLowerCase().replace(/\s+/g, '');

    for (const p of others) {
      const res = await window.API.search({ keyword: `${song.name} ${song.singer || ''}`.trim(), platform: p, limit: 8 });
      if (!res || !res.ok || !res.data.length) continue;
      const hit = res.data.find(
        (x) => String(x.name || '').toLowerCase().replace(/\s+/g, '') === key &&
               (!singer || String(x.singer || '').toLowerCase().replace(/\s+/g, '').includes(singer))
      ) || res.data.find((x) => String(x.name || '').toLowerCase().replace(/\s+/g, '') === key);
      if (hit) return hit;
    }
    return null;
  }

  /* ---------------- 控制 ---------------- */

  async function playSong(song, queue, index) {
    if (queue && queue.length) {
      state.queue = queue.slice();
      state.index = typeof index === 'number' ? index : state.queue.findIndex(sameSong(song));
      if (state.index < 0) state.index = 0;
      emit('queue', state.queue);
    } else {
      const i = state.queue.findIndex(sameSong(song));
      state.index = i >= 0 ? i : state.index;
    }
    await load(song);
  }

  function toggle() {
    if (!state.current) return;
    if (audio.paused) {
      if (!audio.src && state.current) load(state.current);
      else audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  function next(auto = false) {
    if (!state.queue.length) return;
    if (auto && state.mode === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    const i = nextIndex(1);
    if (i < 0) { // 顺序播放到底
      audio.pause();
      emit('ended-all');
      return;
    }
    state.index = i;
    load(state.queue[i]);
  }

  function prev() {
    if (!state.queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    const i = nextIndex(-1);
    if (i < 0) { audio.currentTime = 0; return; }
    state.index = i;
    load(state.queue[i]);
  }

  function seek(sec) {
    if (!audio.duration) return;
    audio.currentTime = Math.max(0, Math.min(sec, audio.duration));
  }

  function stop() {
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch (_) {}
    state.current = null;
    state.urlInfo = null;
    state.index = -1;
    emit('song', null);
    emit('stop');
  }

  function setQuality(q) {
    if (state.quality === q) return;
    state.quality = q;
    emit('quality', q);
    // 正在播放则重新取链
    if (state.current && !audio.paused) {
      const t = audio.currentTime;
      load(state.current).then(() => { audio.currentTime = t; }).catch(() => {});
    }
  }

  function setMode(m) {
    state.mode = m;
    emit('mode', m);
  }

  /* ---------------- 音频事件 ---------------- */

  audio.addEventListener('timeupdate', () => {
    emit('time', { current: audio.currentTime, duration: audio.duration || 0 });
  });
  audio.addEventListener('durationchange', () => {
    emit('time', { current: audio.currentTime, duration: audio.duration || 0 });
  });
  audio.addEventListener('play', () => emit('state', { playing: true }));
  audio.addEventListener('pause', () => emit('state', { playing: false }));
  audio.addEventListener('waiting', () => emit('buffering', true));
  audio.addEventListener('playing', () => emit('buffering', false));
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    emit('error', '音频加载失败，可能链接已失效');
  });

  window.Player = {
    state,
    audio,
    on,
    emit,
    setQueue,
    addToQueue,
    removeFromQueue,
    clearQueue,
    playSong,
    toggle,
    next,
    prev,
    seek,
    stop,
    setVolume,
    toggleMute,
    listDevices,
    setDevice,
    setRate,
    setQuality,
    setMode,
    load,
    applyVolume,
    get playing() { return !audio.paused; },
    get time() { return audio.currentTime; },
    get duration() { return audio.duration || 0; },
  };
})();
