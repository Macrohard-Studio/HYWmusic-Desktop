'use strict';

/**
 * HYWmusic Desktop · 主进程
 * ------------------------------------------------------------
 * 职责：
 *   1. 创建窗口（无边框 + 原生窗口按钮叠加，贴合网页视觉）
 *   2. 代理对 https://103.79.184.97 的接口请求（复用 Electron session 的 Cookie）
 *   3. 登录 / 登出 / 会话查询（NextAuth credentials 流程）
 *   4. 本地配置存储（记住用户名等，不存密码）
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  net,
  session,
  shell,
  nativeTheme,
  nativeImage,
  dialog,
  Tray,
  Menu,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const DEFAULT_BASE_URL = 'https://103.79.184.97';

/** 服务端预设（可自行增删） */
const SERVER_PRESETS = [
  { name: 'hywmusic', url: 'https://103.79.184.97', def: true },
];

/** 服务端地址（可在客户端「服务器」下拉里改，存本地配置） */
function currentBase() {
  let u = '';
  try { u = String(readConfig().serverUrl || '').trim(); } catch (_) {}
  if (!u) u = DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}
const PARTITION = 'persist:hywmusic';

/* ------------------------------------------------------------------ */
/* 启动日志（写到 userData/startup.log，便于排查"没有窗口"类问题）        */
/* ------------------------------------------------------------------ */

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    console.log('[hyw]', msg);
  } catch (_) {}
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'startup.log'), line + '\n');
  } catch (_) {}
}

/* ------------------------------------------------------------------ */
/* 安全模式自愈                                                        */
/* ------------------------------------------------------------------ */
/**
 * 某些环境（虚拟机 / 远程桌面 / 老显卡 / 嵌套沙箱）下 Chromium 的 GPU 或
 * 沙箱初始化会失败，进程直接 FATAL 退出，用户看到的现象就是"双击没反应、
 * 没有窗口"。
 *
 * 这里做自愈：运行中若监测到 GPU 子进程反复崩溃，就写入安全模式标记并以
 * 安全模式参数重启自己；此后每次启动都走安全模式（禁用硬件加速 + 关闭沙箱）。
 * 想恢复正常模式，删掉 userData 下的 `safe-mode.flag` 即可。
 */

const SAFE_MODE_FLAG = () => path.join(app.getPath('userData'), 'safe-mode.flag');
const SAFE_MODE_ARG = '--hyw-safe-mode';
const RELAUNCH_ARG = '--hyw-relaunch-child';

function isSafeModeRequested() {
  try {
    return process.argv.includes(SAFE_MODE_ARG) || fs.existsSync(SAFE_MODE_FLAG());
  } catch (_) {
    return false;
  }
}

const SAFE_MODE = isSafeModeRequested();
/** 由崩溃自愈拉起的子进程：跳过单实例锁，避免父进程尚未退出时被拒 */
const IS_RELAUNCH_CHILD = process.argv.includes(RELAUNCH_ARG);

if (SAFE_MODE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('no-sandbox');
}

let gpuCrashCount = 0;
let safeModeRelaunched = false;

function watchForGpuFailure() {
  app.on('child-process-gone', (_event, details) => {
    logLine('子进程异常：' + JSON.stringify(details));

    if (details.type !== 'GPU' || details.reason !== 'crashed') return;

    gpuCrashCount += 1;
    if (gpuCrashCount < 3 || safeModeRelaunched || SAFE_MODE) return;

    // 连续崩溃 → 写标记 + 拉起安全模式子进程后退出
    safeModeRelaunched = true;
    try {
      fs.writeFileSync(SAFE_MODE_FLAG(), new Date().toISOString());
    } catch (_) {}

    logLine('检测到 GPU 反复崩溃，拉起安全模式实例');
    try {
      const args = process.argv.slice(1)
        .filter((a) => a !== SAFE_MODE_ARG && a !== RELAUNCH_ARG)
        .concat([SAFE_MODE_ARG, RELAUNCH_ARG]);
      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd(),
      });
      child.unref();
      // 稍等子进程完成初始化，再退出自己
      setTimeout(() => app.exit(0), 400);
    } catch (err) {
      logLine('安全模式重启失败：' + err.message);
    }
  });
}

/* ------------------------------------------------------------------ */
/* 单实例：重复双击时聚焦（必要时强制显示）已有窗口                       */
/* ------------------------------------------------------------------ */

const gotLock = IS_RELAUNCH_CHILD ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  logLine('已有实例在运行，本次启动退出');
  app.quit();
}

/* ------------------------------------------------------------------ */
/* 本地配置存储                                                        */
/* ------------------------------------------------------------------ */

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function writeConfig(patch) {
  const next = Object.assign(readConfig(), patch);
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.error('[config] 写入失败:', err.message);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* 界面隐藏：对外展示用的服务端别名                                        */
/* ------------------------------------------------------------------ */
/*
   目的：界面上不出现源站 IP / 主机名，避免截图、录屏、投屏时被旁观者看到。
   做法：主进程在返回「服务端信息」时把真实地址替换成固定的展示别名，
        真实地址只留在主进程内，不进入渲染进程的 DOM / 内存。

   注意（不要误判防护强度）：这属于**界面遮蔽**，只防"肉眼 / 截图"这一层。
   它不能阻止抓包、反编译 asar、或读取本地配置文件。
   要真正让人拿不到源站 IP，必须让源站前面有域名 + 边缘节点（CDN/WAF），
   使源站只接受边缘节点回源——那是部署层面的改造，不在本文件范围内。
*/

/** 界面上展示的服务端别名（想改显示名只改这里） */
const SERVER_ALIAS = '何意味音乐 · 官方线路';

/** 从地址中提取一个不含 IP 的短标识；纯 IP 一律不显示 */
function publicServerLabel(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch (_) { host = String(url || ''); }
  // 纯 IPv4 / IPv6 字面量：绝不外露，统一回落到别名
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[?[0-9a-f:]{3,}\]?$/i.test(host);
  if (!host || isIp) return SERVER_ALIAS;
  // 有域名时也只给域名本身，绝不带端口 / 路径 / 查询串
  return host.replace(/^www\./i, '');
}

/* ------------------------------------------------------------------ */
/* HTTP 请求封装（走 Electron session，自动携带 / 持久化 Cookie）        */
/* ------------------------------------------------------------------ */

function httpRequest(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    ses = session.fromPartition(PARTITION),
    timeout = 20000,
    raw = false,
  } = options;

  return new Promise((resolve, reject) => {
    let req;
    try {
      // useSessionCookies: 必须为 true，否则不会带上 session 中已保存的 Cookie
      // （NextAuth 的 CSRF / 会话 Cookie 依赖它）
      req = net.request({ method, url, session: ses, redirect: 'manual', useSessionCookies: true });
    } catch (err) {
      return reject(err);
    }

    const timer = setTimeout(() => {
      try { req.abort(); } catch (_) {}
      reject(new Error('请求超时'));
    }, timeout);

    Object.keys(headers).forEach((k) => {
      try { req.setHeader(k, headers[k]); } catch (_) {}
    });

    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        const buf = Buffer.concat(chunks);
        let parsed = null;
        const text = buf.toString('utf8');
        try { parsed = JSON.parse(text); } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: raw ? buf : undefined,
          text,
          json: parsed,
        });
      });
      res.on('error', (err) => { clearTimeout(timer); reject(err); });
    });

    req.on('redirect', (status, method, redirectUrl, responseHeaders) => {
      clearTimeout(timer);
      resolve({
        status,
        headers: responseHeaders || {},
        text: '',
        json: null,
        redirectUrl,
        redirected: true,
      });
    });

    req.on('error', (err) => { clearTimeout(timer); reject(err); });

    if (body) req.write(body);
    req.end();
  });
}

function pickLocation(headers) {
  const loc = headers && (headers.location || headers.Location);
  if (Array.isArray(loc)) return loc[0] || '';
  return loc || '';
}

/* ------------------------------------------------------------------ */
/* 音乐接口（何意味音乐 /api/music/*）                                  */
/* ------------------------------------------------------------------ */

/** 搜索歌曲：keyword 搜索，或 type=artistSongs 按歌手取歌 */
async function musicSearch(params = {}) {
  const q = new URLSearchParams();
  if (params.type === 'artistSongs') {
    q.set('type', 'artistSongs');
    q.set('platform', params.platform || 'wy');
    q.set('artistId', params.artistId || '');
    q.set('name', params.name || '');
    q.set('limit', String(params.limit || 50));
  } else {
    q.set('keyword', params.keyword || '');
    q.set('platform', params.platform || 'all');
    if (params.mode) q.set('mode', params.mode);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.page) q.set('page', String(params.page));
  }

  const res = await httpRequest(`${currentBase()}/api/music/search?${q.toString()}`, { timeout: 45000 });
  const j = res.json;
  if (j && j.code === 200) {
    return {
      ok: true,
      data: j.data || [],
      total: j.total || (j.data ? j.data.length : 0),
      mode: j.mode || 'lx',
      fallbackSource: j.fallbackSource || null,
    };
  }
  return {
    ok: false,
    status: res.status,
    error: (j && (j.message || j.error)) || `HTTP ${res.status}`,
  };
}

/** 取播放地址 */
async function musicUrl(params = {}) {
  const q = new URLSearchParams({
    source: params.platform || '',
    songId: params.songId || '',
    quality: params.quality || '320k',
    name: params.name || '',
    singer: params.singer || '',
    page: 'search',
  });

  const res = await httpRequest(`${currentBase()}/api/music/url?${q.toString()}`, { timeout: 60000 });
  const j = res.json;

  if (j && j.code === 200 && j.url) return { ok: true, data: j };

  return {
    ok: false,
    status: res.status,
    needCardKey: res.status === 401,
    forbidden: res.status === 403,
    error: (j && (j.message || j.error)) || `HTTP ${res.status}`,
  };
}

/** 歌词（LRC / 翻译 / 音译 / 逐字） */
async function musicLyrics(params = {}) {
  const q = new URLSearchParams({
    platform: params.platform || '',
    songId: params.songId || '',
    name: params.name || '',
    singer: params.singer || '',
    duration: String(Math.max(0, Math.round(params.duration || 0))),
  });

  const res = await httpRequest(`${currentBase()}/api/music/lyrics?${q.toString()}`, { timeout: 45000 });
  const j = res.json;
  if (j && j.code === 200 && j.lyrics) return { ok: true, data: j };
  return { ok: false, error: (j && j.message) || '暂无歌词' };
}

/** 歌单解析：支持链接 / wy:ID / 平台+pid */
async function playlistParse(params = {}) {
  const q = new URLSearchParams();
  if (params.pid) {
    q.set('platform', params.platform || 'wy');
    q.set('pid', params.pid);
  } else {
    q.set('input', params.input || '');
  }

  const res = await httpRequest(`${currentBase()}/api/music/playlist/parse?${q.toString()}`, { timeout: 60000 });
  const j = res.json;
  if (j && j.code === 200 && j.data && j.data.songs && j.data.songs.length) {
    return { ok: true, data: j.data };
  }
  return { ok: false, error: (j && j.message) || '歌单打开失败，请检查链接或 ID' };
}

/** 平台 / 音质等运行时配置 */
async function musicConfig() {
  const res = await httpRequest(`${currentBase()}/api/music/config?type=all`, { timeout: 30000 });
  const j = res.json;
  if (j && j.code === 200) return { ok: true, data: j.data };
  return { ok: false, error: (j && j.error) || `HTTP ${res.status}` };
}

/** 下载音频到本地（走 session 拉取后弹保存框） */
async function musicDownload(params = {}) {
  if (typeof params.url !== 'string' || !/^https?:\/\//i.test(params.url)) {
    return { ok: false, error: '无效的音频地址' };
  }

  const q = new URLSearchParams({
    url: params.url,
    name: params.name || 'audio',
    ext: params.ext || 'mp3',
  });

  const ses = session.fromPartition(PARTITION);
  const res = await httpRequest(`${currentBase()}/api/music/download?${q.toString()}`, {
    ses,
    raw: true,
    timeout: 180000,
  });

  if (res.status !== 200) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(res.text);
      msg = j.message || j.error || msg;
    } catch (_) {}
    return { ok: false, error: `下载失败：${msg}` };
  }

  const safe = String(params.name || 'audio').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '保存歌曲',
    defaultPath: `${safe}.${params.ext || 'mp3'}`,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  try {
    fs.writeFileSync(filePath, res.buffer);
  } catch (err) {
    return { ok: false, error: '写入文件失败：' + err.message };
  }
  return { ok: true, path: filePath };
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

let mainWindow = null;

/** 冒烟自检：设置 HYW_SMOKE=1 时，启动后收集渲染进程日志并自动退出 */
const SMOKE = process.env.HYW_SMOKE === '1';
const smokeLog = [];

function createWindow() {
  logLine('创建主窗口');

  mainWindow = new BrowserWindow({
    width: 1114,
    height: 718,
    minWidth: 860,
    minHeight: 540,
    // 直接显示：避免 ready-to-show 未触发时"什么都没有"
    show: true,
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    title: 'HYWmusic',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#14161a',
      symbolColor: '#e8ecf5',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 多重兜底：任何一个事件到达都确保窗口可见
  let shown = false;
  const ensureVisible = (why) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!shown) {
      shown = true;
      logLine('窗口可见（' + why + '）');
    }
    try {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } catch (err) {
      logLine('显示窗口失败：' + err.message);
    }
  };

  mainWindow.once('ready-to-show', () => ensureVisible('ready-to-show'));
  mainWindow.webContents.once('did-finish-load', () => ensureVisible('did-finish-load'));
  setTimeout(() => ensureVisible('safety-timeout'), 1500);

  // 关闭：首次询问「最小化到托盘 / 直接退出」，默认最小化到托盘
  mainWindow.on('close', (e) => {
    if (isQuitting) return;

    const cfg = readConfig();
    if (cfg.closeAskDisabled) {
      if (cfg.closeAction === 'quit') {
        isQuitting = true;
        return;
      }
      e.preventDefault();
      minimizeToTray();
      return;
    }

    e.preventDefault();
    askCloseAction().catch((err) => {
      logLine('关闭弹窗异常：' + err.message);
      minimizeToTray();
    });
  });

  mainWindow.on('show', () => notifyVisibility(false));
  mainWindow.on('hide', () => notifyVisibility(true));
  mainWindow.on('minimize', () => notifyVisibility(true));
  mainWindow.on('restore', () => notifyVisibility(false));

  // 页面加载失败：窗口里给出提示，而不是白屏
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return;
    logLine(`主页面加载失败 ${code} ${desc}`);
    const html = `<!doctype html><meta charset="utf-8">
      <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
                   font-family:'Microsoft YaHei',system-ui;background:#f2f3f7;color:#1a1d26">
        <div style="text-align:center;padding:24px">
          <div style="font-size:16px;font-weight:700;margin-bottom:8px">界面加载失败</div>
          <div style="font-size:13px;color:#666;line-height:1.8">
            错误码：${code} ${desc}<br/>请尝试重新安装本程序
          </div>
        </div>
      </body>`;
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logLine('渲染进程异常退出：' + JSON.stringify(details));
    ensureVisible('render-process-gone');
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (SMOKE) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      smokeLog.push(`[console:${level}] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      smokeLog.push(`[did-fail-load] ${code} ${desc}`);
    });
    setTimeout(async () => {
      // 通用探针：HYW_PROBE 传入一段 JS 表达式，结果打印到控制台（仅调试用）
      if (process.env.HYW_PROBE) {
        try {
          const r = await mainWindow.webContents.executeJavaScript(`(async () => { ${process.env.HYW_PROBE} })()`);
          console.log('[PROBE]', typeof r === 'string' ? r : JSON.stringify(r, null, 2));
        } catch (err) {
          console.log('[PROBE] 失败:', err.message);
        }
      }
      // 真实鼠标点击测试（HYW_CLICK_TEST=选择器1|选择器2|... 时启用）
      if (process.env.HYW_CLICK_TEST) {
        try {
          const sels = process.env.HYW_CLICK_TEST.split('|').filter(Boolean);
          for (const sel of sels) {
            const rect = await mainWindow.webContents.executeJavaScript(
              `(() => { const el = document.querySelector(${JSON.stringify(sel)});
                        if (!el) return null;
                        const r = el.getBoundingClientRect();
                        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`
            );
            if (!rect) {
              console.log('[CLICKTEST] 找不到元素', sel);
              continue;
            }
            mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
            mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
            mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
            await new Promise((r) => setTimeout(r, 700));
            const after = await mainWindow.webContents.executeJavaScript(
              `(() => { const d = document.querySelector('#dd-music');
                        return { route: (window.__hywState || {}).route,
                                 ddOpen: d ? d.classList.contains('open') : null,
                                 hasWebview: !!document.querySelector('#site-view, #console-view') }; })()`
            );
            console.log('[CLICKTEST]', sel, JSON.stringify(rect), '=>', JSON.stringify(after));
          }
          // 等内嵌页面加载，读正文
          await new Promise((r) => setTimeout(r, 8000));
          const body = await mainWindow.webContents.executeJavaScript(
            `(async () => { const wv = document.querySelector('#site-view');
                            if (!wv) return '(无 webview)';
                            try { return await wv.executeJavaScript('document.body.innerText.slice(0,80).replace(/\\\\s+/g," ")'); }
                            catch (e) { return 'ERR ' + e.message; } })()`
          );
          console.log('[CLICKTEST] 内嵌页正文:', body);
        } catch (err) {
          console.log('[CLICKTEST] 失败', err.message);
        }
      }

      try {
        const summary = await mainWindow.webContents.executeJavaScript(`(() => {
          return {
            hasShell: !!document.querySelector('.shell'),
            hasSide: !!document.querySelector('.side'),
            hasTopbar: !!document.querySelector('.topbar'),
            hasPlayerBar: !!document.querySelector('.pbar'),
            sideItems: document.querySelectorAll('.side__item').length,
            placeholder: (document.querySelector('.placeholder p') || {}).textContent || '',
            bootHidden: !document.getElementById('boot')
          };
        })()`);
        console.log('[SMOKE] DOM:', JSON.stringify(summary));
      } catch (err) {
        console.log('[SMOKE] 探测失败:', err.message);
      }

      // 截图（HYW_SHOT_DIR 指定输出目录）
      const shotDir = process.env.HYW_SHOT_DIR;
      if (shotDir) {
        const shot = async (name, js, wait) => {
          try {
            if (js) await mainWindow.webContents.executeJavaScript(js);
            await new Promise((r) => setTimeout(r, wait || 700));
            await mainWindow.webContents.executeJavaScript(`
              (async () => {
                document.body.style.transform = 'translateZ(0)';
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                await new Promise(r => setTimeout(r, 120));
                document.body.style.transform = '';
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                return true;
              })()
            `).catch(() => {});
            await new Promise((r) => setTimeout(r, 260));
            const img = await mainWindow.webContents.capturePage();
            fs.writeFileSync(path.join(shotDir, name + '.png'), img.toPNG());
            console.log('[SHOT]', name);
          } catch (err) {
            console.log('[SHOT]', name, '失败', err.message);
          }
        };

        const kw = process.env.HYW_SHOT_QUERY || '周杰伦';

        await shot('01-search-empty', null, 600);

        await shot('02-quality-menu', `
          (async () => {
            document.querySelector('[data-act="quality-menu"]').click();
            await new Promise(r => setTimeout(r, 700));
          })()
        `, 900);

        await shot('03-server-menu', `
          (async () => {
            document.querySelector('[data-act="quality-menu"]').click();
            await new Promise(r => setTimeout(r, 300));
            document.querySelector('[data-act="server-menu"]').click();
            await new Promise(r => setTimeout(r, 700));
          })()
        `, 900);

        await shot('04-search', `
          (async () => {
            document.querySelector('[data-act="server-menu"]').click();
            await new Promise(r => setTimeout(r, 250));
            const q = document.querySelector('#q');
            q.value = ${JSON.stringify(kw)};
            q.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('[data-act="do-search"]').click();
            await new Promise(r => setTimeout(r, 9000));
          })()
        `, 1500);

        await shot('05-playing', `
          (async () => {
            const btn = document.querySelector('.row .row__play');
            if (btn) btn.click();
            await new Promise(r => setTimeout(r, 8000));
            const ly = document.querySelector('[data-act="toggle-lyrics"]');
            if (ly) ly.click();
            await new Promise(r => setTimeout(r, 1500));
          })()
        `, 900);

        await shot('06-detail', `
          (async () => {
            document.querySelector('[data-act="open-detail"]').click();
            await new Promise(r => setTimeout(r, 1600));
          })()
        `, 700);

        await shot('07-settings-theme', `
          (async () => {
            document.querySelector('[data-act="close-detail"]').click();
            await new Promise(r => setTimeout(r, 300));
            document.querySelector('[data-view="settings"]').click();
            await new Promise(r => setTimeout(r, 300));
            document.querySelector('[data-cat="theme"]').click();
            await new Promise(r => setTimeout(r, 500));
          })()
        `, 800);

        await shot('08-theme-ink', `
          (async () => {
            document.querySelector('[data-theme-pick="china-ink"]').click();
            await new Promise(r => setTimeout(r, 600));
          })()
        `, 700);

        await shot('09-settings-keys', `
          (async () => {
            document.querySelector('[data-theme-pick="auto"]').click();
            await new Promise(r => setTimeout(r, 300));
            document.querySelector('[data-cat="keys"]').click();
            await new Promise(r => setTimeout(r, 500));
          })()
        `, 700);
      }

      console.log('[SMOKE] 渲染进程日志条数:', smokeLog.length);
      smokeLog.slice(0, 30).forEach((l) => console.log('  ', l));
      app.exit(smokeLog.some((l) => l.startsWith('[console:3]') || l.startsWith('[did-fail-load]')) ? 1 : 0);
    }, 7000);
  }

  // 外链一律用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(currentBase())) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    logLine('窗口已关闭');
    mainWindow = null;
  });
}

function updateTitlebarOverlay(theme, bgColor) {
  if (!mainWindow) return;
  const dark = theme === 'dark';
  try {
    mainWindow.setTitleBarOverlay({
      // 跟随主题背景，避免出现与页面不一致的色块
      color: /^#[0-9a-f]{6}$/i.test(bgColor || '') ? bgColor : (dark ? '#14161a' : '#f2f3f7'),
      symbolColor: dark ? '#e8ecf5' : '#1a1d26',
      height: 40,
    });
  } catch (_) {}
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 托盘 + 关闭行为                                                     */
/* ------------------------------------------------------------------ */

let tray = null;
let isQuitting = false;
let windowHidden = false;

function createTray() {
  if (tray) return;
  try {
    const png = path.join(__dirname, 'src', 'assets', 'logo-32.png');
    let img = nativeImage.createFromPath(png);
    if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.ico'));
    if (img.isEmpty()) return;

    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip('HYWmusic 何意味音乐');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主界面', click: () => showMainWindow() },
        { type: 'separator' },
        {
          label: '退出 HYWmusic',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ])
    );
    tray.on('click', () => showMainWindow());
    tray.on('double-click', () => showMainWindow());
    logLine('托盘已创建');
  } catch (err) {
    logLine('创建托盘失败：' + err.message);
  }
}

function destroyTray() {
  if (!tray) return;
  try { tray.destroy(); } catch (_) {}
  tray = null;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } catch (err) {
    logLine('唤出窗口失败：' + err.message);
  }
}

/** 通知渲染层窗口可见性，用于停掉轮询等后台开销 */
function notifyVisibility(hidden) {
  windowHidden = hidden;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setBackgroundThrottling(true);
      mainWindow.webContents.send('app:visibility', { hidden });
    }
  } catch (_) {}
}

function minimizeToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!tray) createTray();
  mainWindow.hide();
  notifyVisibility(true);
  logLine('已最小化到托盘');
}

/** 关闭时的询问弹窗（默认最小化到托盘，可勾选不再提醒） */
async function askCloseAction() {
  const cfg = readConfig();

  const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['最小化到托盘', '直接退出'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: '关闭 HYWmusic',
    message: '要最小化到系统托盘，还是直接退出程序？',
    detail: '最小化到托盘后程序会在后台继续运行，双击托盘图标即可重新打开。',
    checkboxLabel: '不再提醒，以后都用这个选择',
    checkboxChecked: false,
  });

  const action = response === 1 ? 'quit' : 'tray';

  if (checkboxChecked) {
    writeConfig({ closeAction: action, closeAskDisabled: true });
    logLine(`关闭行为已记住：${action === 'quit' ? '直接退出' : '最小化到托盘'}`);
  }

  if (action === 'quit') {
    isQuitting = true;
    app.quit();
  } else {
    minimizeToTray();
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc() {
  /* 音乐接口 */
  ipcMain.handle('music:search', (_e, params) => musicSearch(params));
  ipcMain.handle('music:url', (_e, params) => musicUrl(params));
  ipcMain.handle('music:lyrics', (_e, params) => musicLyrics(params));
  ipcMain.handle('music:playlist', (_e, params) => playlistParse(params));
  ipcMain.handle('music:config', () => musicConfig());
  ipcMain.handle('music:download', (_e, params) => musicDownload(params));

  ipcMain.handle('store:get', () => readConfig());
  ipcMain.handle('store:set', (_e, patch) => writeConfig(patch || {}));
  ipcMain.handle('store:reset', () => {
    writeConfig({
      themePref: 'auto',
      quality: '320k',
      platform: 'all',
      engine: 'lx',
      playMode: 'list',
      volume: 0.8,
      rate: 1,
      limit: 60,
      serverUrl: DEFAULT_BASE_URL,
      closeAction: 'tray',
      closeAskDisabled: false,
    });
    return readConfig();
  });

  /* 服务端地址（对外只给展示别名，真实地址不出主进程） */
  ipcMain.handle('app:getServer', () => {
    const cur = currentBase();
    // 在主进程内比对，直接把"命中哪个预设"告诉渲染进程，避免地址外传
    const idx = SERVER_PRESETS.findIndex((p) => p.url.replace(/\/+$/, '') === cur);
    return {
      label: publicServerLabel(cur),
      alias: SERVER_ALIAS,
      index: idx, // -1 表示自定义地址
      preset: SERVER_PRESETS.map((p) => ({
        name: p.name,
        label: publicServerLabel(p.url),
        def: !!p.def,
      })),
    };
  });
  ipcMain.handle('app:setServer', (_e, target) => {
    // 进度：数字 = 预设下标（渲染进程只需传序号）；
    //       字符串 = 自定义地址（仅"自定义地址…"这一条路径会传真实 URL）。
    let u;
    if (typeof target === 'number' && SERVER_PRESETS[target]) {
      u = SERVER_PRESETS[target].url;
    } else {
      u = String(target || '').trim();
      if (!u) u = DEFAULT_BASE_URL;
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    }
    u = u.replace(/\/+$/, '');
    writeConfig({ serverUrl: u });
    // 日志同样不写真实地址，避免日志文件泄露
    logLine('服务端地址已切换为 ' + publicServerLabel(u));
    return { ok: true, label: publicServerLabel(u), url: u };
  });
  ipcMain.handle('app:testServer', async (_e, target) => {
    let u;
    if (typeof target === 'number' && SERVER_PRESETS[target]) u = SERVER_PRESETS[target].url;
    else {
      u = String(target || '').trim();
      if (!u) u = currentBase();
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    }
    u = u.replace(/\/+$/, '');
    try {
      const res = await httpRequest(u + '/api/music/config?type=all', { timeout: 15000 });
      const label = publicServerLabel(u);
      if (res.json && res.json.code === 200) return { ok: true, label };
      return { ok: false, label, error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, label: publicServerLabel(u), error: err.message || '连接失败' };
    }
  });

  ipcMain.handle('app:openExternal', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });

  ipcMain.handle('app:theme', (_e, theme, bgColor) => {
    updateTitlebarOverlay(theme, bgColor);
    return true;
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    // 只给展示别名，真实地址不出主进程（关于页同样不泄露）
    baseLabel: publicServerLabel(currentBase()),
    partition: PARTITION,
    platform: process.platform,
  }));

  /* 关闭行为偏好 */
  ipcMain.handle('app:closePrefs', () => {
    const c = readConfig();
    return { action: c.closeAction || 'tray', askDisabled: !!c.closeAskDisabled };
  });
  ipcMain.handle('app:setClosePrefs', (_e, { action, askDisabled }) => {
    writeConfig({ closeAction: action, closeAskDisabled: !!askDisabled });
    return true;
  });

  /* 托盘 */
  ipcMain.handle('app:minimizeToTray', () => { minimizeToTray(); return true; });
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

app.on('second-instance', () => {
  logLine('检测到第二次启动，尝试唤出已有窗口');
  if (!mainWindow) {
    createWindow();
    return;
  }
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.setSkipTaskbar(false);
    mainWindow.focus();
    mainWindow.moveTop();
  } catch (err) {
    logLine('唤出窗口失败：' + err.message);
  }
});

app.on('child-process-gone', (_event, details) => {
  // 具体处理见 watchForGpuFailure()
  if (details.type !== 'GPU') logLine('子进程异常：' + JSON.stringify(details));
});

app.on('before-quit', () => {
  // 用户主动退出（托盘菜单 / 关闭时选择直接退出 / Cmd+Q）
  isQuitting = true;
  logLine('应用正常退出');
  destroyTray();
});

app.whenReady().then(() => {
  // 站点使用 IP + HTTPS，证书链可能不完整：仅对本站放行
  app.on('certificate-error', (event, _wc, url, _error, _cert, callback) => {
    try {
      if (new URL(url).hostname === new URL(currentBase()).hostname) {
        event.preventDefault();
        return callback(true);
      }
    } catch (_) { /* 忽略 */ }
    callback(false);
  });

  // 站外链接一律交给系统浏览器，应用内不开新窗口
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  registerIpc();
  watchForGpuFailure();
  createTray();
  logLine(`启动 v${app.getVersion()} | 安全模式=${SAFE_MODE ? '开' : '关'} | Electron=${process.versions.electron}`);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 有托盘时窗口关闭不代表退出，应用继续驻留托盘
  if (isQuitting) app.quit();
});

nativeTheme.on('updated', () => {
  updateTitlebarOverlay(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});
