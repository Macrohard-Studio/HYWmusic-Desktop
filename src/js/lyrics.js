/* ============================================================
   LRC 歌词解析
   ============================================================ */

(function () {
  const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  /**
   * 解析 LRC 文本
   * 支持一行多时间标签：[00:12.00][01:20.00]歌词
   * @returns {{time:number, text:string}[]} 按时间升序
   */
  function parseLrc(raw) {
    if (!raw || typeof raw !== 'string') return [];
    const out = [];

    for (const line of raw.split(/\r?\n/)) {
      const stamps = [];
      let m;
      TIME_RE.lastIndex = 0;
      while ((m = TIME_RE.exec(line)) !== null) {
        const min = parseInt(m[1], 10) || 0;
        const sec = parseInt(m[2], 10) || 0;
        let ms = 0;
        if (m[3]) {
          const frac = m[3];
          ms = frac.length === 1 ? parseInt(frac, 10) * 100
             : frac.length === 2 ? parseInt(frac, 10) * 10
             : parseInt(frac, 10);
        }
        stamps.push(min * 60 + sec + ms / 1000);
      }
      if (!stamps.length) continue;

      const text = line.replace(TIME_RE, '').trim();
      if (!text) continue;

      for (const t of stamps) out.push({ time: t, text });
    }

    out.sort((a, b) => a.time - b.time);
    return out;
  }

  /**
   * 合并原文与翻译（按时间就近匹配）
   */
  function mergeTranslation(main, trans) {
    if (!main.length || !trans.length) return main.map((l) => ({ ...l, trans: '' }));
    return main.map((line) => {
      let best = null;
      let bestDiff = 0.6; // 允许 0.6s 误差
      for (const t of trans) {
        const d = Math.abs(t.time - line.time);
        if (d < bestDiff) { bestDiff = d; best = t; }
      }
      return { ...line, trans: best ? best.text : '' };
    });
  }

  /** 二分查找当前行索引 */
  function findIndex(lines, time) {
    if (!lines.length) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= time + 0.05) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  window.LRC = { parseLrc, mergeTranslation, findIndex };
})();
