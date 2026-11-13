/* ============================================================
   HYWmusic 桌面播放器 · 界面与交互
   ============================================================ */

(function () {
  const API = window.API;
  const P = window.Player;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };

  const S = {
    view: 'search',
    query: '',
    platform: 'all',
    engine: 'lx',
    quality: '320k',
    loading: false,
    results: [],
    resultMeta: '',
    error: '',
    themePref: 'auto',
    history: LS.get('hyw-history', []),
    favorites: LS.get('hyw-favorites', []),
    later: LS.get('hyw-later', []),
    playlists: LS.get('hyw-playlists', []),
    downloads: LS.get('hyw-downloads', []),
    localFiles: [],
    currentPlaylist: null,
    lyricsOpen: false,
    lyrics: [],
    lyricIndex: -1,
    showQueue: false,
    showVolume: false,
    detailOpen: false,
    selected: new Set(),
    version: '1.0.0-rc1',
    baseUrl: '',
    // 只保留展示别名，渲染进程内不落地真实服务端地址
    serverLabel: '',
    serverFull: '',
    serverIdx: 0,
    serverPresets: [],
    baseLabel: '',
    qMenuOpen: false,
    sMenuOpen: false,
    cardKey: { active: false },
    admin: { loggedIn: false, user: null },
  };

  let closePrefs = { action: 'tray', askDisabled: false };

  /* 拖动状态：全局只注册一次 mousemove / mouseup，避免每次重渲染都泄漏监听器 */
  let dragKind = null;   // 'prog' | 'vol' | null
  let deviceSeq = 0;     // 设备列表异步竞态保护
  let songMenuCloser = null;  // 歌曲菜单的全局关闭监听（保证只存在一个）

  /* ============================================================
     工具
     ============================================================ */

  const songKey = (s) => `${s.platform}:${s.songId}`;
  const isFav = (s) => !!s && S.favorites.some((x) => songKey(x) === songKey(s));
  const isCurrent = (s) => {
    const c = P.state.current;
    return !!c && !!s && c.songId === s.songId && c.platform === s.platform;
  };
  const coverOf = (s) => (s && (s.picUrl || s.img || s.cover)) || '';

  /**
   * 按显示尺寸请求封面，显著降低图片解码内存（列表只显示 36px）。
   * 只改 URL 里的尺寸参数，不影响任何布局/动画。
   */
  function thumbUrl(url, size) {
    let u = String(url || '');
    if (!u) return '';
    const n = size || 120;
    // QQ 音乐：.../T002R500x500M000....jpg
    u = u.replace(/R\d+x\d+M000/, `R${n}x${n}M000`);
    // 网易云：...?param=500y500
    u = u.replace(/([?&]param=)\d+y\d+/, `$1${n}y${n}`);
    return u;
  }
  const fmt = (sec) => API.fmtTime(sec);

  function toast(text, type) {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast--' + type : '');
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2600);
  }

  /* ============================================================
     搜索结果：本地缓存 + 排序（原唱 / 高音质优先）
     ============================================================ */

  /** 同关键词短期复用，避免重复触发服务端冷启动（实测首次 18-26s、命中缓存 2-4s） */
  const searchCache = new Map();
  const SEARCH_TTL = 5 * 60 * 1000;
  const SEARCH_CACHE_MAX = 24;

  /** 非原唱 / 低价值版本标记（命中则大幅降权） */
  const NOISE_RE = /(翻唱|cover|伴奏|纯音乐|钢琴|吉他|dj版|remix|抖音|女声|男声|童声|深情|治愈|片段|铃声|清唱|live|现场|节目|动画|器乐|八音盒|karaoke|instrumental|慢速|加速|降调|升调|串烧|合集|原唱|demo|试听)/i;

  /** 去掉括号内容并归一化，用于判断「标题是否就是这首歌本身」 */
  function normTitle(str) {
    return String(str || '')
      .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  /** 综合评分：歌名匹配 > 歌手匹配 > 音质 > 时长；非原唱版本降权 */
  function songScore(song, keyword) {
    const kw = String(keyword || '').toLowerCase().replace(/\s+/g, '');
    const rawName = String(song.name || '');
    const name = rawName.toLowerCase();
    const title = normTitle(rawName);
    const singer = String(song.singer || '').toLowerCase().replace(/\s+/g, '');
    let score = 0;

    // 歌名匹配度
    if (kw) {
      if (title === kw) score += 1200;
      else if (title.startsWith(kw)) score += 800;
      else if (title.includes(kw)) score += 500;
      else if (name.includes(kw)) score += 200;
      else score -= 400; // 完全不相关（如搜「晴天」混进「发如雪」）
    }

    // 搜歌手名时，原唱额外加分
    if (kw && singer.includes(kw)) score += 700;

    // 翻唱 / 伴奏 / 现场版等降权（权重高于音质，确保原唱永远排在改编版前面）
    if (NOISE_RE.test(rawName)) score -= 1200;
    // 标题带括号（版本说明）也降权：如「晴天 (Live)」「晴天（史诗版）」
    if (/[（(\[【]/.test(rawName)) score -= 300;

    // 音质：取「平台声明」与「实测」中更高的等级，等级越高分越高（越好越靠前）
    let qRank = 0;
    const types = song._original && Array.isArray(song._original.types) ? song._original.types : [];
    for (const t of types) qRank = Math.max(qRank, qualityRank(t && t.type));
    if (song.__probe && song.__probe.ok && song.__probe.quality) {
      qRank = Math.max(qRank, qualityRank(song.__probe.quality));
    }
    score += qRank * 100;

    // 时长有效性
    const dur = Number(song.duration) || 0;
    if (dur >= 60) score += 60;
    else if (dur > 0) score -= 200; // 铃声 / 片段
    else score -= 100;              // 无时长

    return score;
  }

  /* ---------------- 可播性快速检测 ---------------- */
  /*
     用户痛点：搜索排第一的可能是「原唱但上游取不到链」的歌（如 QQ 音乐部分版权曲），
     点下去播不了。这里在搜索出结果后，后台并发探测前若干首能否取链，
     把确认播不了的移到列表末尾——不阻塞首屏，也不影响原唱/音质的排序优先级。
  */
  const probeCache = new Map();   // `${platform}:${songId}` -> { ok, quality, t }
  const PROBE_TTL = 10 * 60 * 1000;
  const PROBE_COUNT = 12;         // 每平台轮询取 2 条（6 源 ≈ 12 首），保证每个音源都参与
  const PROBE_CONCURRENCY = 6;    // 同时最多 6 个请求
  const PROBE_TIMEOUT = 5000;     // 单条上限 5s：实测成功多在 1-7s，超时即视为暂不可播

  let searchToken = 0;            // 防止旧搜索的检测结果覆盖新搜索

  /** 音质等级（数值越大越高） */
  function qualityRank(q) {
    const m = { '128k': 1, '320k': 2, 'flac': 3, 'flac24bit': 4, 'flac32bit': 5, hires: 6, atmos: 6, master: 7 };
    return m[String(q || '').toLowerCase()] || 0;
  }

  /** 探测单首是否可播（带缓存 + 超时） */
  async function probeSong(song) {
    const key = `${song.platform}:${song.songId}`;
    const hit = probeCache.get(key);
    if (hit && Date.now() - hit.t < PROBE_TTL) return hit;

    let out;
    try {
      const res = await Promise.race([
        API.playUrl({
          platform: song.platform,
          songId: song.songId,
          quality: API.apiQuality(S.quality),
          name: song.name,
          singer: song.singer,
        }),
        new Promise((r) => setTimeout(() => r(null), PROBE_TIMEOUT)),
      ]);
      out = res && res.ok
        ? { ok: true, quality: (res.data && (res.data.actualQuality || res.data.quality)) || '', t: Date.now() }
        : { ok: false, quality: '', t: Date.now() };
    } catch (_) {
      out = { ok: false, quality: '', t: Date.now() };
    }
    probeCache.set(key, out);
    return out;
  }

  /** 重排：保持「原唱 + 音质」顺序，仅把已确认播不了的移到末尾 */
  function rerankWithProbe(list, keyword) {
    const ranked = rankSongs(list, keyword);
    const ok = [];
    const dead = [];
    for (const song of ranked) {
      if (song.__probe && song.__probe.ok === false) dead.push(song);
      else ok.push(song);
    }
    return ok.concat(dead);
  }

  /** 按平台轮询取样：保证每个音源都有样本，而不是只测排在前面的同一个源 */
  function pickProbeTargets(list, max) {
    const byPlatform = new Map();
    for (const song of list) {
      if (!byPlatform.has(song.platform)) byPlatform.set(song.platform, []);
      byPlatform.get(song.platform).push(song);
    }
    const groups = Array.from(byPlatform.values());
    const out = [];
    for (let round = 0; out.length < max; round++) {
      let added = false;
      for (const group of groups) {
        if (group[round] && out.length < max) { out.push(group[round]); added = true; }
      }
      if (!added) break;
    }
    return out;
  }

  /** 限制并发的 map */
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return out;
  }

  /** 后台探测（覆盖所有音源）并重排，不阻塞首屏 */
  async function probeAndRerank(keyword, token) {
    const targets = pickProbeTargets(S.results, PROBE_COUNT);
    if (!targets.length) return;
    const results = await mapLimit(targets, PROBE_CONCURRENCY, (song) => probeSong(song));
    if (token !== searchToken) return; // 搜索已变化，丢弃本次结果
    targets.forEach((song, i) => { song.__probe = results[i]; });
    S.results = rerankWithProbe(S.results, keyword);
    renderContent();
    const dead = results.filter((r) => r && r.ok === false).length;
    const plats = new Set(targets.map((x) => x.platform)).size;
    toast(
      dead > 0
        ? `已检测 ${targets.length} 首（${plats} 个音源）：${dead} 首暂不可播，已移到后面`
        : `已检测 ${targets.length} 首（${plats} 个音源）：全部可播`,
      'ok'
    );
  }

  /**
   * 稳定排序：分数降序，同分保持服务端原顺序。
   * 排序后做一次「同名 + 同歌手」去重——同一首歌在不同平台会返回多条，
   * 只保留排序最靠前的那条（通常是音质最好/可播的那条），避免列表里反复出现。
   */
  function rankSongs(list, keyword) {
    const sorted = (list || [])
      .map((song, index) => ({ song, index, score: songScore(song, keyword) }))
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .map((x) => x.song);

    // 同名 + 同歌手 视为同一首歌：列表只展示音质最好的那条，
    // 其余音源的版本挂到 __alts 上作为备选（播放失败时可直接换源，不用重新搜索）
    const groups = new Map();
    const out = [];
    for (const song of sorted) {
      const key = `${normTitle(song.name)}|${String(song.singer || '').toLowerCase().replace(/\s+/g, '')}`;
      const keeper = groups.get(key);
      if (keeper) {
        (keeper.__alts = keeper.__alts || []).push(song);
        continue;
      }
      groups.set(key, song);
      out.push(song);
    }
    return out;
  }

  /* ============================================================
     本地数据
     ============================================================ */

  function pushHistory(song) {
    S.history = [song, ...S.history.filter((x) => songKey(x) !== songKey(song))].slice(0, 300);
    LS.set('hyw-history', S.history);
  }

  function toggleFav(song) {
    if (!song) return;
    const k = songKey(song);
    const has = S.favorites.some((x) => songKey(x) === k);
    S.favorites = has ? S.favorites.filter((x) => songKey(x) !== k) : [song, ...S.favorites];
    LS.set('hyw-favorites', S.favorites);
    toast(has ? '已取消收藏' : '已加入收藏', 'ok');
    renderContent(); renderPlayerBar(); renderSideCounts();
  }

  function addLater(song) {
    if (!song) return;
    if (S.later.some((x) => songKey(x) === songKey(song))) { toast('已在稍后播放中'); return; }
    S.later = [song, ...S.later];
    LS.set('hyw-later', S.later);
    toast('已加入稍后播放', 'ok');
    renderSideCounts();
  }

  const savePlaylists = () => LS.set('hyw-playlists', S.playlists);
  const saveDownloads = () => LS.set('hyw-downloads', S.downloads);

  function addToPlaylist(plId, song) {
    const pl = S.playlists.find((p) => p.id === plId);
    if (!pl) return;
    if (pl.songs.some((x) => songKey(x) === songKey(song))) { toast('这首歌已在列表中'); return; }
    pl.songs.push(song);
    savePlaylists();
    toast(`已加入「${pl.name}」`, 'ok');
    renderSideCounts();
    if (S.view === 'playlist') renderContent();
  }

  function playFrom(list, index) {
    const song = list && list[index];
    if (!song) return;
    if (song.local) { playLocal(song, list, index); return; }
    P.playSong(song, list, index);
  }

  /* ============================================================
     本地音乐
     ============================================================ */

  async function playLocal(file, list, index) {
    try {
      const url = URL.createObjectURL(file.file || file);
      P.state.current = {
        songId: 'local:' + (file.name || ''),
        platform: 'local',
        name: (file.name || '').replace(/\.[^.]+$/, ''),
        singer: '本地音乐',
        duration: 0,
        local: true,
      };
      P.audio.src = url;
      P.applyVolume();
      await P.audio.play();
      P.emit('song', P.state.current);
      renderPlayerBar();
      toast('正在播放本地音乐');
    } catch (err) {
      toast('无法播放该文件：' + (err.message || ''), 'err');
    }
  }

  /* ============================================================
     外壳
     ============================================================ */

  function render() {
    $('#app').innerHTML = `
      <div class="shell">
        ${sideHtml()}
        <section class="stage">
          ${topbarHtml()}
          <div class="content" id="content"></div>
        </section>
        ${lyricsHtml()}
      </div>
      ${playerBarHtml()}
      ${S.detailOpen ? detailHtml() : ''}
    `;
    renderContent();
    renderPlayerBar();
    if (S.detailOpen) renderDetail();
    // 浮层统一挂到 body（每次先删旧的），避免与 #app 内重复生成同 ID 元素
    if (S.showQueue) mountQueuePanel(); else { const q = $('#qpanel'); if (q) q.remove(); }
    if (S.showVolume) mountVolumePanel(); else { const v = $('#vpanel'); if (v) v.remove(); }
  }

  const NAV_ONLINE = [
    { id: 'search', label: '搜索', icon: 'search' },
    { id: 'rank', label: '排行榜', icon: 'zap' },
    { id: 'library', label: '音乐库', icon: 'disc' },
  ];
  const NAV_MINE = [
    { id: 'playlists', label: '我的列表', icon: 'listMusic' },
    { id: 'favorites', label: '收藏', icon: 'heart' },
    { id: 'downloads', label: '下载管理', icon: 'download' },
    { id: 'local', label: '本地音乐', icon: 'folder' },
  ];
  const NAV_BOTTOM = [
    { id: 'trial', label: '试听列表', icon: 'clock' },
    { id: 'favorites', label: '我的收藏', icon: 'heart' },
    { id: 'later', label: '稍后播放', icon: 'queue' },
    { id: 'history', label: '历史记录', icon: 'grip' },
  ];

  function sideHtml() {
    const item = (v) => `
      <button class="side__item${S.view === v.id ? ' active' : ''}" data-view="${esc(v.id)}">
        ${icon(v.icon, 17)}<span>${esc(v.label)}</span>${badgeOf(v.id)}
      </button>`;

    return `
      <aside class="side">
        <div class="side__brand">
          <img src="assets/logo-64.png" alt=""/>
          <div><b>HYWmusic</b><small>音乐播放器</small></div>
        </div>
        <nav class="side__nav">
          <div class="side__group">在线音乐</div>
          ${NAV_ONLINE.map(item).join('')}

          <div class="side__group">
            <span>我的音乐</span>
            <button class="side__add" data-act="new-playlist" title="新建列表">${icon('plus', 13)}</button>
          </div>
          ${NAV_MINE.map(item).join('')}
          ${S.playlists.map((p) => `
            <button class="side__item side__item--sub${S.view === 'playlist' && S.currentPlaylist === p.id ? ' active' : ''}"
                    data-pl="${esc(p.id)}">
              ${icon('folder', 15)}<span>${esc(p.name)}</span><em>${p.songs.length || ''}</em>
            </button>`).join('')}

          <div class="side__group">播放</div>
          ${NAV_BOTTOM.map((v) => `
            <button class="side__item${S.view === v.id ? ' active' : ''}" data-view="${esc(v.id)}">
              ${icon(v.icon, 17)}<span>${esc(v.label)}</span>${badgeOf(v.id)}
            </button>`).join('')}

          <div class="side__group">其他</div>
          <button class="side__item${S.view === 'settings' ? ' active' : ''}" data-view="settings">
            ${icon('settings', 17)}<span>设置</span>
          </button>
        </nav>
      </aside>`;
  }

  /** 音质皇冠（等级 1..4） */
  function crownOf(qid) {
    const q = API.QUALITIES.find((x) => x.id === qid);
    const t = q ? q.tier : 1;
    return `<span class="crown crown--${t}">${icon('crown', 13)}</span>`;
  }

  /**
   * 服务端显示名。
   * 只使用主进程下发的展示别名 —— 渲染进程里**不保存也不拼接真实地址**，
   * 这样界面、DOM、渲染进程内存中都不会出现源站 IP / 主机名。
   */
  function serverLabel() {
    return S.serverLabel || '默认线路';
  }

  /** 预设项展示名（同样只用别名） */
  function presetLabel(p) {
    return (p && (p.label || p.name)) || '线路';
  }

  function badgeOf(id) {
    const n = { trial: S.history.length, history: S.history.length, favorites: S.favorites.length, later: S.later.length, downloads: S.downloads.length }[id];
    return n ? `<em>${n}</em>` : '';
  }

  function topbarHtml() {
    return `
      <header class="topbar">
        <div class="search">
          ${icon('search', 17)}
          <input id="q" type="text" placeholder="搜索歌曲 / 歌手 / 专辑" value="${esc(S.query)}" spellcheck="false"/>
          ${S.query ? `<button class="search__clear" data-act="clear-q">${icon('x', 13)}</button>` : ''}
          <button class="search__go" data-act="do-search">搜索</button>
        </div>
        <div class="topbar__filters">
          <label class="pick pick--sm" title="搜索引擎">
            <select id="sel-engine">
              <option value="lx"${S.engine === 'lx' ? ' selected' : ''}>LX 引擎</option>
              <option value="api"${S.engine === 'api' ? ' selected' : ''}>聚合引擎</option>
            </select>
          </label>

          <div class="drop" id="qdrop">
            <button class="pick pick--btn" data-act="quality-menu" title="优先播放的音质（如果可用）">
              <b class="pick__val">${crownOf(S.quality)}${esc(API.qualityName(S.quality))}</b>
              ${icon('chevronDown', 14)}
            </button>
            ${S.qMenuOpen ? `<div class="dmenu">
              ${API.QUALITIES.map((q) => `
                <button class="dmenu__i${q.id === S.quality ? ' on' : ''}" data-qpick="${q.id}">
                  <span class="crown crown--${q.tier}">${icon('crown', 14)}</span>
                  <span class="dmenu__t"><b>${esc(q.name)}</b><small>${esc(q.desc || '')}</small></span>
                  ${q.id === S.quality ? icon('check', 14) : ''}
                </button>`).join('')}
            </div>` : ''}
          </div>

          <div class="drop" id="sdrop">
            <button class="pick pick--btn" data-act="server-menu" title="服务端线路：${esc(S.serverFull || serverLabel())}">
              <b class="pick__val">${esc(serverLabel())}</b>
              ${icon('chevronDown', 14)}
            </button>
            ${S.sMenuOpen ? `<div class="dmenu dmenu--wide">
              ${(S.serverPresets.length ? S.serverPresets : [{ name: '默认线路', label: '默认线路', def: true }]).map((p, i) => `
                <button class="dmenu__i${i === S.serverIdx ? ' on' : ''}" data-spick="${i}">
                  <span class="dmenu__t"><b>${esc(p.name || presetLabel(p))}</b><small>${esc(p.label || (p.def ? '默认线路' : '备用线路'))}</small></span>
                  ${i === S.serverIdx ? icon('check', 14) : ''}
                </button>`).join('')}
              <div class="dmenu__sep"></div>
              <button class="dmenu__i" data-act="server-custom">
                <span class="dmenu__t"><b>自定义地址…</b><small>手动填写 API 地址</small></span>
              </button>
              <button class="dmenu__i" data-act="server-test">
                <span class="dmenu__t"><b>测试连接</b><small>检测当前线路是否可用</small></span>
              </button>
            </div>` : ''}
          </div>
        </div>
        <span class="topbar__gap" aria-hidden="true"></span>
      </header>`;
  }

  /* ============================================================
     内容区
     ============================================================ */

  function renderContent() {
    const c = $('#content');
    if (!c) return;
    const V = {
      search: viewSearch,
      rank: viewRank,
      library: viewLibrary,
      playlists: viewPlaylists,
      favorites: () => viewList('我的收藏', 'heart', S.favorites, '还没有收藏的歌曲'),
      downloads: viewDownloads,
      local: viewLocal,
      trial: () => viewList('试听列表', 'clock', S.history, '还没有试听记录，去搜索一首歌吧'),
      later: () => viewList('稍后播放', 'queue', S.later, '稍后播放是空的'),
      history: () => viewList('历史记录', 'grip', S.history, '还没有播放记录'),
      playlist: viewPlaylist,
      settings: viewSettings,
    };
    c.innerHTML = (V[S.view] || viewSearch)();
    bindContent();
    updateActiveRows();
  }

  /** 音源切换条（全部 / 网易云 / QQ音乐 / 酷狗 / 酷我 / 咪咕 / 汽水） */
  function platformBar() {
    return `<div class="pbar-chips">${API.PLATFORMS.map((p) => `
      <button class="chip${S.platform === p.id ? ' on' : ''}" data-plat="${esc(p.id)}"
              title="${esc(p.name)}">
        <i class="dot" style="background:${p.color}"></i>${esc(p.name)}
      </button>`).join('')}</div>`;
  }

  function viewSearch() {
    const bar = platformBar();
    if (S.loading) return bar + `<div class="placeholder"><span class="spin"></span><p>正在搜索「${esc(S.query)}」…</p>
        <p class="ph-sub">首次搜索服务端需建立缓存，可能稍慢；再次搜索会很快</p></div>`;
    if (S.error) return bar + `<div class="placeholder">${icon('wifiOff', 34)}<p>${esc(S.error)}</p><button class="btn" data-act="retry-search">重试</button></div>`;
    if (!S.results.length) {
      return bar + `<div class="placeholder">${icon('headphones', 42)}
        <p>${S.query ? '没有找到相关歌曲，试试切换音源或引擎' : '输入关键词，开始搜索音乐'}</p>
        <p class="ph-sub">内置 ${API.PLATFORMS.length - 1} 个音源：${API.PLATFORMS.filter((p) => p.id !== 'all').map((p) => p.name).join(' · ')}</p></div>`;
    }
    return bar + listHead() + `<div class="rows">${S.results.map((s, i) => row(s, i)).join('')}</div>
      <div class="listfoot">共 ${S.results.length} 首${S.resultMeta ? ' · ' + esc(S.resultMeta) : ''}</div>`;
  }

  function viewRank() {
    return `
      <div class="viewhead"><h2>${icon('zap', 19)}排行榜</h2></div>
      <div class="placeholder" style="min-height:32vh">
        ${icon('info', 34)}
        <p>排行榜需要平台榜单接口，当前音源服务未开放该接口</p>
        <p class="ph-sub">可用替代路径：用「搜索」按歌手/歌名检索，或粘贴歌单链接到「我的列表」</p>
      </div>
      <div class="card" style="max-width:640px;margin:0 auto">
        <div class="card__title">内置音源</div>
        ${API.PLATFORMS.filter((p) => p.id !== 'all').map((p) => `
          <div class="field">
            <label><i class="dot" style="background:${p.color}"></i>${esc(p.name)}</label>
            <span class="field__val">已启用</span>
          </div>`).join('')}
      </div>`;
  }

  function viewLibrary() {
    const stat = [
      ['试听列表', S.history.length, 'clock'],
      ['我的收藏', S.favorites.length, 'heart'],
      ['稍后播放', S.later.length, 'queue'],
      ['我的列表', S.playlists.length, 'listMusic'],
      ['本地音乐', S.localFiles.length, 'folder'],
      ['下载记录', S.downloads.length, 'download'],
    ];
    return `
      <div class="viewhead"><h2>${icon('disc', 19)}音乐库</h2></div>
      <div class="statgrid">
        ${stat.map(([label, n, ic]) => `
          <div class="statcard">
            ${icon(ic, 20)}
            <b>${n}</b>
            <span>${esc(label)}</span>
          </div>`).join('')}
      </div>`;
  }

  function viewPlaylists() {
    return `
      <div class="viewhead">
        <h2>${icon('listMusic', 19)}我的列表</h2>
        <div class="viewhead__ops"><button class="btn btn-sm" data-act="new-playlist">${icon('plus', 13)}新建列表</button></div>
      </div>
      ${S.playlists.length
        ? `<div class="plgrid">${S.playlists.map((p) => `
            <div class="plcard" data-pl="${esc(p.id)}">
              <div class="plcard__cover">${icon('listMusic', 26)}</div>
              <b>${esc(p.name)}</b>
              <small>${p.songs.length} 首</small>
            </div>`).join('')}</div>`
        : `<div class="placeholder">${icon('listMusic', 42)}<p>还没有自建列表</p>
             <button class="btn" data-act="new-playlist">新建一个</button></div>`}`;
  }

  function viewDownloads() {
    if (!S.downloads.length) {
      return `<div class="placeholder">${icon('download', 42)}<p>还没有下载记录</p>
        <p class="ph-sub">在歌曲右侧「⋯」菜单里选择「下载」即可</p></div>`;
    }
    return `
      <div class="viewhead">
        <h2>${icon('download', 19)}下载管理</h2>
        <div class="viewhead__ops"><button class="btn btn-sm btn-ghost" data-act="clear-downloads">清空记录</button></div>
      </div>
      <div class="rows">${S.downloads.map((d, i) => `
        <div class="dlrow">
          <span class="dlrow__i">${i + 1}</span>
          <span class="dlrow__t"><b>${esc(d.name)}</b><small>${esc(d.quality || '')} · ${esc(d.time || '')}</small></span>
          <span class="dlrow__p" title="${esc(d.path || '')}">${esc((d.path || '').split(/[\\/]/).pop() || '')}</span>
        </div>`).join('')}</div>`;
  }

  function viewLocal() {
    return `
      <div class="viewhead">
        <h2>${icon('folder', 19)}本地音乐</h2>
        <div class="viewhead__ops">
          <button class="btn btn-sm" data-act="pick-local">${icon('plus', 13)}导入本地文件</button>
          ${S.localFiles.length ? `<button class="btn btn-sm btn-ghost" data-act="clear-local">清空</button>` : ''}
        </div>
      </div>
      <input type="file" id="local-input" accept="audio/*" multiple hidden/>
      ${S.localFiles.length
        ? `<div class="rows">${S.localFiles.map((f, i) => `
            <div class="row localrow${isCurrent({ songId: 'local:' + f.name, platform: 'local' }) ? ' playing' : ''}" data-idx="${i}">
              <span class="c-idx"><span class="row__no">${i + 1}</span>
                <button class="row__play" data-act="play-local" data-idx="${i}">${icon('play', 13)}</button></span>
              <span class="c-title"><span class="cover cover--ph">${icon('music', 15)}</span>
                <span class="tt"><b>${esc(f.name)}</b></span></span>
              <span class="c-singer">本地音乐</span>
              <span class="c-album">${esc(f.size || '')}</span>
              <span class="c-plat"><i style="background:#8b93a7"></i>本地</span>
              <span class="c-time">—</span>
              <span class="c-act"></span>
            </div>`).join('')}</div>`
        : `<div class="placeholder">${icon('folder', 42)}<p>还没有导入本地音乐</p>
             <p class="ph-sub">支持 mp3 / flac / m4a / wav / ogg 等浏览器可解码的格式</p></div>`}`;
  }

  function viewPlaylist() {
    const pl = S.playlists.find((p) => p.id === S.currentPlaylist);
    if (!pl) return `<div class="placeholder">${icon('folder', 42)}<p>列表不存在</p></div>`;
    return `
      <div class="viewhead">
        <h2>${icon('listMusic', 19)}${esc(pl.name)}</h2>
        <div class="viewhead__ops">
          ${pl.songs.length ? `<button class="btn btn-sm" data-act="play-pl">${icon('play', 13)}播放全部</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-act="rename-pl">重命名</button>
          <button class="btn btn-sm btn-ghost btn-danger" data-act="delete-pl">删除列表</button>
        </div>
      </div>
      ${pl.songs.length
        ? listHead() + `<div class="rows">${pl.songs.map((s, i) => row(s, i)).join('')}</div><div class="listfoot">共 ${pl.songs.length} 首</div>`
        : `<div class="placeholder">${icon('listMusic', 42)}<p>列表还是空的</p><p class="ph-sub">在歌曲右侧「⋯」菜单里加入</p></div>`}`;
  }

  function listHead() {
    return `
      <div class="listhead">
        <span class="c-idx">#</span>
        <span class="c-title">歌曲</span>
        <span class="c-singer">歌手</span>
        <span class="c-album">专辑</span>
        <span class="c-plat">音源</span>
        <span class="c-time">${icon('clock', 13)}</span>
        <span class="c-act"></span>
      </div>`;
  }

  function viewList(title, ic, list, empty) {
    if (!list.length) return `<div class="placeholder">${icon(ic, 42)}<p>${esc(empty)}</p></div>`;
    return `
      <div class="viewhead">
        <h2>${icon(ic, 19)}${esc(title)}</h2>
        <div class="viewhead__ops">
          <button class="btn btn-sm" data-act="play-all">${icon('play', 13)}播放全部</button>
          <button class="btn btn-sm btn-ghost" data-act="clear-list" data-list="${esc(title)}">清空</button>
        </div>
      </div>
      ${listHead()}<div class="rows">${list.map((s, i) => row(s, i)).join('')}</div>
      <div class="listfoot">共 ${list.length} 首</div>`;
  }

  function row(s, i) {
    const cur = isCurrent(s);
    const fav = isFav(s);
    const p = API.platformOf(s.platform);
    const cover = coverOf(s);
    const q = s.qualityLabel || '';
    return `
      <div class="row${cur ? ' playing' : ''}" data-idx="${i}" data-key="${esc(songKey(s))}">
        <span class="c-idx">
          <span class="row__no">${i + 1}</span>
          <span class="bars"><i></i><i></i><i></i></span>
          <button class="row__play" data-act="play-row" data-idx="${i}" title="播放">${icon('play', 13)}</button>
        </span>
        <span class="c-title">
          ${cover ? `<img class="cover" src="${esc(thumbUrl(cover, 120))}" loading="lazy" alt="" data-cover="1" decoding="async"/>`
                  : `<span class="cover cover--ph">${icon('music', 15)}</span>`}
          <span class="tt"><b>${esc(s.name || '未知歌曲')}</b>${q ? `<em class="qtag">${esc(q)}</em>` : ''}</span>
        </span>
        <span class="c-singer" title="${esc(s.singer || '')}">${esc(s.singer || '未知歌手')}</span>
        <span class="c-album" title="${esc(s.album || '')}">${esc(s.album || '—')}</span>
        <span class="c-plat"><i style="background:${p.color}"></i>${esc(p.name)}</span>
        <span class="c-time">${fmt(s.duration)}</span>
        <span class="c-act">
          <button class="ico${fav ? ' on' : ''}" data-act="fav" data-idx="${i}" title="${fav ? '取消收藏' : '收藏'}">
            ${icon(fav ? 'heartFill' : 'heart', 15)}</button>
          <button class="ico" data-act="menu" data-idx="${i}" title="更多">${icon('more', 15)}</button>
        </span>
      </div>`;
  }

  /* ============================================================
     设置
     ============================================================ */

  function viewSettings() {
    const cat = S.settingCat || 'basic';
    const CATS = [
      ['basic', '基本设置', 'settings'],
      ['play', '播放设置', 'play'],
      ['detail', '播放详情页', 'disc'],
      ['lyric', '桌面歌词', 'mic'],
      ['search', '搜索设置', 'search'],
      ['list', '列表设置', 'listMusic'],
      ['download', '下载设置', 'download'],
      ['keys', '快捷键', 'zap'],
      ['theme', '主题', 'sun'],
      ['cardkey', '卡密登录', 'key'],
      ['admin', '管理员登录', 'shield'],
      ['perms', '权限说明', 'lock'],
      ['tray', '托盘与关闭', 'panel'],
      ['about', '关于', 'info'],
    ];
    return `
      <div class="viewhead"><h2>${icon('settings', 19)}设置</h2></div>
      <div class="settings">
        <nav class="settings__nav">
          ${CATS.map(([id, name, ic]) => `
            <button class="settings__tab${cat === id ? ' on' : ''}" data-cat="${id}">
              ${icon(ic, 15)}<span>${esc(name)}</span></button>`).join('')}
        </nav>
        <div class="settings__body">${settingPane(cat)}</div>
      </div>`;
  }

  function settingPane(cat) {
    if (cat === 'basic') {
      return `
        <div class="card">
          <div class="card__title">外观与动效</div>
          <div class="field"><label>主题颜色</label>
            <select id="set-theme">
              ${window.Theme.THEMES.map((t) => `<option value="${t.id}"${S.themePref === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
            <span class="field__val">${esc((window.Theme.byId(window.Theme.resolveId(S.themePref)) || {}).name || '')}</span>
          </div>
          <div class="field"><label>显示动画效果</label>
            <div class="seg">
              <button class="seg__b${S.anim !== false ? ' on' : ''}" data-anim="1">开启</button>
              <button class="seg__b${S.anim === false ? ' on' : ''}" data-anim="0">关闭</button>
            </div></div>
        </div>`;
    }
    if (cat === 'play') {
      return `
        <div class="card">
          <div class="card__title">播放</div>
          <div class="field"><label>优先播放的音质（如果可用）</label>
            <select id="set-quality">
              ${API.QUALITIES.map((q) => `<option value="${q.id}"${S.quality === q.id ? ' selected' : ''}>${esc(q.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label>播放模式</label>
            <select id="set-mode">
              ${API.PLAY_MODES.map((m) => `<option value="${m.id}"${P.state.mode === m.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label>倍速</label>
            <input id="set-rate" type="range" min="50" max="200" step="5" value="${Math.round(P.state.rate * 100)}"/>
            <span class="field__val" id="set-rate-val">${P.state.rate.toFixed(2)}x</span></div>
          <div class="field"><label>保持音调不变</label>
            <div class="seg">
              <button class="seg__b${P.state.preservesPitch !== false ? ' on' : ''}" data-pitch="1">开启</button>
              <button class="seg__b${P.state.preservesPitch === false ? ' on' : ''}" data-pitch="0">关闭</button>
            </div></div>
          <p class="note">音量与音频输出设备不在此处，请在底部播放栏点击音量图标打开音量面板。</p>
        </div>`;
    }
    if (cat === 'detail') {
      return `
        <div class="card">
          <div class="card__title">播放详情页</div>
          <div class="field"><label>歌词字号</label>
            <input id="set-lysize" type="range" min="12" max="30" value="${S.lySize || 17}"/>
            <span class="field__val" id="set-lysize-val">${S.lySize || 17}px</span></div>
          <div class="field"><label>缩放当前播放行</label>
            <div class="seg">
              <button class="seg__b${S.lyScale !== false ? ' on' : ''}" data-lyscale="1">开启</button>
              <button class="seg__b${S.lyScale === false ? ' on' : ''}" data-lyscale="0">关闭</button>
            </div></div>
          <div class="field"><label>歌词对齐方式</label>
            <div class="seg">
              ${[['left', '左'], ['center', '中'], ['right', '右']].map(([v, n]) =>
                `<button class="seg__b${(S.lyAlign || 'center') === v ? ' on' : ''}" data-lyalign="${v}">${n}</button>`).join('')}
            </div></div>
          <div class="field"><label>拖拽歌词调整进度</label>
            <div class="seg">
              <button class="seg__b${S.lyDrag ? ' on' : ''}" data-lydrag="1">开启</button>
              <button class="seg__b${!S.lyDrag ? ' on' : ''}" data-lydrag="0">关闭</button>
            </div></div>
        </div>`;
    }
    if (cat === 'lyric') {
      return `
        <div class="card">
          <div class="card__title">桌面歌词</div>
          <p class="note">桌面歌词为独立悬浮窗，需要单独的主进程窗口支持，当前版本尚未实现（见交付说明）。</p>
          <div class="field"><label>启用桌面歌词</label>
            <div class="seg"><button class="seg__b" disabled>开启</button><button class="seg__b on" disabled>关闭</button></div></div>
        </div>`;
    }
    if (cat === 'search') {
      return `
        <div class="card">
          <div class="card__title">搜索</div>
          <div class="field"><label>默认音源</label>
            <select id="set-platform">
              ${API.PLATFORMS.map((p) => `<option value="${p.id}"${S.platform === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label>搜索引擎</label>
            <select id="set-engine">
              <option value="lx"${S.engine === 'lx' ? ' selected' : ''}>LX 引擎（准确率高）</option>
              <option value="api"${S.engine === 'api' ? ' selected' : ''}>聚合引擎（响应更快）</option>
            </select></div>
          <div class="field"><label>搜索结果数量</label>
            <select id="set-limit">
              ${[20, 30, 50].map((n) => `<option value="${n}"${(S.limit || 30) === n ? ' selected' : ''}>${n} 条</option>`).join('')}
            </select></div>
        </div>`;
    }
    if (cat === 'list') {
      return `
        <div class="card">
          <div class="card__title">列表</div>
          <div class="field"><label>显示音质徽标</label>
            <div class="seg">
              <button class="seg__b${S.showQtag !== false ? ' on' : ''}" data-qtag="1">开启</button>
              <button class="seg__b${S.showQtag === false ? ' on' : ''}" data-qtag="0">关闭</button>
            </div></div>
          <div class="field"><label>双击自动播放</label>
            <div class="seg">
              <button class="seg__b${S.dblPlay !== false ? ' on' : ''}" data-dbl="1">开启</button>
              <button class="seg__b${S.dblPlay === false ? ' on' : ''}" data-dbl="0">关闭</button>
            </div></div>
        </div>`;
    }
    if (cat === 'download') {
      return `
        <div class="card">
          <div class="card__title">下载</div>
          <div class="field"><label>下载音质</label>
            <select id="set-dlquality">
              ${API.QUALITIES.map((q) => `<option value="${q.id}"${(S.dlQuality || S.quality) === q.id ? ' selected' : ''}>${esc(q.name)}</option>`).join('')}
            </select></div>
          <div class="field"><label>下载目录</label>
            <span class="field__val">每次下载时选择</span></div>
          <div class="field"><label>下载记录</label>
            <span class="field__val">${S.downloads.length} 条</span></div>
        </div>`;
    }
    if (cat === 'keys') {
      const KEYS = [
        ['空格', '播放 / 暂停'], ['Ctrl + ← / →', '上一曲 / 下一曲'],
        ['Ctrl + ↑ / ↓', '音量加 / 减'], ['Ctrl + F', '聚焦搜索框'],
        ['Ctrl + L', '显示 / 隐藏歌词面板'], ['Ctrl + Shift + P', '切换播放模式'],
        ['Ctrl + D', '下载当前歌曲'], ['Ctrl + A', '全选当前列表'],
        ['Delete', '从列表移除选中'], ['F11', '切换全屏'], ['Esc', '退出全屏 / 关闭弹层'],
        ['Backspace', '列表详情返回'], ['Ctrl + Enter', '搜索并立即播放'],
      ];
      return `
        <div class="card">
          <div class="card__title">快捷键（窗口聚焦时生效）</div>
          ${KEYS.map(([k, d]) => `<div class="field"><label class="kbd">${esc(k)}</label><span class="field__val">${esc(d)}</span></div>`).join('')}
          <p class="note">全局快捷键（系统级）默认关闭，避免与系统冲突。</p>
        </div>`;
    }
    if (cat === 'theme') {
      return `
        <div class="card">
          <div class="card__title">主题</div>
          <p class="note">主题采用「主题 ID + 自定义覆盖」两层结构。默认「跟随系统」，系统亮暗切换时实时响应。</p>
          <div class="themegrid">
            ${window.Theme.THEMES.map((t) => {
              const id = t.auto ? 'auto' : t.id;
              const on = S.themePref === id;
              const c = t.auto ? { bg: 'linear-gradient(135deg,#f4f8f4 50%,#141127 50%)', card: '#888', primary: '#22a05a' } : t.c;
              return `
                <button class="themecard${on ? ' on' : ''}" data-theme-pick="${id}">
                  <span class="themecard__sw" style="background:${c.bg}">
                    <i style="background:${c.primary}"></i><i style="background:${c.card}"></i>
                  </span>
                  <b>${esc(t.name)}</b>
                  <small>${esc(t.desc || (t.auto ? '亮暗自动切换' : ''))}</small>
                </button>`;
            }).join('')}
          </div>
        </div>`;
    }
    if (cat === 'cardkey') {
      const k = S.cardKey || { active: false };
      return `
        <div class="card">
          <div class="card__title">卡密登录</div>
          <p class="note">填入赞助 / VIP 卡密，解锁对应音质音乐（各页面通用，无需重复填写）。卡密只保存在本机，不会上传到别处。</p>
          ${k.active ? `
            <div class="authstatus authstatus--ok">
              <div class="authstatus__ic">${icon('check', 20)}</div>
              <div class="authstatus__tx">
                <b>${k.tier === 'vip' ? 'VIP 卡密' : '普通卡密'} · 已激活</b>
                <span>卡密 ${esc(k.masked || '')}</span>
                ${k.expireAt ? `<span>有效期至 ${esc(String(k.expireAt).slice(0, 10))}</span>` : ''}
                ${k.releaseName ? `<span>关联发行版：${esc(k.releaseName)}</span>` : ''}
              </div>
              <button class="btn btn-sm btn-ghost" data-act="cardkey-clear">退出卡密</button>
            </div>`
          : `
            <div class="field">
              <label>卡密</label>
              <input id="cardkey-input" type="password" placeholder="输入卡密" autocomplete="off" spellcheck="false"/>
              <button class="btn btn-sm" data-act="cardkey-verify">验证并激活</button>
            </div>
            <div class="authstatus authstatus--off">
              <div class="authstatus__ic">${icon('key', 20)}</div>
              <div class="authstatus__tx"><b>未激活</b><span>当前以免费权限使用</span></div>
            </div>`}
        </div>`;
    }

    if (cat === 'admin') {
      const a = S.admin || { loggedIn: false };
      return `
        <div class="card">
          <div class="card__title">管理员登录</div>
          <p class="note">管理员会话用于解锁服务端管理类接口（歌单解析、配置读取等）。登录状态保存在本机会话中，退出后即失效。</p>
          ${a.loggedIn ? `
            <div class="authstatus authstatus--ok">
              <div class="authstatus__ic">${icon('user', 20)}</div>
              <div class="authstatus__tx">
                <b>${esc(a.user && a.user.name ? a.user.name : '已登录')}</b>
                <span>角色：${esc((a.user && a.user.role) || '—')}</span>
                <span>权限项：${(a.user && a.user.permissions ? a.user.permissions.length : 0)} 项</span>
              </div>
              <button class="btn btn-sm btn-ghost" data-act="admin-logout">退出登录</button>
            </div>`
          : `
            <div class="field"><label>账号</label><input id="admin-user" type="text" placeholder="管理员账号" autocomplete="username" spellcheck="false"/></div>
            <div class="field"><label>密码</label><input id="admin-pass" type="password" placeholder="密码" autocomplete="current-password"/></div>
            <div class="field"><label></label><button class="btn btn-sm" data-act="admin-login">登录</button></div>
            <div class="authstatus authstatus--off">
              <div class="authstatus__ic">${icon('shield', 20)}</div>
              <div class="authstatus__tx"><b>未登录</b><span>管理类功能当前不可用</span></div>
            </div>`}
        </div>`;
    }

    if (cat === 'perms') {
      const rows = [
        ['搜索歌曲 / 歌手 / 专辑', 'free', '免费', 'ok'],
        ['LRC 歌词（含翻译）', 'free', '免费', 'ok'],
        ['标准 / 高品音质（128k、320k）', 'free', '免费', 'ok'],
        ['公告 / 公开统计', 'free', '免费', 'ok'],
        ['无损 / Hi-Res / 超清 / 母带', 'key', '卡密或管理员', 'warn'],
        ['歌单解析 / 导入外部歌单', 'admin', '管理员', 'warn'],
        ['服务端配置读取', 'admin', '管理员', 'warn'],
        ['后台管理（用户 / 日志 / 卡密 / 发行版 / 音源）', 'admin', '管理员', 'warn'],
      ];
      return `
        <div class="card">
          <div class="card__title">权限说明（实测）</div>
          <p class="note">以下结论来自对当前服务端的实际请求测试。免费项无需任何凭据；标「卡密」的项需先在「卡密登录」激活；标「管理员」的项需先在「管理员登录」登录。</p>
          <div class="permhead"><span>功能</span><span>所需权限</span></div>
          ${rows.map(([name, tag, label, tone]) => `
            <div class="permrow">
              <span>${esc(name)}</span>
              <em class="perm perm--${tone}">${icon(tag === 'free' ? 'check' : tag === 'key' ? 'key' : 'shield', 12)}${esc(label)}</em>
            </div>`).join('')}
          <p class="note note--sub">说明：部分高档音质即使有权限，也可能因上游音源不提供而自动回落到可用档位，属正常现象。</p>
        </div>`;
    }

    if (cat === 'tray') {
      return `
        <div class="card">
          <div class="card__title">关闭与托盘</div>
          <div class="field"><label>点击关闭按钮时</label>
            <div class="seg">
              <button class="seg__b${closePrefs.action === 'tray' ? ' on' : ''}" data-close="tray">最小化到托盘</button>
              <button class="seg__b${closePrefs.action === 'quit' ? ' on' : ''}" data-close="quit">直接退出</button>
            </div></div>
          <div class="field"><label>关闭时弹窗询问</label>
            <div class="seg">
              <button class="seg__b${closePrefs.askDisabled ? '' : ' on'}" data-ask="1">询问</button>
              <button class="seg__b${closePrefs.askDisabled ? ' on' : ''}" data-ask="0">不询问</button>
            </div></div>
          <div class="field"><label>立即隐藏到托盘</label>
            <button class="btn btn-sm" data-act="to-tray">${icon('panel', 13)}最小化</button></div>
        </div>`;
    }
    // about
    return `
      <div class="card">
        <div class="card__title">关于</div>
        <div class="about">
          <img src="assets/logo-128.png" alt=""/>
          <div class="about__info">
            <b>HYWmusic</b>
            <span>版本 v${esc(S.version)}</span>
            <span>音源服务：${esc(S.baseLabel || '默认线路')}</span>
            <span>内置音源：酷我 · 酷狗 · QQ音乐 · 网易云 · 咪咕 · 汽水</span>
            <span>音质档位：128k / 320k / FLAC 16·24·32bit / Hi-Res / 母带</span>
          </div>
        </div>
        <div class="about__links">
          <button class="btn btn-sm btn-ghost" data-act="open-site">${icon('externalLink', 13)}访问官网</button>
        </div>
        <p class="credit">Create BY BennerRock</p>
      </div>`;
  }

  /* ============================================================
     底部播放栏
     ============================================================ */

  function playerBarHtml() {
    const c = P.state.current;
    const cover = c ? coverOf(c) : '';
    const mode = API.PLAY_MODES.find((m) => m.id === P.state.mode) || API.PLAY_MODES[0];
    return `
      <footer class="pbar" id="pbar">
        <div class="pbar__left">
          <div class="pbar__cover" data-act="open-detail" title="点击展开播放详情">
            ${cover ? `<img src="${esc(thumbUrl(cover, 200))}" alt="" data-cover="1" decoding="async"/>` : icon('disc', 22)}
          </div>
          <div class="pbar__meta">
            <b id="pb-name" title="${c ? esc(c.name) : ''}">${c ? esc(c.name) : '未在播放'}</b>
            <span id="pb-singer">${c ? esc(c.singer || '未知歌手') : '选一首歌开始吧'}</span>
          </div>
          <button class="ico${isFav(c) ? ' on' : ''}" data-act="fav-cur" title="收藏">
            ${icon(isFav(c) ? 'heartFill' : 'heart', 16)}</button>
        </div>

        <div class="pbar__center">
          <div class="pbar__btns">
            <button class="ico" data-act="mode" title="${esc(mode.name)}（Ctrl+Shift+P）">${icon(mode.icon, 17)}</button>
            <button class="ico" data-act="prev" title="上一首（Ctrl+←）">${icon('skipBack', 18)}</button>
            <button class="pbar__play" data-act="toggle" title="播放 / 暂停（空格）">${icon(P.playing ? 'pause' : 'play', 18)}</button>
            <button class="ico" data-act="next" title="下一首（Ctrl+→）">${icon('skipForward', 18)}</button>
          </div>
          <div class="pbar__prog">
            <span id="pb-cur">0:00</span>
            <div class="prog" id="pb-prog"><div class="prog__buf" id="pb-buf"></div><div class="prog__bar" id="pb-bar"></div></div>
            <span id="pb-dur">0:00</span>
          </div>
        </div>

        <div class="pbar__right">
          <button class="ico" data-act="rate" title="倍速：${P.state.rate.toFixed(2)}x">
            ${icon('zap', 15)}<em>${P.state.rate.toFixed(2)}x</em></button>
          <button class="ico" data-act="volume-panel" title="音量面板">
            ${icon(P.state.muted ? 'volumeMute' : 'volume', 17)}</button>
          <button class="ico${S.lyricsOpen ? ' on' : ''}" data-act="toggle-lyrics" title="歌词（Ctrl+L）">${icon('mic', 17)}</button>
        </div>
      </footer>`;
  }

  function renderPlayerBar() {
    const old = $('#pbar');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = playerBarHtml();
    old.replaceWith(tmp.firstElementChild);
    updateProgress();
    bindPlayerBar();
  }

  /* ============================================================
     音量面板（规格 3.3：完整的弹层，不是小竖条）
     ============================================================ */

  function volumePanelHtml() {
    return `
      <div class="vpanel" id="vpanel">
        <div class="vpanel__head">
          <span>${icon('volume', 15)}音量</span>
          <button class="ico" data-act="volume-panel">${icon('x', 14)}</button>
        </div>

        <div class="vpanel__row">
          <button class="vpanel__mute" data-act="mute" title="静音 / 取消静音">
            ${icon(P.state.muted ? 'volumeMute' : 'volume', 20)}
          </button>
          <div class="vpanel__slider" id="vp-slider">
            <div class="vpanel__fill" id="vp-fill" style="width:${Math.round((P.state.muted ? 0 : P.state.volume) * 100)}%"></div>
            <div class="vpanel__knob" id="vp-knob" style="left:${Math.round((P.state.muted ? 0 : P.state.volume) * 100)}%"></div>
          </div>
          <span class="vpanel__val" id="vp-val">${Math.round((P.state.muted ? 0 : P.state.volume) * 100)}</span>
        </div>

        <div class="vpanel__devices">
          <div class="vpanel__label">输出设备</div>
          <div id="vp-devices"><div class="vpanel__empty">正在读取设备…</div></div>
        </div>
      </div>`;
  }

  function mountVolumePanel() {
    // 幂等：先清掉旧的（可能在 #app 内或 body 末尾），再挂到 body
    $$('#vpanel').forEach((el, i) => { if (i > 0 || el.closest('#app')) el.remove(); });
    if (!$('#vpanel')) document.body.insertAdjacentHTML('beforeend', volumePanelHtml());
    const panel = $('#vpanel');
    if (!panel) return;

    // 滑块拖动（mousemove/mouseup 由 bindGlobalDrag 统一处理）
    const slider = $('#vp-slider');
    if (slider) {
      slider.addEventListener('mousedown', (e) => {
        dragKind = 'vol';
        setVolumeAt(e);
        e.preventDefault();
      });
    }

    // 设备列表（竞态保护：只有最后一次请求能写入）
    const seq = ++deviceSeq;
    P.listDevices().then((devs) => {
      if (seq !== deviceSeq) return;
      const box = $('#vp-devices');
      if (!box) return;
      if (!devs.length) {
        box.innerHTML = '<div class="vpanel__empty">未检测到可切换的输出设备</div>';
        return;
      }
      box.innerHTML = devs.map((d) => `
        <button class="vdev${d.active ? ' on' : ''}" data-device="${esc(d.id)}">
          ${icon('headphones', 15)}
          <span>${esc(d.label)}</span>
          ${d.active ? icon('check', 14) : ''}
        </button>`).join('');
    });

    // 面板外点击关闭由 bindGlobalDrag 统一处理，此处不再重复注册
  }

  function syncVolumeUI() {
    const pct = Math.round((P.state.muted ? 0 : P.state.volume) * 100);
    const fill = $('#vp-fill');
    const knob = $('#vp-knob');
    const val = $('#vp-val');
    const muteBtn = $('.vpanel__mute');
    if (fill) fill.style.width = pct + '%';
    if (knob) knob.style.left = pct + '%';
    if (val) val.textContent = pct;
    if (muteBtn) muteBtn.innerHTML = icon(P.state.muted ? 'volumeMute' : 'volume', 20);
  }

  /* ============================================================
     播放详情页
     ============================================================ */

  function detailHtml() {
    return `
      <div class="detail" id="detail">
        <div class="detail__bg" id="detail-bg"></div>
        <button class="detail__close" data-act="close-detail">${icon('x', 20)}</button>
        <div class="detail__main">
          <div class="detail__left">
            <div class="detail__cover" id="detail-cover"></div>
            <div class="detail__meta">
              <b id="detail-name"></b>
              <span id="detail-singer"></span>
            </div>
          </div>
          <div class="detail__lyrics" id="detail-lyrics"></div>
        </div>
      </div>`;
  }

  function renderDetail() {
    const c = P.state.current;
    const cover = c ? coverOf(c) : '';
    const cv = $('#detail-cover');
    if (cv) {
      cv.innerHTML = cover ? `<img src="${esc(cover)}" alt="" data-cover="1" decoding="async"/>` : icon('disc', 64);
      cv.classList.toggle('spin', P.playing);
    }
    const bg = $('#detail-bg');
    if (bg) bg.style.backgroundImage = cover ? `url("${cover}")` : 'none';
    const n = $('#detail-name');
    if (n) n.textContent = c ? c.name : '未在播放';
    const sg = $('#detail-singer');
    if (sg) sg.textContent = c ? (c.singer || '') : '';
    renderDetailLyrics();
  }

  function renderDetailLyrics() {
    const box = $('#detail-lyrics');
    if (!box) return;
    if (!S.lyrics.length) {
      box.innerHTML = `<p class="ly-empty">${P.state.current ? '暂无歌词' : '未在播放'}</p>`;
      return;
    }
    box.innerHTML = S.lyrics.map((l, i) => `
      <p class="ly${i === S.lyricIndex ? ' on' : ''}" data-ly="${i}">
        <span class="ly__t">${esc(l.text)}</span>
        ${l.trans ? `<span class="ly__tr">${esc(l.trans)}</span>` : ''}
      </p>`).join('');
    box.scrollTop = 0;
    scrollLyricEl(box, false);
  }

  function scrollLyricEl(box, smooth = true) {
    const cur = box.querySelector('.ly.on');
    if (!cur) return;
    const target = cur.offsetTop - box.clientHeight / 2 + cur.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }

  /* ============================================================
     歌词 / 队列面板
     ============================================================ */

  function lyricsHtml() {
    return `
      <aside class="lyrics${S.lyricsOpen ? ' open' : ''}" id="lyrics">
        <div class="lyrics__head">
          <span>${icon('mic', 15)}歌词</span>
          <button class="ico" data-act="toggle-lyrics">${icon('x', 15)}</button>
        </div>
        <div class="lyrics__body" id="lyrics-body"></div>
      </aside>`;
  }

  function renderLyrics() {
    const body = $('#lyrics-body');
    if (!body) return;
    if (!P.state.current) { body.innerHTML = '<p class="ly-empty">未在播放</p>'; return; }
    if (!S.lyrics.length) { body.innerHTML = '<p class="ly-empty">暂无歌词</p>'; return; }
    body.innerHTML = S.lyrics.map((l, i) => `
      <p class="ly${i === S.lyricIndex ? ' on' : ''}" data-ly="${i}">
        <span class="ly__t">${esc(l.text)}</span>
        ${l.trans ? `<span class="ly__tr">${esc(l.trans)}</span>` : ''}
      </p>`).join('');
    body.scrollTop = 0;
    scrollLyricEl(body, false);
  }

  function mountQueuePanel() {
    const old = $('#qpanel');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', queuePanelHtml());
  }

  function queuePanelHtml() {
    const q = P.state.queue;
    return `
      <aside class="qpanel" id="qpanel">
        <div class="qpanel__head">
          <span>${icon('listMusic', 15)}播放队列 (${q.length})</span>
          <div>
            ${q.length ? `<button class="ico" data-act="clear-queue" title="清空">${icon('trash', 14)}</button>` : ''}
            <button class="ico" data-act="toggle-queue">${icon('x', 15)}</button>
          </div>
        </div>
        <div class="qpanel__body">
          ${q.length ? q.map((s, i) => `
            <div class="qrow${isCurrent(s) ? ' playing' : ''}" data-act="play-row" data-idx="${i}" data-q="1">
              <span class="qrow__i">${isCurrent(s) ? icon('music', 12) : i + 1}</span>
              <span class="qrow__t"><b>${esc(s.name)}</b><small>${esc(s.singer || '')}</small></span>
              <button class="ico" data-act="rm-queue" data-idx="${i}">${icon('x', 13)}</button>
            </div>`).join('') : '<p class="ly-empty">队列是空的</p>'}
        </div>
      </aside>`;
  }

  /* ============================================================
     局部更新
     ============================================================ */

  function updateProgress() {
    const cur = $('#pb-cur');
    if (!cur) return;
    const t = P.time, d = P.duration;
    cur.textContent = fmt(t);
    const dur = $('#pb-dur');
    if (dur) dur.textContent = fmt(d);
    const bar = $('#pb-bar');
    if (bar) bar.style.width = (d ? (t / d) * 100 : 0) + '%';
    const buf = $('#pb-buf');
    if (buf) {
      try { const b = P.audio.buffered; if (b.length && d) buf.style.width = (b.end(b.length - 1) / d) * 100 + '%'; } catch (_) {}
    }
    if (S.lyrics.length) {
      const i = window.LRC.findIndex(S.lyrics, t);
      if (i !== S.lyricIndex) {
        S.lyricIndex = i;
        ['#lyrics-body', '#detail-lyrics'].forEach((sel) => {
          const box = $(sel);
          if (!box) return;
          const prev = box.querySelector('.ly.on');
          if (prev) prev.classList.remove('on');
          const now = box.querySelector(`.ly[data-ly="${i}"]`);
          if (now) { now.classList.add('on'); scrollLyricEl(box); }
        });
      }
    }
  }

  function updateActiveRows() {
    const cur = P.state.current;
    $$('.row').forEach((el) => {
      if (!el.dataset.key) return;
      el.classList.toggle('playing', !!cur && el.dataset.key === songKey(cur));
    });
  }

  function updatePlayBtn() {
    const b = $('.pbar__play');
    if (b) b.innerHTML = icon(P.playing ? 'pause' : 'play', 18);
    const cv = $('#detail-cover');
    if (cv) cv.classList.toggle('spin', P.playing);
    updateActiveRows();
  }

  function renderSideCounts() {
    const counts = { trial: S.history.length, history: S.history.length, favorites: S.favorites.length, later: S.later.length, downloads: S.downloads.length };
    $$('.side__item[data-view]').forEach((b) => {
      const v = b.dataset.view;
      if (!(v in counts)) return;
      const em = b.querySelector('em');
      if (counts[v]) {
        if (em) em.textContent = counts[v];
        else b.insertAdjacentHTML('beforeend', `<em>${counts[v]}</em>`);
      } else if (em) em.remove();
    });
  }

  /* ============================================================
     事件绑定
     ============================================================ */

  /** 顶栏音源下拉已移除，音源只由内容区切换条控制；保留空实现避免调用处报错 */
  function syncPlatformSel() {}

  function bindContent() {
    const q = $('#q');
    if (q) {
      q.addEventListener('input', () => { S.query = q.value; });
      q.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doSearch(e.ctrlKey); }
      });
    }
    const bindSel = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('change', () => fn(el.value)); };
    bindSel('#sel-engine', (v) => { S.engine = v; API.storeSet({ engine: v }); if (S.query) doSearch(); });
    bindSel('#sel-quality', (v) => { S.quality = v; P.setQuality(v); API.storeSet({ quality: v }); renderPlayerBar(); });
    bindSel('#set-quality', (v) => { S.quality = v; P.setQuality(v); API.storeSet({ quality: v }); renderPlayerBar(); });
    bindSel('#set-mode', (v) => { P.setMode(v); API.storeSet({ playMode: v }); renderPlayerBar(); });
    bindSel('#set-platform', (v) => { S.platform = v; API.storeSet({ platform: v }); });
    bindSel('#set-engine', (v) => { S.engine = v; API.storeSet({ engine: v }); });
    bindSel('#set-limit', (v) => { S.limit = Number(v); API.storeSet({ limit: S.limit }); });
    bindSel('#set-dlquality', (v) => { S.dlQuality = v; API.storeSet({ dlQuality: v }); });
    bindSel('#set-theme', (v) => { S.themePref = v; API.storeSet({ themePref: v }); applyTheme(v); renderContent(); });

    const r = $('#set-rate');
    if (r) r.addEventListener('input', () => {
      P.setRate(Number(r.value) / 100);
      const v = $('#set-rate-val'); if (v) v.textContent = P.state.rate.toFixed(2) + 'x';
      API.storeSet({ rate: P.state.rate });
      renderPlayerBar();
    });
    const ls = $('#set-lysize');
    if (ls) ls.addEventListener('input', () => {
      S.lySize = Number(ls.value);
      const v = $('#set-lysize-val'); if (v) v.textContent = S.lySize + 'px';
      document.documentElement.style.setProperty('--ly-size', S.lySize + 'px');
      API.storeSet({ lySize: S.lySize });
    });

    $$('[data-cat]').forEach((b) => b.addEventListener('click', () => { S.settingCat = b.dataset.cat; renderContent(); }));
    $$('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => {
      S.themePref = b.dataset.themePick;
      API.storeSet({ themePref: S.themePref });
      applyTheme(S.themePref);
      renderContent();
    }));

    $$('[data-close]').forEach((b) => b.addEventListener('click', () => {
      closePrefs.action = b.dataset.close;
      API.setClosePrefs(closePrefs.action, closePrefs.askDisabled);
      $$('[data-close]').forEach((x) => x.classList.toggle('on', x === b));
      toast(closePrefs.action === 'tray' ? '关闭时最小化到托盘' : '关闭时直接退出', 'ok');
    }));
    $$('[data-ask]').forEach((b) => b.addEventListener('click', () => {
      closePrefs.askDisabled = b.dataset.ask === '0';
      API.setClosePrefs(closePrefs.action, closePrefs.askDisabled);
      $$('[data-ask]').forEach((x) => x.classList.toggle('on', x === b));
      toast(closePrefs.askDisabled ? '关闭时不再询问' : '关闭时会弹窗询问', 'ok');
    }));

    const li = $('#local-input');
    if (li) li.addEventListener('change', () => {
      const files = Array.from(li.files || []);
      if (!files.length) return;
      S.localFiles = S.localFiles.concat(files.map((f) => ({
        name: f.name,
        size: (f.size / 1024 / 1024).toFixed(1) + ' MB',
        file: f,
        local: true,
        songId: 'local:' + f.name,
        platform: 'local',
      })));
      toast(`已导入 ${files.length} 个文件`, 'ok');
      renderContent();
    });
  }

  function bindPlayerBar() {
    const prog = $('#pb-prog');
    if (prog) {
      prog.addEventListener('mousedown', (e) => {
        dragKind = 'prog';
        seekProgressAt(e);
        e.preventDefault();
      });
    }
    // 悬停音量按钮滚轮微调（规格 3.3）
    const volBtn = $('[data-act="volume-panel"]');
    if (volBtn) {
      volBtn.addEventListener('wheel', (e) => {
        e.preventDefault();
        P.setVolume(P.state.volume + (e.deltaY < 0 ? 0.05 : -0.05));
        API.storeSet({ volume: P.state.volume });
        syncVolumeUI();
      }, { passive: false });
    }
  }

  function seekProgressAt(e) {
    const prog = $('#pb-prog');
    if (!prog) return;
    const r = prog.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    P.seek(ratio * (P.duration || 0));
  }

  function setVolumeAt(e) {
    const slider = $('#vp-slider');
    if (!slider) return;
    const r = slider.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    P.setVolume(v);
    API.storeSet({ volume: v });
    syncVolumeUI();
  }

  /** 封面图加载失败兜底（CSP 禁止内联 onerror，改用捕获阶段监听） */
  function bindImageFallback() {
    document.addEventListener('error', (e) => {
      const el = e.target;
      if (el && el.tagName === 'IMG' && el.dataset && el.dataset.cover) {
        el.style.visibility = 'hidden';
      }
    }, true);
  }

  /** 全局拖动监听 —— 整个生命周期只注册一次 */
  function bindGlobalDrag() {
    window.addEventListener('mousemove', (e) => {
      if (dragKind === 'prog') seekProgressAt(e);
      else if (dragKind === 'vol') setVolumeAt(e);
    });
    window.addEventListener('mouseup', () => { dragKind = null; });

    // 音量面板「点外面关闭」也只注册一次
    document.addEventListener('click', (ev) => {
      if (!S.showVolume) return;
      const p = $('#vpanel');
      const btn = ev.target.closest('[data-act="volume-panel"]');
      if (p && !p.contains(ev.target) && !btn) {
        S.showVolume = false;
        p.remove();
      }
    }, true);
  }

  document.addEventListener('click', async (e) => {
    // 点击空白处收起顶栏下拉
    if (S.qMenuOpen || S.sMenuOpen) {
      const inside = e.target.closest('#qdrop') || e.target.closest('#sdrop');
      if (!inside) { S.qMenuOpen = false; S.sMenuOpen = false; render(); return; }
    }

    const platBtn = e.target.closest('[data-plat]');
    if (platBtn) {
      S.platform = platBtn.dataset.plat;
      API.storeSet({ platform: S.platform });
      if (S.query) doSearch();
      else { renderContent(); syncPlatformSel(); }
      return;
    }

    const cat = e.target.closest('[data-cat]');
    if (cat) return; // 由 bindContent 处理

    const sideView = e.target.closest('[data-view]');
    if (sideView) { S.view = sideView.dataset.view; render(); return; }

    const plCard = e.target.closest('[data-pl]');
    if (plCard && !e.target.closest('[data-act]')) {
      S.view = 'playlist'; S.currentPlaylist = plCard.dataset.pl; render(); return;
    }

    const dev = e.target.closest('[data-device]');
    if (dev) {
      const r = await P.setDevice(dev.dataset.device);
      if (r && r.ok) { toast('已切换输出设备', 'ok'); mountVolumePanelRefresh(); }
      else toast((r && r.error) || '切换失败', 'err');
      return;
    }

    // 音质下拉项
    const qp = e.target.closest('[data-qpick]');
    if (qp) {
      S.quality = qp.dataset.qpick;
      S.qMenuOpen = false;
      P.setQuality(S.quality);
      API.storeSet({ quality: S.quality });
      toast('音质：' + API.qualityName(S.quality) + '（拿不到会自动降级）');
      render();
      return;
    }

    // 服务端下拉项：只按序号切换，渲染进程不持有真实地址
    const sp = e.target.closest('[data-spick]');
    if (sp) {
      const i = Number(sp.dataset.spick) || 0;
      const r = await API.setServer(i);
      S.serverIdx = i;
      const p2 = S.serverPresets[i];
      S.serverLabel = (p2 && (p2.name || p2.label)) || presetLabel(p2);
      S.serverFull = (r && r.label) || S.serverLabel;
      S.sMenuOpen = false;
      toast('已切换到 ' + S.serverLabel);
      render();
      return;
    }

    const ly = e.target.closest('[data-ly]');
    if (ly && !e.target.closest('[data-act]')) {
      const i = Number(ly.dataset.ly);
      if (S.lyrics[i] && S.lyDrag) P.seek(S.lyrics[i].time);
      else if (S.lyrics[i]) P.seek(S.lyrics[i].time);
      return;
    }

    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;
    const idx = Number(actEl.dataset.idx);
    const list = currentList();

    if (act === 'do-search') return doSearch();
    // 错误页的「重试」：强制绕过缓存重新请求
    if (act === 'retry-search') return doSearch(false, true);
    if (act === 'clear-q') { S.query = ''; renderContent(); return; }

    if (act === 'play-row') { playFrom(actEl.dataset.q ? P.state.queue : list, idx); return; }
    if (act === 'play-all') { if (list.length) playFrom(list, 0); return; }
    if (act === 'play-local') { const f = S.localFiles[idx]; if (f) playLocal(f, S.localFiles, idx); return; }
    if (act === 'play-pl') { const pl = S.playlists.find((p) => p.id === S.currentPlaylist); if (pl && pl.songs.length) playFrom(pl.songs, 0); return; }
    if (act === 'pick-local') { const i = $('#local-input'); if (i) i.click(); return; }
    if (act === 'clear-local') { S.localFiles = []; renderContent(); return; }
    if (act === 'clear-downloads') { S.downloads = []; saveDownloads(); renderContent(); renderSideCounts(); return; }

    if (act === 'fav') { toggleFav(list[idx]); return; }
    if (act === 'fav-cur') { toggleFav(P.state.current); return; }
    if (act === 'menu') { openSongMenu(list[idx], actEl); return; }

    if (act === 'toggle') { P.toggle(); return; }
    if (act === 'next') { P.next(); return; }
    if (act === 'prev') { P.prev(); return; }
    if (act === 'mute') { P.toggleMute(); syncVolumeUI(); renderPlayerBar(); return; }

    if (act === 'cardkey-verify') {
      const el = $('#cardkey-input');
      const r = await API.cardKeyVerify(el ? el.value : '');
      if (r && r.ok) { S.cardKey = { active: true, masked: (r.info.key || '').slice(0, 3) + '****' + (r.info.key || '').slice(-3), tier: r.info.tier, expireAt: r.info.expireAt, releaseName: r.info.releaseName }; toast('卡密已激活', 'ok'); }
      else toast((r && r.error) || '验证失败', 'err');
      renderContent();
      return;
    }
    if (act === 'cardkey-clear') {
      await API.cardKeyClear();
      S.cardKey = { active: false };
      toast('已退出卡密', 'ok');
      renderContent();
      return;
    }
    if (act === 'admin-login') {
      const u = $('#admin-user'), pw = $('#admin-pass');
      toast('正在登录…');
      const r = await API.adminLogin(u ? u.value : '', pw ? pw.value : '');
      if (r && r.ok) { S.admin = { loggedIn: true, user: r.user }; toast('登录成功：' + r.user.name, 'ok'); }
      else toast((r && r.error) || '登录失败', 'err');
      renderContent();
      return;
    }
    if (act === 'admin-logout') {
      await API.adminLogout();
      S.admin = { loggedIn: false, user: null };
      toast('已退出登录', 'ok');
      renderContent();
      return;
    }

    if (act === 'volume-panel') {
      S.showVolume = !S.showVolume;
      if (S.showVolume) mountVolumePanel();
      else { $$('#vpanel').forEach((el) => el.remove()); }
      return;
    }

    if (act === 'quality-menu') { S.qMenuOpen = !S.qMenuOpen; S.sMenuOpen = false; render(); return; }
    if (act === 'server-menu') { S.sMenuOpen = !S.sMenuOpen; S.qMenuOpen = false; render(); return; }
    if (act === 'server-custom') {
      // 唯一需要用户输入真实地址的入口；输入结果直接交给主进程，不写入 S
      const u = prompt('请输入服务端 API 地址（仅本地保存，界面不会显示）', '');
      if (!u) return;
      const r = await API.setServer(u);
      S.serverLabel = (r && r.label) || '自定义线路';
      S.sMenuOpen = false;
      toast('已切换到 ' + S.serverLabel);
      render();
      return;
    }
    if (act === 'server-test') {
      toast('正在测试连接…');
      const r = await API.testServer(S.serverIdx);
      toast(r && r.ok ? '连接正常：' + (r.label || S.serverLabel) : '连接失败：' + ((r && r.error) || '未知错误'), r && r.ok ? 'ok' : 'err');
      return;
    }

    if (act === 'open-detail') { S.detailOpen = true; render(); return; }
    if (act === 'close-detail') { S.detailOpen = false; render(); return; }

    if (act === 'rate') {
      const opts = [0.5, 0.75, 1, 1.25, 1.5, 2];
      const ni = (opts.indexOf(P.state.rate) + 1) % opts.length;
      P.setRate(opts[ni]);
      API.storeSet({ rate: P.state.rate });
      renderPlayerBar();
      toast('倍速：' + P.state.rate.toFixed(2) + 'x');
      return;
    }
    if (act === 'mode') {
      const order = API.PLAY_MODES.map((m) => m.id);
      const ni = (order.indexOf(P.state.mode) + 1) % order.length;
      P.setMode(order[ni]);
      API.storeSet({ playMode: order[ni] });
      renderPlayerBar();
      toast('播放模式：' + API.PLAY_MODES[ni].name);
      return;
    }

    if (act === 'toggle-lyrics') {
      S.lyricsOpen = !S.lyricsOpen;
      const el = $('#lyrics');
      if (el) el.classList.toggle('open', S.lyricsOpen);
      if (S.lyricsOpen) { if (!S.lyrics.length) loadLyrics(P.state.current); else renderLyrics(); }
      renderPlayerBar();
      return;
    }
    if (act === 'toggle-queue') {
      S.showQueue = !S.showQueue;
      if (S.showQueue) mountQueuePanel();
      else { const o = $('#qpanel'); if (o) o.remove(); }
      return;
    }
    if (act === 'clear-queue') { P.clearQueue(); mountQueuePanel(); renderContent(); return; }
    if (act === 'rm-queue') { P.removeFromQueue(P.state.queue[idx]); mountQueuePanel(); renderContent(); return; }

    if (act === 'new-playlist') {
      const name = prompt('新建列表名称', `列表 ${S.playlists.length + 1}`);
      if (!name) return;
      const pl = { id: 'pl-' + Date.now().toString(36), name: name.slice(0, 20), songs: [] };
      S.playlists.push(pl); savePlaylists();
      S.view = 'playlist'; S.currentPlaylist = pl.id; render();
      return;
    }
    if (act === 'rename-pl') {
      const pl = S.playlists.find((p) => p.id === S.currentPlaylist);
      if (!pl) return;
      const name = prompt('重命名列表', pl.name);
      if (!name) return;
      pl.name = name.slice(0, 20); savePlaylists(); render();
      return;
    }
    if (act === 'delete-pl') {
      const pl = S.playlists.find((p) => p.id === S.currentPlaylist);
      if (!pl) return;
      if (!confirm(`确定删除列表「${pl.name}」？`)) return;
      S.playlists = S.playlists.filter((p) => p.id !== pl.id);
      savePlaylists(); S.view = 'playlists'; S.currentPlaylist = null; render();
      return;
    }
    if (act === 'clear-list') {
      const which = actEl.dataset.list;
      if (which === '试听列表') { S.history = []; LS.set('hyw-history', []); }
      else if (which === '我的收藏') { S.favorites = []; LS.set('hyw-favorites', []); }
      else if (which === '稍后播放') { S.later = []; LS.set('hyw-later', []); }
      else if (which === '历史记录') { S.history = []; LS.set('hyw-history', []); }
      renderContent(); renderSideCounts();
      return;
    }
    if (act === 'open-site') {
      // 官网入口：任何时候都直接打开（地址由主进程拼接，渲染层不持有真实 IP）
      const r = await API.openSite().catch(() => null);
      if (!r || !r.ok) toast('打开官网失败，请稍后重试', 'err');
      return;
    }
    if (act === 'to-tray') { API.minimizeToTray(); return; }
    if (act === 'dl-song') { downloadSong(actEl.dataset.k); return; }
  });

  function mountVolumePanelRefresh() {
    const box = $('#vp-devices');
    if (!box) return;
    const seq = ++deviceSeq;
    P.listDevices().then((devs) => {
      if (seq !== deviceSeq) return;
      box.innerHTML = devs.length
        ? devs.map((d) => `
            <button class="vdev${d.active ? ' on' : ''}" data-device="${esc(d.id)}">
              ${icon('headphones', 15)}<span>${esc(d.label)}</span>${d.active ? icon('check', 14) : ''}
            </button>`).join('')
        : '<div class="vpanel__empty">未检测到可切换的输出设备</div>';
    });
  }

  function currentList() {
    const pl = S.view === 'playlist' ? S.playlists.find((p) => p.id === S.currentPlaylist) : null;
    return {
      search: S.results,
      favorites: S.favorites,
      trial: S.history,
      history: S.history,
      later: S.later,
      queue: P.state.queue,
      local: S.localFiles,
      playlist: pl ? pl.songs : [],
    }[S.view] || [];
  }

  /* ============================================================
     业务
     ============================================================ */

  async function doSearch(playFirst, forceRefresh) {
    const kw = (S.query || '').trim();
    if (!kw) { toast('请输入搜索关键词'); return; }

    const limit = S.limit || 30;
    const cacheKey = `${kw}|${S.platform}|${S.engine}|${limit}`;

    S.view = 'search'; S.error = ''; S.results = [];
    const token = ++searchToken;

    // 命中缓存：直接出结果，不再等网络
    if (!forceRefresh) {
      const hit = searchCache.get(cacheKey);
      if (hit && Date.now() - hit.t < SEARCH_TTL) {
        S.loading = false;
        S.results = hit.data;
        S.resultMeta = hit.meta;
        if (playFirst && S.results.length) { renderContent(); playFrom(S.results, 0); return; }
        renderContent();
        return;
      }
    }

    S.loading = true;
    render();

    try {
      const res = await API.search({ keyword: kw, platform: S.platform, mode: S.engine, limit });
      if (res && res.ok) {
        const ranked = rankSongs(res.data || [], kw);
        const meta = res.mode === 'api' ? '聚合引擎' : 'LX 引擎';
        S.results = ranked;
        S.resultMeta = meta;
        // 写入缓存（超上限时淘汰最早的一条）
        if (searchCache.size >= SEARCH_CACHE_MAX) {
          const oldest = searchCache.keys().next().value;
          searchCache.delete(oldest);
        }
        searchCache.set(cacheKey, { t: Date.now(), data: ranked, meta });
      } else {
        S.error = (res && res.error) || '搜索失败';
      }
    } catch (err) {
      const msg = String((err && err.message) || err || '');
      const clean = msg.replace(/^Error invoking remote method '[^']+':\s*/, '');
      if (/超时|timeout/i.test(msg)) {
        S.error = '搜索超时：服务端响应较慢，请点「重试」，或换个关键词';
      } else if (/net::|ERR_|ENOTFOUND|ECONN/i.test(msg)) {
        S.error = '无法连接到服务器，请检查网络或在「服务器」里更换线路';
      } else {
        S.error = '搜索失败：' + (clean || '请稍后重试');
      }
    } finally {
      S.loading = false;
    }

    if (playFirst && S.results.length) { renderContent(); playFrom(S.results, 0); return; }
    renderContent();

    // 首屏已出，后台再探测可播性并微调顺序（不阻塞）
    if (S.results.length) probeAndRerank(kw, token);
  }

  async function loadLyrics(song) {
    if (!song || song.local) { S.lyrics = []; S.lyricIndex = -1; renderLyrics(); renderDetailLyrics(); return; }
    S.lyrics = []; S.lyricIndex = -1;
    renderLyrics(); renderDetailLyrics();
    const res = await API.lyrics({
      platform: song.platform, songId: song.songId,
      name: song.name, singer: song.singer, duration: song.duration,
    });
    if (!res || !res.ok) { renderLyrics(); renderDetailLyrics(); return; }
    const main = window.LRC.parseLrc(res.data.lyrics);
    const trans = window.LRC.parseLrc(res.data.translation || '');
    S.lyrics = window.LRC.mergeTranslation(main, trans);
    S.lyricIndex = -1;
    renderLyrics(); renderDetailLyrics();
  }

  async function downloadSong(key) {
    const song = [...S.results, ...S.history, ...S.favorites].find((x) => songKey(x) === key);
    if (!song) return;
    const q = S.dlQuality || S.quality;
    const res = await API.playUrl({
      platform: song.platform, songId: song.songId, quality: API.apiQuality(q),
      name: song.name, singer: song.singer,
    });
    if (!res || !res.ok) { toast('取链失败：' + ((res && res.error) || ''), 'err'); return; }
    toast('开始下载…');
    const r = await API.download({
      url: res.data.url,
      name: `${song.name} - ${song.singer || '未知歌手'}`,
      ext: API.extOf(q),
    });
    if (r && r.ok) {
      toast('已保存到：' + r.path, 'ok');
      S.downloads = [{ name: `${song.name} - ${song.singer || ''}`, quality: API.qualityName(q), path: r.path, time: new Date().toLocaleString('zh-CN') }, ...S.downloads].slice(0, 200);
      saveDownloads(); renderSideCounts();
      if (S.view === 'downloads') renderContent();
    } else if (r && !r.canceled) toast((r && r.error) || '下载失败', 'err');
  }

  function closeSongMenu() {
    const m = $('#songmenu');
    if (m) m.remove();
    if (songMenuCloser) {
      document.removeEventListener('click', songMenuCloser);
      songMenuCloser = null;
    }
  }

  function openSongMenu(song, anchor) {
    if (!song) return;
    closeSongMenu();
    const fav = isFav(song);
    const menu = document.createElement('div');
    menu.id = 'songmenu';
    menu.className = 'smenu';
    menu.innerHTML = `
      <button data-m="play">${icon('play', 15)}立即播放</button>
      <button data-m="next">${icon('queue', 15)}下一首播放</button>
      <button data-m="later">${icon('clock', 15)}稍后播放</button>
      <button data-m="fav">${icon(fav ? 'heartFill' : 'heart', 15)}${fav ? '取消收藏' : '收藏'}</button>
      <div class="smenu__sep"></div>
      <div class="smenu__label">加入列表</div>
      ${S.playlists.length
        ? S.playlists.map((p) => `<button data-m="pl" data-pl="${esc(p.id)}">${icon('folder', 15)}${esc(p.name)}</button>`).join('')
        : `<button data-m="newpl">${icon('plus', 15)}新建列表并加入</button>`}
      <div class="smenu__sep"></div>
      <button data-m="dl" data-k="${esc(songKey(song))}">${icon('download', 15)}下载</button>
      <button data-m="copy">${icon('externalLink', 15)}复制歌曲信息</button>
    `;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth || 190, mh = menu.offsetHeight || 300;
    menu.style.left = Math.max(8, Math.min(r.left - mw + 30, window.innerWidth - mw - 12)) + 'px';
    menu.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - mh - 12)) + 'px';
    const close = (ev) => { if (!menu.contains(ev.target)) closeSongMenu(); };
    songMenuCloser = close;
    setTimeout(() => { if (songMenuCloser === close) document.addEventListener('click', close); }, 0);
    menu.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-m]');
      if (!b) return;
      const m = b.dataset.m;
      closeSongMenu();
      if (m === 'play') P.playSong(song);
      if (m === 'next') { P.addToQueue(song, true); toast('已设为下一首播放', 'ok'); }
      if (m === 'later') addLater(song);
      if (m === 'fav') toggleFav(song);
      if (m === 'pl') addToPlaylist(b.dataset.pl, song);
      if (m === 'newpl') {
        const name = prompt('新建列表名称', `列表 ${S.playlists.length + 1}`);
        if (name) {
          const pl = { id: 'pl-' + Date.now().toString(36), name: name.slice(0, 20), songs: [song] };
          S.playlists.push(pl); savePlaylists(); toast(`已加入「${pl.name}」`, 'ok'); renderSideCounts();
        }
      }
      if (m === 'dl') downloadSong(b.dataset.k);
      if (m === 'copy') {
        try { await navigator.clipboard.writeText(`${song.name} - ${song.singer || ''}`); toast('已复制', 'ok'); }
        catch (_) { toast('复制失败', 'err'); }
      }
    });
  }

  function applyTheme(pref) {
    S.themePref = pref || S.themePref;
    window.Theme.apply(S.themePref);
    try { localStorage.setItem('hyw-theme', S.themePref); } catch (_) {}
  }

  /* ============================================================
     播放器事件
     ============================================================ */

  function hookPlayer() {
    P.on('song', (song) => {
      renderPlayerBar();
      updateActiveRows();
      if (S.detailOpen) renderDetail();
      if (song) { pushHistory(song); renderSideCounts(); loadLyrics(song); }
    });
    P.on('state', () => updatePlayBtn());
    P.on('time', () => updateProgress());
    P.on('volume', () => { syncVolumeUI(); renderPlayerBar(); });
    P.on('device', () => {});
    P.on('rate', () => renderPlayerBar());
    P.on('queue', () => {
      renderSideCounts();
      if (S.showQueue) mountQueuePanel();
      if (S.view === 'queue') renderContent();
    });
    P.on('error', (msg) => toast(msg, 'err'));
    P.on('notice', (n) => toast(n.text, n.type));
    P.on('ended-all', () => toast('播放列表已播完'));
  }

  /* ============================================================
     快捷键（规格 8.1）
     ============================================================ */

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      const typing = /input|textarea|select/i.test(e.target.tagName || '');

      if (e.key === 'Escape') {
        if (S.detailOpen) { S.detailOpen = false; render(); return; }
        if (S.showVolume) { S.showVolume = false; const p = $('#vpanel'); if (p) p.remove(); return; }
        closeSongMenu();
        if (document.fullscreenElement) document.exitFullscreen();
        return;
      }
      if (e.key === 'F11') { e.preventDefault(); document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); return; }
      if (e.key === 'Backspace' && !typing) { if (S.view === 'playlist') { S.view = 'playlists'; render(); } return; }

      if (typing) return;

      if (e.code === 'Space') { e.preventDefault(); P.toggle(); return; }
      if (e.ctrlKey && e.key === 'ArrowRight') { e.preventDefault(); P.next(); return; }
      if (e.ctrlKey && e.key === 'ArrowLeft') { e.preventDefault(); P.prev(); return; }
      if (e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); P.setVolume(P.state.volume + 0.05); syncVolumeUI(); renderPlayerBar(); return; }
      if (e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); P.setVolume(P.state.volume - 0.05); syncVolumeUI(); renderPlayerBar(); return; }
      if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); const q = $('#q'); if (q) { q.focus(); q.select(); } return; }
      if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); S.lyricsOpen = !S.lyricsOpen; const el = $('#lyrics'); if (el) el.classList.toggle('open', S.lyricsOpen); if (S.lyricsOpen && !S.lyrics.length) loadLyrics(P.state.current); renderPlayerBar(); return; }
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        const order = API.PLAY_MODES.map((m) => m.id);
        const ni = (order.indexOf(P.state.mode) + 1) % order.length;
        P.setMode(order[ni]); API.storeSet({ playMode: order[ni] }); renderPlayerBar();
        toast('播放模式：' + API.PLAY_MODES[ni].name);
        return;
      }
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); if (P.state.current) downloadSong(songKey(P.state.current)); return; }
    });
  }

  /* ============================================================
     启动
     ============================================================ */

  async function boot() {
    // 关键数据并行取：原来多个 IPC 串行 await 是启动慢的主因
    const [info, stRaw, cp, srv] = await Promise.all([
      API.info().catch(() => null),
      API.storeGet().catch(() => null),
      API.closePrefs().catch(() => null),
      API.getServer().catch(() => null),
    ]);
    const st = stRaw || {};

    if (info) { S.version = info.version; S.baseLabel = info.baseLabel || ''; }
    S.themePref = st.themePref || 'auto';
    if (st.quality) S.quality = st.quality;
    // 搜索默认「全部」音源：不恢复上次选择，避免用户下次打开只剩单平台
    S.platform = 'all';
    if (st.engine) S.engine = st.engine;
    if (st.playMode) P.setMode(st.playMode);
    if (typeof st.volume === 'number') P.setVolume(st.volume);
    if (typeof st.rate === 'number') P.setRate(st.rate);
    if (typeof st.limit === 'number') S.limit = st.limit;
    if (st.dlQuality) S.dlQuality = st.dlQuality;
    if (st.lySize) { S.lySize = st.lySize; document.documentElement.style.setProperty('--ly-size', S.lySize + 'px'); }
    if (typeof st.anim === 'boolean') S.anim = st.anim;
    if (typeof st.showQtag === 'boolean') S.showQtag = st.showQtag;
    if (typeof st.dblPlay === 'boolean') S.dblPlay = st.dblPlay;
    if (typeof st.lyScale === 'boolean') S.lyScale = st.lyScale;
    if (st.lyAlign) S.lyAlign = st.lyAlign;
    if (typeof st.lyDrag === 'boolean') S.lyDrag = st.lyDrag;
    closePrefs = cp || { action: 'tray', askDisabled: false };

    // 服务端线路：只取展示别名，渲染进程不保存真实地址
    if (srv) {
      S.serverPresets = srv.preset || [];
      // 主进程已比对过本地配置，直接告知当前命中哪个预设（-1 = 自定义地址）
      S.serverIdx = typeof srv.index === 'number' ? srv.index : 0;
      const cur = S.serverPresets[S.serverIdx] || S.serverPresets[0];
      // 顶栏只显示短名（如 hywmusic），完整别名放到 tooltip，避免下拉过宽
      S.serverLabel = (cur && (cur.name || cur.label)) || srv.alias || '默认线路';
      S.serverFull = srv.label || srv.alias || '';
    }

    applyTheme(S.themePref);
    hookPlayer();
    bindImageFallback();
    bindGlobalDrag();
    render();
    bindKeys();

    // 跟随系统：系统亮暗变化时实时切换
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (S.themePref === 'auto') { applyTheme('auto'); renderContent(); }
      });
    }

    API.onVisibility(({ hidden }) => {
      document.documentElement.classList.toggle('is-hidden', hidden);
    });

    // 启动耗时标记（诊断用，无副作用）
    try { window.__bootMs = Math.round(performance.now()); } catch (_) {}

    // 首屏已渲染，尽快收起启动动画（150ms 让首帧稳定，避免闪烁）
    setTimeout(() => {
      const b = $('#boot');
      if (b) { b.classList.add('hide'); setTimeout(() => b.remove(), 400); }
    }, 150);

    // 登录态不影响首屏，后台补（打开设置页时已有值）
    API.cardKeyStatus().then((k) => { S.cardKey = k || { active: false }; }).catch(() => {});
    API.adminSession().then((as) => {
      S.admin = as && as.loggedIn ? { loggedIn: true, user: as.user } : { loggedIn: false, user: null };
    }).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
