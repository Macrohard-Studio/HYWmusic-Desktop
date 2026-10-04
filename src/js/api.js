/* ============================================================
   接口封装 + 平台 / 音质 / 播放模式定义
   ============================================================ */

(function () {
  const bridge = window.hyw;

  /**
   * 内置音源。
   * 原始锁定清单（规格 11.2）：kw 酷我 / kg 酷狗 / tx QQ音乐 / wy 网易云 / mg 咪咕；
   * 后追加「汽水音乐（qz）」，与其余五源并列。
   */
  const PLATFORMS = [
    { id: 'all', name: '全部', short: 'ALL', color: '#8b93a7' },
    { id: 'wy', name: '网易云', short: 'WY', color: '#e8484a' },
    { id: 'tx', name: 'QQ音乐', short: 'TX', color: '#31c27c' },
    { id: 'kg', name: '酷狗', short: 'KG', color: '#2ba3f0' },
    { id: 'kw', name: '酷我', short: 'KW', color: '#ffb400' },
    { id: 'mg', name: '咪咕', short: 'MG', color: '#ff5c8a' },
    { id: 'qz', name: '汽水', short: 'QZ', color: '#00c2b3' },
  ];

  /**
   * 音质档位（规格 11.2.1）—— 按「格式 + 位深」区分，不再细分采样率 / 码率。
   * api 字段为传给服务端的实际取值。
   */
  /**
   * 音质档位 —— 命名对齐平台习惯（「XX音质」+ 皇冠等级），
   * 在原有档位基础上**新增**「超清」与「母带」，不删除任何已有档位。
   * api  = 传给服务端的取值
   * tier = 皇冠等级 1..4，仅用于界面展示
   */
  const QUALITIES = [
    { id: 'master', name: '母带', api: 'master', ext: 'flac', tier: 4, desc: '母带级 Master' },
    { id: 'atmos', name: '超清', api: 'atmos', ext: 'flac', tier: 4, desc: '超清音质' },
    { id: 'hires', name: 'Hi-Res音质', api: 'hires', ext: 'flac', tier: 3, desc: '高解析无损' },
    { id: 'flac32bit', name: '无损音质 32bit', api: 'flac32bit', ext: 'flac', tier: 3, desc: 'FLAC 32bit' },
    { id: 'flac24bit', name: '无损音质 24bit', api: 'flac24bit', ext: 'flac', tier: 3, desc: 'FLAC 24bit' },
    { id: 'flac16bit', name: '无损音质', api: 'flac', ext: 'flac', tier: 3, desc: 'FLAC 16bit · CD 级' },
    { id: '320k', name: '高品音质', api: '320k', ext: 'mp3', tier: 2, desc: '320kbps' },
    { id: '128k', name: '标准音质', api: '128k', ext: 'mp3', tier: 1, desc: '128kbps' },
  ];

  /**
   * 音质降级链：所选档位拿不到时，自动向下取最高可用档位（不报错、不空播）。
   * 实测 flac32bit 服务端会返回 400，必须靠这条链兜底。
   */
  const QUALITY_FALLBACK = {
    master: ['master', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '128k'],
    atmos: ['atmos', 'hires', 'flac24bit', 'flac', '320k', '128k'],
    hires: ['hires', 'flac24bit', 'flac', '320k', '128k'],
    flac32bit: ['flac32bit', 'flac24bit', 'flac', '320k', '128k'],
    flac24bit: ['flac24bit', 'flac', '320k', '128k'],
    flac16bit: ['flac', '320k', '128k'],
    '320k': ['320k', '128k'],
    '128k': ['128k'],
  };

  const PLAY_MODES = [
    { id: 'list', name: '列表循环', icon: 'repeat' },
    { id: 'one', name: '单曲循环', icon: 'repeatOne' },
    { id: 'order', name: '顺序播放', icon: 'listMusic' },
    { id: 'random', name: '随机播放', icon: 'shuffle' },
  ];

  /** 某档位的降级尝试序列（返回服务端取值数组） */
  function qualityChain(id) {
    const chain = QUALITY_FALLBACK[id] || [apiQuality(id)];
    return chain.map((x) => apiQuality(x));
  }

  /** 音质 id -> 服务端取值 */
  function apiQuality(id) {
    const q = QUALITIES.find((x) => x.id === id);
    return q ? q.api : '320k';
  }
  /** 音质 id -> 下载扩展名 */
  function extOf(id) {
    const q = QUALITIES.find((x) => x.id === id);
    return q ? q.ext : 'mp3';
  }
  function platformOf(id) {
    return PLATFORMS.find((p) => p.id === id) || { id, name: id, short: '?', color: '#8b93a7' };
  }
  function qualityName(id) {
    const q = QUALITIES.find((x) => x.id === id);
    return q ? q.name : id;
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  window.API = {
    PLATFORMS,
    QUALITIES,
    PLAY_MODES,
    apiQuality,
    qualityChain,
    extOf,
    platformOf,
    qualityName,
    fmtTime,

    info: () => bridge.info(),
    storeGet: () => bridge.storeGet(),
    storeSet: (patch) => bridge.storeSet(patch),
    openExternal: (url) => bridge.openExternal(url),
    setTheme: (t, bg) => bridge.setTheme(t, bg),
    getServer: () => bridge.getServer(),
    setServer: (u) => bridge.setServer(u),
    testServer: (u) => bridge.testServer(u),
    closePrefs: () => bridge.closePrefs(),
    setClosePrefs: (a, d) => bridge.setClosePrefs(a, d),
    minimizeToTray: () => bridge.minimizeToTray(),
    onVisibility: (cb) => bridge.onVisibility(cb),

    search: (params) => bridge.search(params),
    playUrl: (params) => bridge.playUrl(params),
    lyrics: (params) => bridge.lyrics(params),
    playlist: (params) => bridge.playlist(params),
    config: () => bridge.config(),
    download: (params) => bridge.download(params),
  };
})();
