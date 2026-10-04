/* ============================================================
   主题系统
   主题 = JSON 定义（主色 / 背景 / 文字 / 背景图 / 圆角）
   采用「主题 ID + 自定义覆盖」两层结构
   ============================================================ */

(function () {
  /**
   * 每套主题只声明关键色，其余令牌由 buildTokens() 派生，
   * 这样新增主题只要改几个颜色值即可（与规格 6.4 的主题 JSON 思路一致）。
   */
  const THEMES = [
    {
      id: 'auto',
      name: '跟随系统',
      auto: true,
      light: 'green',
      dark: 'midnight',
    },
    {
      id: 'green',
      name: '绿意盎然',
      desc: '默认主题 · 清新浅绿',
      mode: 'light',
      c: { bg: '#f4f8f4', elev: '#ffffff', card: '#ffffff', hover: '#eaf2ea', border: '#d8e6d8', fg: '#17251a', muted: '#5d6f61', primary: '#22a05a' },
    },
    {
      id: 'midnight',
      name: '黑灯瞎火',
      desc: '极暗深灰 · 长时间使用',
      mode: 'dark',
      c: { bg: '#0f1113', elev: '#16191c', card: '#1b1f23', hover: '#23282d', border: '#2a3037', fg: '#e6eaee', muted: '#8b949e', primary: '#3fb950' },
    },
    {
      id: 'china-ink',
      name: '中国水墨',
      desc: '远山云雾 · 冷色调',
      mode: 'light',
      c: { bg: '#eef1f4', elev: '#f8fafb', card: '#ffffff', hover: '#e4e9ee', border: '#ccd5dd', fg: '#1c2530', muted: '#5a6875', primary: '#3d6b8f' },
    },
    {
      id: 'moon-night',
      name: '月夜星空',
      desc: '深紫夜空 · 低饱和',
      mode: 'dark',
      c: { bg: '#141127', elev: '#1c1836', card: '#221d40', hover: '#2b2450', border: '#332b5c', fg: '#e8e4f8', muted: '#9a92c4', primary: '#a78bfa' },
    },
    {
      id: 'landing-moon',
      name: '梦幻月夜',
      desc: '极简黑白线条 · 大量留白',
      mode: 'light',
      c: { bg: '#f7f7f7', elev: '#ffffff', card: '#ffffff', hover: '#efefef', border: '#e0e0e0', fg: '#111111', muted: '#707070', primary: '#333333' },
    },
    {
      id: 'anime',
      name: '动漫风格',
      desc: '明亮二次元插画',
      mode: 'light',
      c: { bg: '#fdf5f8', elev: '#ffffff', card: '#ffffff', hover: '#fbeaf2', border: '#f2d6e4', fg: '#2a1f28', muted: '#8a7480', primary: '#ec4899' },
    },
    {
      id: 'festival',
      name: '节日喜庆',
      desc: '红灯笼 · 金色祥云',
      mode: 'light',
      c: { bg: '#fdf6f2', elev: '#ffffff', card: '#ffffff', hover: '#fbeae2', border: '#f0d5c8', fg: '#2c1a14', muted: '#8a6a5c', primary: '#d92b2b' },
    },
    {
      id: 'deep-blue',
      name: '淡雅深蓝',
      desc: '纯配色 · 沉稳',
      mode: 'dark',
      c: { bg: '#0d1526', elev: '#131d33', card: '#182440', hover: '#1f2d4e', border: '#26365c', fg: '#e2e9f7', muted: '#8b9bc0', primary: '#4f8ef7' },
    },
    {
      id: 'orange-green',
      name: '橙黄橘绿',
      desc: '纯配色 · 暖调',
      mode: 'light',
      c: { bg: '#fdf8f0', elev: '#ffffff', card: '#ffffff', hover: '#fbf0dd', border: '#f0e0c4', fg: '#2b2113', muted: '#8a7550', primary: '#f08c00' },
    },
    {
      id: 'blue-jade',
      name: '蓝田生玉',
      desc: '纯配色 · 青玉',
      mode: 'dark',
      c: { bg: '#0c1719', elev: '#122023', card: '#17292c', hover: '#1e3438', border: '#254045', fg: '#dfeff1', muted: '#84a5aa', primary: '#2dd4bf' },
    },
    {
      id: 'purple-dream',
      name: '星紫梦',
      desc: '纯配色 · 紫调',
      mode: 'dark',
      c: { bg: '#120f1c', elev: '#1a1628', card: '#211c33', hover: '#2a2342', border: '#342b52', fg: '#ece7f8', muted: '#9d94bd', primary: '#818cf8' },
    },
  ];

  const byId = (id) => THEMES.find((t) => t.id === id) || THEMES[1];

  /** 由关键色派生完整设计令牌
   *  注意：CSS 侧统一用 `hsl(var(--x))` 取值，所以这里必须输出
   *  「H S% L%」三元组，而不是 hex —— 否则 hsl(#fff) 无效、背景会变透明。
   */
  function buildTokens(c) {
    return {
      '--bg': hsl(c.bg),
      '--bg-elev': hsl(c.elev),
      '--card': hsl(c.card),
      '--card-hover': hsl(c.hover),
      '--border': hsl(c.border),
      '--fg': hsl(c.fg),
      '--muted': hsl(c.muted),
      '--muted-2': hsl(mix(c.muted, c.bg, 0.35)),
      '--primary': hsl(c.primary),
      '--primary-fg': hsl(pickFg(c.primary)),
      '--primary-soft': hslA(c.primary, 0.14),
      '--scroll': hsl(mix(c.border, c.bg, 0.15)),
      '--success': hsl(c.primary),
      '--warn': hsl('#e8a33d'),
      '--danger': hsl('#e5484d'),
      '--shadow': '0 12px 32px -12px ' + hexA('#000000', 0.45),
    };
  }

  function hexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    const v = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
    const n = parseInt(v, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  }
  /** hex -> "H S% L%"（供 hsl(var(--x)) 使用） */
  function hsl(hex) {
    const { r, g, b } = hexToRgb(hex);
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    const d = max - min;
    if (d) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
      else if (max === G) h = (B - R) / d + 2;
      else h = (R - G) / d + 4;
      h /= 6;
    }
    return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  }
  /** hex + alpha -> "H S% L% / a" */
  function hslA(hex, a) {
    return `${hsl(hex)} / ${a}`;
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
  }
  function hexA(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  /** 依据背景亮度选择前景色（保证对比度） */
  function pickFg(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#101418' : '#ffffff';
  }

  const systemDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  /** 解析「跟随系统」到具体主题 id */
  function resolveId(pref) {
    if (pref === 'auto' || !pref) {
      const t = byId('auto');
      return systemDark() ? t.dark : t.light;
    }
    return pref;
  }

  /** 应用主题：写入 CSS 变量 */
  function apply(pref, overrides) {
    const id = resolveId(pref);
    const theme = byId(id);
    const merged = { ...theme.c, ...(overrides || {}) };
    const tokens = buildTokens(merged);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
    root.dataset.theme = theme.mode;
    root.dataset.themeId = theme.id;
    // 同步原生标题栏配色（把主题背景色一并传过去，避免出现色块错位）
    try { window.hyw && window.hyw.setTheme(theme.mode, merged.bg); } catch (_) {}
    return theme;
  }

  window.Theme = { THEMES, byId, apply, resolveId, buildTokens, systemDark };
})();
