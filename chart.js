/* Hand-drawn canvas charts. No chart library. devicePixelRatio aware. */
(function () {
  const C = { green: '#00d35a', red: '#ff453a', orange: '#ff9f0a', blue: '#0a84ff', sec: 'rgba(235,235,245,0.6)',
              ter: 'rgba(235,235,245,0.3)', sep: 'rgba(84,84,88,0.55)', yellow: '#ffd60a' };
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Home line chart. pts [[ts,val]], start value, marks [{ts,text,color}], progress 0..1 for slide-in
  function line(canvas, pts, start, marks, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    const top = 64, bottom = h - 8;
    if (!pts || pts.length < 2) {
      ctx.setLineDash([4, 5]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, (top + bottom) / 2); ctx.lineTo(w, (top + bottom) / 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.sec; ctx.font = '15px -apple-system, system-ui'; ctx.textAlign = 'center';
      ctx.fillText('Waiting for the first trade', w / 2, (top + bottom) / 2 - 12);
      return;
    }
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    let lo = Math.min(start, ...pts.map(p => p[1])), hi = Math.max(start, ...pts.map(p => p[1]));
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const X = t => (t1 === t0 ? w : (t - t0) / (t1 - t0) * w);
    const Y = v => bottom - (v - lo) / (hi - lo) * (bottom - top);
    const prog = opts.progress == null ? 1 : opts.progress;
    let n = pts.length;
    const draw = pts.slice(0, n - 1);
    const last = pts[n - 1], prev = pts[n - 2];
    draw.push([prev[0] + (last[0] - prev[0]) * prog, prev[1] + (last[1] - prev[1]) * prog]);
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, 'rgba(0,211,90,0.28)'); grad.addColorStop(1, 'rgba(0,211,90,0)');
    ctx.beginPath(); draw.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
    ctx.lineTo(X(draw[draw.length - 1][0]), bottom); ctx.lineTo(X(draw[0][0]), bottom); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.setLineDash([4, 5]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(start)); ctx.lineTo(w, Y(start)); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); draw.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
    ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    const e = draw[draw.length - 1];
    ctx.beginPath(); ctx.arc(X(e[0]), Y(e[1]), 4, 0, Math.PI * 2); ctx.fillStyle = C.green; ctx.fill();
    // marks: above the line, never overlap; a later mark moves up a row
    const ma = opts.markAlpha == null ? 1 : opts.markAlpha;
    ctx.font = '600 12px -apple-system, system-ui'; ctx.textAlign = 'left';
    const placed = [];
    (marks || []).filter(m => m.ts >= t0 && m.ts <= t1).forEach(m => {
      const val = interp(pts, m.ts);
      const tw = ctx.measureText(m.text).width + 14, x = Math.min(Math.max(2, X(m.ts) - tw / 2), w - tw - 2);
      let row = 0, y;
      while (true) {
        y = Y(val) - 30 - row * 26;
        if (!placed.some(p => p.row === row && !(x + tw < p.x || x > p.x + p.w))) break;
        row++;
      }
      y = Math.max(2, y);
      placed.push({ x, w: tw, row });
      ctx.globalAlpha = ma;
      const col = C[m.color] || C.blue;
      roundRect(ctx, x, y, tw, 20, 10); ctx.fillStyle = col; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(m.text, x + 7, y + 14);
      ctx.beginPath(); ctx.moveTo(X(m.ts), y + 20); ctx.lineTo(X(m.ts), Y(val) - 3); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }
  function interp(pts, t) {
    for (let i = 1; i < pts.length; i++) if (pts[i][0] >= t) {
      const a = pts[i - 1], b = pts[i]; const f = b[0] === a[0] ? 1 : (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * f;
    }
    return pts[pts.length - 1][1];
  }

  // Coin candles with volume + orange dashed exit line
  function candles(canvas, cs, exitLine) {
    const { ctx, w, h } = setup(canvas);
    const vh = h * 0.18, top = 12, bottom = h - vh - 10;
    if (!cs || !cs.length) {
      ctx.fillStyle = C.sec; ctx.font = '14px -apple-system, system-ui'; ctx.textAlign = 'center';
      ctx.fillText('No candles yet', w / 2, h / 2); return;
    }
    const data = cs.slice(-60);
    let lo = Math.min(...data.map(c => c.l)), hi = Math.max(...data.map(c => c.h));
    if (exitLine) { lo = Math.min(lo, exitLine); hi = Math.max(hi, exitLine); }
    if (hi - lo <= 0) { hi *= 1.01; lo *= 0.99; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const Y = v => bottom - (v - lo) / (hi - lo) * (bottom - top);
    const slot = w / Math.max(data.length, 20), bw = Math.max(2, slot * 0.6);
    const vmax = Math.max(...data.map(c => c.v || 0), 1e-9);
    data.forEach((c, i) => {
      const x = i * slot + slot / 2, up = c.c >= c.o, col = up ? C.green : C.red;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
      ctx.fillStyle = col; ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      const vv = (c.v || 0) / vmax * vh; ctx.globalAlpha = 0.45; ctx.fillRect(x - bw / 2, h - vv, bw, vv); ctx.globalAlpha = 1;
    });
    if (exitLine) {
      ctx.setLineDash([6, 5]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, Y(exitLine)); ctx.lineTo(w, Y(exitLine)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.orange; ctx.font = '600 11px -apple-system, system-ui'; ctx.textAlign = 'right';
      ctx.fillText('Risk trailing stop', w - 4, Y(exitLine) - 5);
    }
  }

  // Analyst score ring 0-100, green from min
  function ring(canvas, score, minScore) {
    const { ctx, w, h } = setup(canvas);
    const r = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2;
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.strokeStyle = '#3a3a3c'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (score != null) {
      ctx.strokeStyle = score >= minScore ? C.green : C.yellow;
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * score / 100); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 ' + Math.round(r * 0.7) + 'px -apple-system, system-ui';
    ctx.fillText(score == null ? '–' : String(score), cx, cy);
    ctx.textBaseline = 'alphabetic';
  }

  window.Charts = { line, candles, ring, reduced };
})();
