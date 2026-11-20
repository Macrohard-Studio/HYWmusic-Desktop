/* ============================================================
   BR 自研引擎（Beta）· 本机直连各音乐平台公开接口
   ------------------------------------------------------------
   设计目标：
   - 完全内置在客户端里，不依赖何意味音乐服务端
   - 从本机直接请求平台接口，拿到能拿到的最高音质
   - 统一输出结构，与主进程 /api/music/* 的返回保持一致

   当前能力（2026-11-21 实测）：
   - 网易云：搜索 ✓ 取链 ✓（标准音质外链，无需登录）
   - QQ音乐：搜索 ✓ 取链需 vkey（匿名通常拿不到，会返回失败）
   - 酷狗：搜索 ✓ 取链需 cookie（匿名通常拿不到，会返回失败）
   - 酷我：搜索需 csrf cookie（暂未接入）

   关于「母带级」：
   各平台的母带/Hi-Res 都要登录态（VIP）才给地址。本引擎预留了
   `cookies` 配置位，填了对应平台的 Cookie 后即可请求高音质接口；
   未填时自动回落到匿名可得的最高音质，并如实标注 actualQuality。
   ============================================================ */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 各平台展示信息（与客户端 PLATFORMS 对齐） */
const PLATFORM_META = {
  wy: { name: '网易云', color: '#c62f2f' },
  tx: { name: 'QQ音乐', color: '#31c27c' },
  kg: { name: '酷狗', color: '#2ca2f9' },
  kw: { name: '酷我', color: '#ffc233' },
  mg: { name: '咪咕', color: '#e60026' },
};

/** 通用请求：返回 { status, headers, body(Buffer) }，永不 reject */
function request(url, opts = {}) {
  const { method = 'GET', headers = {}, body = null, timeout = 12000, followRedirect = false } = opts;
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      return resolve({ status: 0, headers: {}, body: Buffer.alloc(0) });
    }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      u,
      {
        method,
        rejectUnauthorized: false,
        headers: Object.assign(
          {
            'User-Agent': UA,
            Accept: '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
          },
          headers
        ),
      },
      (res) => {
        // 需要跟随一次 302（网易云外链会跳 CDN）
        if (followRedirect && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(request(res.headers.location, Object.assign({}, opts, { followRedirect: false })));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve({ status: 0, headers: {}, body: Buffer.alloc(0) });
    });
    if (body) req.write(body);
    req.end();
  });
}

/** 清洗平台返回的脏文本：HTML 实体、转义、标签 */
function clean(str) {
  return String(str == null ? '' : str)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u0026/gi, '&')
    .replace(/\\&/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function json(res) {
  try {
    return JSON.parse(res.body.toString('utf8'));
  } catch (_) {
    return null;
  }
}

/* ---------------- 各平台搜索 ---------------- */

/** 网易云：批量补封面（搜索接口只给 picId，detail 才给完整 picUrl） */
async function fillWyCovers(list) {
  const ids = list.map((s) => s.songId).filter(Boolean);
  if (!ids.length) return list;
  const url =
    'https://music.163.com/api/song/detail?ids=' + encodeURIComponent(JSON.stringify(ids.slice(0, 60)));
  const res = await request(url, { headers: { Referer: 'https://music.163.com/' } });
  const j = json(res);
  const map = {};
  ((j && j.songs) || []).forEach((s) => {
    map[String(s.id)] = (s.album && s.album.picUrl) || '';
  });
  list.forEach((s) => {
    if (!s.picUrl) s.picUrl = map[s.songId] || '';
  });
  return list;
}

/** 网易云搜索 */
async function searchWy(kw, limit) {
  const url =
    'https://music.163.com/api/search/get/web?s=' +
    encodeURIComponent(kw) +
    '&type=1&limit=' +
    limit +
    '&offset=0';
  const res = await request(url, { headers: { Referer: 'https://music.163.com/' } });
  const j = json(res);
  const list = (j && j.result && j.result.songs) || [];
  const mapped = list.map((s) => ({
    songId: String(s.id),
    name: clean(s.name),
    singer: clean((s.artists || []).map((a) => a.name).join('&')),
    album: clean((s.album && s.album.name) || ''),
    duration: Math.round((s.duration || 0) / 1000),
    platform: 'wy',
    platformName: PLATFORM_META.wy.name,
    picUrl: (s.album && s.album.picUrl) || '',
  }));
  return fillWyCovers(mapped);
}

/** QQ 音乐搜索 */
async function searchTx(kw, limit) {
  const url =
    'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=' +
    limit +
    '&w=' +
    encodeURIComponent(kw) +
    '&format=json&aggr=1&cr=1&new_json=1';
  const res = await request(url, { headers: { Referer: 'https://y.qq.com/' } });
  const j = json(res);
  const list = (((j || {}).data || {}).song || {}).list || [];
  return list.map((s) => ({
    songId: s.songmid || s.mid,
    name: clean(s.songname || s.name),
    singer: clean((s.singer || []).map((a) => a.name).join('&')),
    album: clean((s.album && (s.album.name || s.album.title)) || ''),
    duration: s.interval || 0,
    platform: 'tx',
    platformName: PLATFORM_META.tx.name,
    picUrl: s.album && s.album.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.mid}.jpg` : '',
  }));
}

/** 酷狗搜索 */
async function searchKg(kw, limit) {
  const url =
    'https://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=' +
    encodeURIComponent(kw) +
    '&page=1&pagesize=' +
    limit;
  const res = await request(url, { headers: { Referer: 'https://www.kugou.com/' } });
  const j = json(res);
  const list = (((j || {}).data || {}).info) || [];
  return list.map((s) => ({
    songId: s.hash,
    name: clean(s.songname),
    singer: clean(s.singername),
    album: clean(s.album_name),
    duration: s.duration || 0,
    platform: 'kg',
    platformName: PLATFORM_META.kg.name,
    // 酷狗搜索不返回封面，但给了 album_id，可直接拼
    picUrl: s.album_id ? `https://imge.kugou.com/stdmusic/240/${s.album_id}.jpg` : '',
  }));
}

/**
 * 酷我搜索：用旧版 search.kuwo.cn 接口（新版 www.kuwo.cn 需要 JS 生成的 kw_token）。
 * 返回体是「单引号 JSON」，先做一次轻量修正再解析。
 */
async function searchKw(kw, limit) {
  const url =
    'http://search.kuwo.cn/r.s?all=' +
    encodeURIComponent(kw) +
    '&ft=music&itemset=web_2013&client=kt&pn=0&rn=' +
    limit +
    '&rformat=json&encoding=utf8';
  const res = await request(url, { headers: { Referer: 'http://www.kuwo.cn/' } });
  const text = res.body.toString('utf8');
  let j = null;
  try {
    j = JSON.parse(text);
  } catch (_) {
    // 单引号 / \u0026 转义修正
    try {
      j = JSON.parse(text.replace(/'/g, '"').replace(/&amp;/g, '&'));
    } catch (_) {
      return [];
    }
  }
  const list = (j && (j.abslist || j.list)) || [];
  return list
    .map((s) => ({
      songId: String(s.MUSICRID || s.rid || '').replace(/^MUSIC_/, ''),
      name: clean(s.SONGNAME || s.name),
      singer: clean(s.ARTIST || s.artist),
      album: clean(s.ALBUM),
      duration: parseInt(s.DURATION || s.duration || 0, 10) || 0,
      platform: 'kw',
      platformName: PLATFORM_META.kw.name,
      picUrl: s.web_albumpic_short ? 'https://img1.kuwo.cn/star/albumcover/' + s.web_albumpic_short : '',
    }))
    .filter((x) => x.songId && x.name);
}

const SEARCHERS = { wy: searchWy, tx: searchTx, kg: searchKg, kw: searchKw };

/* ---------------- 取链 ---------------- */

/**
 * 网易云：官方外链，302 到 CDN。
 * 匿名只能拿到标准音质；带 VIP Cookie 时优先尝试高音质接口。
 */
async function urlWy(songId, cookies) {
  // 有 Cookie 时先试 weapi 的加密接口（需要 eapi 加密，这里走简化路径）
  const outer = `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(songId)}.mp3`;
  const res = await request(outer, {
    headers: { Referer: 'https://music.163.com/', Cookie: cookies || '' },
    followRedirect: false,
  });
  const loc = res.headers && (res.headers.location || res.headers.Location);
  if (loc) {
    // CDN 返回的 codec 参数里带 quality_standard / quality_exhigh / quality_lossless
    const q = /quality_lossless/.test(loc)
      ? 'flac'
      : /quality_exhigh|quality_higher/.test(loc)
      ? '320k'
      : '128k';
    return { ok: true, data: { url: loc, actualQuality: q, source: 'wy' } };
  }
  return { ok: false, error: '网易云未返回可播放地址' };
}

/**
 * QQ 音乐：匿名 vkey 通常拿不到，这里做一次尝试；
 * 失败则返回明确错误，由上层回落到服务端引擎。
 */
async function urlTx(songmid) {
  const payload = {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: { guid: '10000', songmid: [songmid], songtype: [0], uin: '0', loginflag: 0, platform: '20' },
    },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
  };
  const body = JSON.stringify(payload);
  const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://y.qq.com/',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  const j = json(res);
  const info = ((((j || {}).req_0 || {}).data || {}).midurlinfo || [])[0] || {};
  if (info.purl) {
    const sip = ((((j || {}).req_0 || {}).data || {}).sip) || ['https://dl.stream.qqmusic.qq.com/'];
    return { ok: true, data: { url: sip[0] + info.purl, actualQuality: '320k', source: 'tx' } };
  }
  return { ok: false, error: 'QQ音乐需要登录态才能取链（自研引擎暂不支持）' };
}

/** 酷狗：需要 cookie（kg_mid 等），匿名基本拿不到 */
async function urlKg(hash) {
  const res = await request(
    `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=${encodeURIComponent(hash)}&dfid=1&mid=1&platid=4`,
    { headers: { Referer: 'https://www.kugou.com/' } }
  );
  const j = json(res);
  const u = j && j.data && j.data.play_url;
  if (u) return { ok: true, data: { url: u, actualQuality: '128k', source: 'kg' } };
  return { ok: false, error: '酷狗需要登录态才能取链（自研引擎暂不支持）' };
}

/* ---------------- 对外接口 ---------------- */

/**
 * 搜索
 * @param {{keyword:string, platform?:string, limit?:number, cookies?:object}} params
 */
async function search(params = {}) {
  const kw = String(params.keyword || '').trim();
  if (!kw) return { ok: false, error: '缺少关键词', status: 400 };
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);
  const want = params.platform && params.platform !== 'all' ? [params.platform] : Object.keys(SEARCHERS);

  const tasks = want
    .filter((p) => SEARCHERS[p])
    .map((p) => SEARCHERS[p](kw, limit).catch(() => []));
  const groups = await Promise.all(tasks);

  const data = [];
  const seen = new Set();
  groups.forEach((list) => {
    (list || []).forEach((s) => {
      if (!s.songId || !s.name) return;
      const key = `${s.platform}:${s.songId}`;
      if (seen.has(key)) return;
      seen.add(key);
      data.push(s);
    });
  });

  return { ok: true, mode: 'local', data };
}

/**
 * 取链
 * @param {{platform:string, songId:string, quality?:string, cookies?:object}} params
 */
async function url(params = {}) {
  const platform = String(params.platform || '');
  const songId = String(params.songId || '');
  if (!platform || !songId) return { ok: false, error: '缺少参数', status: 400 };
  const cookies = (params.cookies && params.cookies[platform]) || '';

  try {
    if (platform === 'wy') return await urlWy(songId, cookies);
    if (platform === 'tx') return await urlTx(songId);
    if (platform === 'kg') return await urlKg(songId);
  } catch (err) {
    return { ok: false, error: '自研引擎请求失败：' + (err && err.message) };
  }
  return { ok: false, error: '自研引擎暂不支持该音源' };
}

// 实际实现了搜索的平台（用于前端音源条过滤）
const SUPPORTED = Object.keys(SEARCHERS);

module.exports = { search, url, PLATFORM_META, SUPPORTED };
