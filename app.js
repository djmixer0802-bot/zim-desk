/* Grok Bot desk app. Plan B: polls JSON files under {R2}/d/{DATA_PATH}/ every 15s.
   No FOMO URL is ever built here: every link comes from the desk's links.py via the JSON files. */
(function () {
  'use strict';
  const R2 = 'https://pub-9f50a40300c44378bca706684f2207b2.r2.dev';
  const POLL = 15000;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- DATA_PATH from the #d= fragment, then localStorage ----
  const m = location.hash.match(/[#&]d=([A-Za-z0-9_-]{32,})/);
  if (m) { localStorage.setItem('dp', m[1]); }
  const DP = localStorage.getItem('dp');
  const BASE = (localStorage.getItem('base') || R2) + '/d/' + DP + '/';

  const S = { state: null, chart: null, activity: null, agents: null, account: null, index: null,
              lastOk: null, failing: false, nextTry: 0, range: 'LIVE', tab: 'home', overlay: null, coin: {}, audit: {},
              actPage: 1, prevPts: null, beam: {} };

  async function get(name) {
    const r = await fetch(BASE + name + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(name + ' ' + r.status);
    return r.json();
  }

  // ---- formatting ----
  const usd = (v, d = 2) => v == null ? 'n/a' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const big = v => v == null ? 'n/a' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + v.toFixed(0);
  const pct = (v, s = true) => v == null ? '' : (s ? (v >= 0 ? '+' : '-') : '') + Math.abs(v).toFixed(2) + '%';
  const num = v => { const f = Number(v); return Number.isInteger(f) ? String(f) : String(+f.toFixed(2)); };
  const price = v => v == null ? 'n/a' : v >= 1 ? '$' + v.toFixed(4) : '$' + v.toPrecision(4);
  const hm = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Malta' });
  const age = ts => { if (!ts) return ''; const mn = Math.floor((Date.now() / 1000 - ts) / 60); return mn < 60 ? mn + 'm old' : Math.floor(mn / 60) + 'h old'; };
  const paperPill = () => S.state && S.state.mode === 'PAPER' ? '<span class="pill paper">PAPER</span>' : '';
  function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }

  // ---- odometer: each changed digit rolls 600ms ease-out, 30ms stagger right to left ----
  function odometer(el, text) {
    const prev = el.dataset.v || '';
    if (prev === text) return;
    el.dataset.v = text;
    const chars = text.split('');
    if (!el.children.length || el.children.length !== chars.length || reduced()) {
      el.innerHTML = chars.map(c => /\d/.test(c)
        ? `<span class="odo-d"><span class="odo-col" style="transform:translateY(-${+c * 1.05}em)">${[0,1,2,3,4,5,6,7,8,9].map(n => `<span>${n}</span>`).join('')}</span></span>`
        : `<span class="odo-s">${esc(c)}</span>`).join('');
      return;
    }
    const kids = Array.from(el.children);
    let stagger = 0;
    for (let i = chars.length - 1; i >= 0; i--) {
      const c = chars[i], k = kids[i];
      if (/\d/.test(c) && k.classList.contains('odo-d')) {
        const col = k.firstChild, want = `translateY(-${+c * 1.05}em)`;
        if (col.style.transform !== want) { col.style.transitionDelay = (stagger * 30) + 'ms'; col.style.transform = want; stagger++; }
      } else if (k.textContent !== c) { k.textContent = c; }
    }
  }

  // ---- error row ----
  function renderErr() {
    const e = $('#err');
    if (!DP) { e.classList.remove('hidden'); document.body.classList.add('has-err'); e.textContent = 'Open the desk link from your Telegram once (it ends in #d=…)'; return; }
    const stale = S.state && (Date.now() / 1000 - S.state.updated > 60);
    if (S.failing || stale) {
      const n = Math.max(0, Math.ceil((S.nextTry - Date.now()) / 1000));
      const last = S.state ? hm(S.state.updated) : '–';
      e.textContent = `Desk offline · retrying in ${n}s · last update ${last}`;
      e.classList.remove('hidden'); document.body.classList.add('has-err');
    } else { e.classList.add('hidden'); document.body.classList.remove('has-err'); }
  }
  setInterval(renderErr, 1000);

  // ---- polling ----
  async function poll() {
    if (!DP) { renderErr(); renderAll(); return; }
    try {
      const [st, ch, ac, ag] = await Promise.all([get('state.json'), get('chart.json'), get('activity.json'), get('agents.json')]);
      S.state = st; S.chart = ch; S.activity = ac; S.agents = ag; S.failing = false; S.lastOk = Date.now();
      if (!S.account || Math.random() < 0.25) S.account = await get('account.json');
      if (!S.index || Math.random() < 0.25) S.index = await get('index.json').catch(() => S.index);
      if (S.overlay && S.overlay.kind === 'coin') S.coin[S.overlay.mint] = await get('coin/' + S.overlay.mint + '.json').catch(() => S.coin[S.overlay.mint]);
      if (S.overlay && S.overlay.kind === 'audit') S.audit[S.overlay.mint] = await get('audit/' + S.overlay.mint + '.json').catch(() => S.audit[S.overlay.mint]);
    } catch (e) {
      S.failing = true;
    }
    S.nextTry = Date.now() + POLL;
    renderErr(); renderAll();
    setTimeout(poll, POLL);
  }

  // ---- tabs ----
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  function go(tab) {
    closeOverlay();
    S.tab = tab;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === tab));
    renderAll(); window.scrollTo(0, 0);
  }

  function renderAll() {
    if (S.tab === 'home') renderHome();
    if (S.tab === 'agents') renderAgents();
    if (S.tab === 'activity') renderActivity();
    if (S.tab === 'account') renderAccount();
    if (S.overlay) renderOverlay();
  }

  // ---- skeletons ----
  const skHome = () => `<div class="nav"><div class="sk" style="width:32px;height:32px;border-radius:16px"></div><div class="title"></div></div>
    <div class="pad"><div class="sk" style="height:70px;width:70%;margin-top:6px"></div><div class="sk" style="height:20px;width:40%;margin-top:10px"></div>
    <div class="sk" style="height:250px;margin-top:14px"></div><div class="sk" style="height:44px;margin-top:10px"></div></div>
    <div class="sec-h"><div class="sk" style="height:22px;width:140px"></div></div>
    <div class="carousel"><div class="sk acard" style="${cardSize()}"></div></div>`;
  const skList = n => `<div class="list">${Array.from({ length: n }, () => `<div class="row"><div class="sk" style="width:36px;height:36px;border-radius:18px"></div><div class="mid"><div class="sk" style="height:14px;width:60%"></div><div class="sk" style="height:11px;width:40%;margin-top:6px"></div></div></div>`).join('')}</div>`;

  function cardSize(full) {
    const w = Math.min(window.innerWidth, 600) - 32;
    return `width:${w}px;aspect-ratio:504/470;border-radius:${(42 * w / 504).toFixed(1)}px`;
  }

  // ---- HOME ----
  function renderHome() {
    const el = $('#home');
    if (!S.state) { if (!el.dataset.sk) { el.innerHTML = skHome(); el.dataset.sk = 1; } return; }
    if (!el.dataset.built) {
      el.dataset.built = 1;
      el.innerHTML = `<div class="nav">
        <button class="icon-btn" id="h-av" aria-label="Account"><span class="avatar">Z</span></button>
        <div class="title"><button id="h-title" style="min-height:44px">Grok Bot ›</button></div>
        <button class="icon-btn" id="h-search" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button>
        <button class="icon-btn" id="h-bell" aria-label="Pushes"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg><i class="dot hidden" id="h-dot"></i></button></div>
        <div class="bal-row"><div class="balance num" id="h-bal"></div><span id="h-paper"></span></div>
        <div class="sub-row"><span id="h-today"></span><span class="pill mult" id="h-mult"></span></div>
        <div class="chart-wrap"><canvas id="h-chart"></canvas></div>
        <div class="ranges" id="h-ranges">${['LIVE', '1H', '4H', '1D', '1W', 'ALL'].map(r => `<button data-r="${r}">${r}</button>`).join('')}</div>
        <div class="sec-h"><h2 id="h-agents-t">Agents · 5 running</h2></div>
        <div class="carousel" id="h-cards"></div>
        <div class="sec-h"><h2>Activity</h2><button id="h-all">See all</button></div>
        <div id="h-act"></div>`;
      $('#h-av').onclick = () => go('account');
      $('#h-title').onclick = () => go('agents');
      $('#h-all').onclick = () => go('activity');
      $('#h-search').onclick = () => openOverlay({ kind: 'search' });
      $('#h-bell').onclick = () => openOverlay({ kind: 'bell' });
      $('#h-ranges').onclick = e => { const r = e.target.dataset.r; if (r) { S.range = r; drawHomeChart(true); syncRanges(); } };
    }
    const st = S.state;
    odometer($('#h-bal'), usd(st.balance));
    $('#h-paper').innerHTML = paperPill();
    $('#h-today').className = st.todayPct >= 0 ? 'up' : 'down';
    $('#h-today').textContent = pct(st.todayPct) + ' today';
    $('#h-mult').textContent = st.multiplier.toFixed(2) + '×';
    const seen = +(localStorage.getItem('seenPush') || 0);
    $('#h-dot').classList.toggle('hidden', !(st.pushes && st.pushes.length && st.pushes[0].ts > seen));
    const running = Object.values(st.agents).filter(a => a.running).length;
    $('#h-agents-t').textContent = `Agents · ${running} running`;
    syncRanges(); drawHomeChart(false);
    $('#h-cards').innerHTML = ['scanner', 'auditor', 'analyst', 'executor', 'risk'].map(a => agentCard(a)).join('');
    drawRings();
    $('#h-cards').querySelectorAll('[data-open-audit]').forEach(b => b.onclick = () => openOverlay({ kind: 'audit', mint: b.dataset.openAudit }));
    const rows = (S.activity && S.activity.rows || []).slice(0, 5);
    $('#h-act').innerHTML = rows.length ? `<div class="list">${rows.map(actRow).join('')}</div>` : `<div class="list"><div class="empty">Nothing yet tonight</div></div>`;
    bindRows($('#h-act'));
  }
  function syncRanges() { document.querySelectorAll('#h-ranges button').forEach(b => b.classList.toggle('on', b.dataset.r === S.range)); }

  function drawHomeChart(instant) {
    const c = $('#h-chart'); if (!c || !S.chart) return;
    let pts = (S.chart.ranges[S.range] || []);
    if (!S.chart.marks.length && pts.every(p => Math.abs(p[1] - S.chart.start) < 0.005)) pts = []; // no trade yet: empty state
    const key = S.range + ':' + pts.length + ':' + (pts.length ? pts[pts.length - 1][1] : '');
    const changed = S.prevPts !== key; S.prevPts = key;
    if (instant || reduced() || !changed) { Charts.line(c, pts, S.chart.start, S.chart.marks, {}); return; }
    const t0 = performance.now();
    const step = t => {
      const p = Math.min(1, (t - t0) / 250), ma = Math.min(1, (t - t0) / 200);
      Charts.line(c, pts, S.chart.start, S.chart.marks, { progress: p, markAlpha: ma });
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---- agent cards ----
  function agentCard(a, full) {
    const st = S.state, d = st.agents[a];
    const size = full ? 'width:100%;border-radius:22px;aspect-ratio:auto;min-height:0' : cardSize();
    const status = d.paused ? '<span class="secc">paused</span>' : '';
    if (a === 'scanner') {
      const feed = (d.feed || []).slice(0, 4);
      return `<div class="acard" style="${size}"><div class="hd"><span style="color:var(--cyan)">●</span> Scanner ${status}</div>
        <div class="bigc num">${d.count} pools</div><div class="lbl">${d.waiting} in the waiting room</div>
        <div class="body">${feed.length ? feed.map(f => f.verdict === 'pass'
          ? `<div class="feed-row"><span class="nm">${esc(f.name)} · liq ${big(f.liq)}</span><span class="ok">→ auditor</span></div>`
          : `<div class="feed-row killed"><span class="nm">${esc(f.name)}</span><span class="rs">${esc(f.reason)}</span></div>`).join('')
          : '<div class="lbl">Listening for graduations</div>'}</div></div>`;
    }
    if (a === 'auditor') {
      const L = d.layers || [];
      const strips = Array.from({ length: 8 }, (_, i) => { const l = L[i]; const cls = !l ? (d.auditing && i === L.length ? 'run' : '') : l.pass === true ? 'ok' : l.pass === false ? 'no' : ''; return `<div class="strip ${cls}"></div>`; }).join('');
      const line = !d.mint ? 'No coin taken apart yet' : d.auditing ? 'taking apart...' : d.passed ? '8/8 → Executor' : esc(d.result);
      return `<div class="acard" style="${size}" ${d.mint ? `data-open-audit="${esc(d.mint)}"` : ''}><div class="hd"><span style="color:var(--green)">●</span> Auditor ${status}<span class="who">${esc(d.name || '')}</span></div>
        <div class="bigc num">${d.count} taken apart</div><div class="lbl">${d.rejected} rejected</div>
        <div class="body"><div class="strips">${strips}</div><div style="font-size:15px;font-weight:600;color:${d.passed ? 'var(--green)' : d.mint && !d.auditing ? 'var(--red)' : 'var(--sec)'}">${line}</div></div></div>`;
    }
    if (a === 'analyst') {
      return `<div class="acard" style="${size}"><div class="hd"><span style="color:var(--yellow)">●</span> Analyst${d.mode === 'rules' ? ' (rules)' : ''} ${status}<span class="who">${esc(d.name || '')}</span></div>
        <div class="bigc">Scoring</div><div class="lbl">${d.count} scored · green from ${d.minScore}</div>
        <div class="body" style="align-items:center"><canvas class="ringc" data-ring="${d.score == null ? '' : d.score}" data-min="${d.minScore}"></canvas>
        <div class="lbl">${d.reason ? esc(d.reason) : d.passed ? '→ Executor' : ''}</div></div></div>`;
    }
    if (a === 'executor') {
      const l = d.last; const filling = l && l.status === 'sent';
      const pctDone = filling ? Math.min(99, Math.round((Date.now() / 1000 - l.ts) / 1.2 * 100)) : 100;
      return `<div class="acard" style="${size}"><div class="hd"><span style="color:var(--green)">●</span> Executor ${status}<span class="who">${esc(l ? l.name : '')}</span></div>
        <div class="bigc num">${d.count} trades</div><div class="lbl">${l ? usd(l.size) + ' · ' + num(d.stackPct) + '% of stack' : num(d.stackPct) + '% of stack per coin'}</div>
        <div class="body">${l ? `<div class="bar"><i style="width:${pctDone}%"></i></div><div style="font-size:15px;font-weight:600;color:var(--green)">${filling ? 'Executing... ' + pctDone + '%' : '✓ Filled'}</div>` : '<div class="lbl">No trade yet tonight</div>'}</div></div>`;
    }
    const le = d.lastExit;
    return `<div class="acard" style="${size}"><div class="hd"><span style="color:var(--pink)">●</span> Risk ${status}</div>
      <div class="bigc">${d.open ? 'Guarding' : le ? (le.reason === 'trail' ? 'Trailed out' : le.reason === 'stop' ? 'Stopped' : 'Closed') : 'Guarding'}</div>
      <div class="lbl">${d.open ? d.open + ' open' : le ? esc(le.name) + ' · ' + usd(le.pnl) : 'Nothing open'}</div>
      <div class="body"><div class="pills"><span class="tp red">stop -${num(d.stopPct)}%</span><span class="tp green">trail ${num(d.trailPct)}%</span></div></div></div>`;
  }
  function drawRings() { document.querySelectorAll('canvas[data-ring]').forEach(c => Charts.ring(c, c.dataset.ring === '' ? null : +c.dataset.ring, +c.dataset.min)); }

  // ---- AGENTS TAB ----
  const AG = { scanner: 'Scanner', auditor: 'Auditor', analyst: 'Analyst', executor: 'Executor', risk: 'Risk' };
  const AGSET = { scanner: 'Scanner', auditor: 'Auditor', analyst: 'Analyst', executor: 'Executor', risk: 'Risk' };
  function renderAgents() {
    const el = $('#agents');
    if (!S.state || !S.agents) { el.innerHTML = `<h1 class="big">Agents</h1>` + [1, 2, 3].map(() => `<div class="pad" style="margin-bottom:12px"><div class="sk" style="height:220px;border-radius:22px"></div></div>`).join(''); return; }
    el.innerHTML = `<h1 class="big">Agents</h1>` + Object.keys(AG).map(a => {
      const d = S.agents.agents[a], st = S.state.agents[a];
      const locked = a === 'risk' && d.locked;
      const dec = d.decisions.length ? d.decisions.map(x => `<div class="kv"><span>${hm(x.ts)} · <a href="${esc(x.coin_url)}" target="_blank" rel="noopener" style="color:#fff">${esc(x.coin)}</a></span><span style="text-align:right;max-width:60%;color:${/pass|bought|sent|trail/.test(x.verdict) ? 'var(--green)' : /kill|reject|stop|skip|pulled|missed/.test(x.verdict) ? 'var(--red)' : 'var(--sec)'}">${esc(x.verdict)} · ${esc(x.reason || '')}</span></div>`).join('')
        : `<div class="empty">${a === 'scanner' ? 'Listening for graduations' : a === 'auditor' ? 'No coin taken apart yet' : 'No decisions yet tonight'}</div>`;
      return `<div class="pad" style="margin-bottom:14px">${agentCard(a, true)}
        <div class="card" style="margin:8px 0 0"><div style="display:flex;align-items:center;gap:10px;min-height:44px">
          <span style="width:10px;height:10px;border-radius:5px;background:${st.paused ? 'var(--ter)' : st.running ? 'var(--green)' : 'var(--orange)'}"></span>
          <b style="flex:1">${AG[a]} · ${st.paused ? 'paused' : 'running'} · ${d.today} today</b>
          <button class="switch ${st.paused ? '' : 'on'} ${locked ? 'locked' : ''}" data-pause="${a}" aria-label="pause or resume" style="min-height:31px"></button></div>
          <div style="margin-top:6px">${dec}</div>
          <button class="kv" data-settings="${a}" style="width:100%;color:var(--green);min-height:44px;align-items:center"><span style="color:var(--green)">Settings</span><span>›</span></button></div></div>`;
    }).join('');
    drawRings();
    el.querySelectorAll('[data-pause]').forEach(b => b.onclick = () => {
      const a = b.dataset.pause;
      if (a === 'risk' && S.agents.agents.risk.locked) return toast('Risk is locked while a position is open');
      toast(`Send "${S.state.agents[a].paused ? 'resume' : 'pause'} ${AG[a]}" to @Zimcoin_bot`);
    });
    el.querySelectorAll('[data-settings]').forEach(b => b.onclick = () => { go('account'); setTimeout(() => { const g = document.getElementById('grp-' + AGSET[b.dataset.settings]); g && g.scrollIntoView(); }, 50); });
    el.querySelectorAll('[data-open-audit]').forEach(b => b.onclick = () => openOverlay({ kind: 'audit', mint: b.dataset.openAudit }));
  }

  // ---- ACTIVITY ----
  function actRow(r) {
    const ic = { bought: '↓', sold: '↑', stopped: '!', rejected: '×' }[r.kind] || '•';
    const vcls = r.kind === 'sold' ? (String(r.value).startsWith('-') ? 'down' : 'up') : r.kind === 'stopped' ? 'down' : r.kind === 'rejected' ? 'secc' : '';
    const target = r.kind === 'rejected' ? 'audit' : 'coin';
    const parts = String(r.value || '').split(' · '); const main = parts[0], sub = parts.slice(1).join(' · ');
    return `<button class="row" data-row="${target}" data-mint="${esc(r.mint)}"><span class="ic ${r.kind}">${ic}</span>
      <span class="mid"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.subtitle)}</div></span>
      <span class="v ${vcls}">${esc(main)}${sub ? `<small class="secc">${esc(sub)}</small>` : ''}${r.value2 ? `<small>${esc(r.value2)}</small>` : ''}</span></button>`;
  }
  function bindRows(el) { el.querySelectorAll('[data-row]').forEach(b => b.onclick = () => openOverlay({ kind: b.dataset.row, mint: b.dataset.mint })); }
  function renderActivity() {
    const el = $('#activity');
    if (!S.activity) { el.innerHTML = `<h1 class="big">Activity</h1>` + skList(6); return; }
    const rows = S.activity.rows.slice(0, 30 * S.actPage);
    el.innerHTML = `<h1 class="big">Activity</h1>` + (rows.length ? `<div class="list">${rows.map(actRow).join('')}</div>` +
      (S.activity.rows.length > rows.length ? `<div class="pad"><button class="cta" style="position:static;margin-top:12px;background:var(--card2);color:#fff" id="more">Load more</button></div>` : '')
      : `<div class="list"><div class="empty">Nothing yet tonight</div></div>`);
    bindRows(el);
    const mo = $('#more'); if (mo) mo.onclick = () => { S.actPage++; renderActivity(); };
  }

  // ---- ACCOUNT ----
  function renderAccount() {
    const el = $('#account');
    const a = S.account;
    if (!a) { el.innerHTML = `<h1 class="big">Account</h1>` + skList(4); return; }
    const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    el.innerHTML = `<h1 class="big">Account</h1>
      <div class="list">
        <div class="row"><span class="mid"><div class="t">Mode</div><div class="s">${a.mode === 'PAPER' ? 'Simulated balance' : 'You buy inside FOMO'}</div></span>
          <div class="seg"><button class="${a.mode === 'PAPER' ? 'on' : ''}" data-mode="PAPER">PAPER</button><button class="${a.mode === 'LIVE' ? 'on' : ''}" data-mode="LIVE">LIVE</button></div></div>
        <div class="row"><span class="mid"><div class="t">Stack</div><div class="s">${a.mode === 'PAPER' ? 'PAPER starts at ' + usd(a.paperStartStack) : 'LIVE stack you set'}</div></span><span class="v num">${usd(a.mode === 'PAPER' ? (S.state ? S.state.balance : a.paperStartStack) : a.stack)}</span></div>
        ${a.profile_url ? `<a class="row" href="${esc(a.profile_url)}" target="_blank" rel="noopener"><span class="mid"><div class="t">Your FOMO profile</div><div class="s">@${esc(a.fomo_handle)}</div></span><span class="v secc">›</span></a>` : ''}
        <button class="row" id="invite"><span class="mid"><div class="t">Invite a friend</div><div class="s">10% off every FOMO fee through your link</div></span><span class="v secc">›</span></button>
      </div>
      <div class="grp-t">NOTIFICATIONS</div>
      <div class="list">
        <div class="row"><span class="mid"><div class="t">Telegram</div><div class="s">${esc(a.telegram.bot)}</div></span><span class="v ${a.telegram.connected ? 'up' : 'down'}">${a.telegram.connected ? 'Connected' : 'Not connected'}</span></div>
        <a class="row" href="https://t.me/Zimcoin_bot" target="_blank" rel="noopener"><span class="mid"><div class="t">Send test push</div><div class="s">Send "status" to the bot, it answers with your desk</div></span><span class="v secc">›</span></a>
        ${standalone ? `<div class="row"><span class="mid"><div class="t">Enable notifications</div><div class="s">${esc(a.webpush.note)}</div></span></div>` : `<div class="row"><span class="mid"><div class="t">Web push</div><div class="s">${esc(a.webpush.note)}</div></span></div>`}
      </div>
      <div class="note">Plan B hosting: settings, pause and mode are read-only here. Change them in Telegram, e.g. "set stop to -8%".</div>
      ${a.groups.map(g => `<div class="grp-t" id="grp-${esc(g.title.split(' ')[0])}${g.title.includes('rules') ? '-rules' : ''}">${esc(g.title.toUpperCase())}</div>
        <div class="list">${g.items.map(setRow).join('')}</div>`).join('')}
      <div class="note">Tickets need ${usd(a.minStack)} of stack at the current stack %. Full PAPER nights: ${a.fullPaperNights}.</div>`;
    el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => toast(b.dataset.mode === 'LIVE' ? 'Send "live" to @Zimcoin_bot, then type LIVE' : 'Send "paper" to @Zimcoin_bot'));
    el.querySelectorAll('input,select').forEach(i => { i.disabled = true; });
    el.querySelectorAll('.set').forEach(s => s.onclick = () => toast(`Send "set ${s.dataset.k} to …" to @Zimcoin_bot`));
    $('#invite').onclick = async () => {
      const url = a.signup_url;
      if (navigator.share) { try { await navigator.share({ title: 'FOMO', text: 'Trade on FOMO with 10% off fees', url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(url); } catch (e) {}
      toast('Link copied');
    };
  }
  function setRow(it) {
    const v = it.value;
    if (it.type === 'bool') return `<div class="set" data-k="${esc(it.label)}"><div class="top"><span>${esc(it.label)}</span><span class="switch ${v ? 'on' : ''}"></span></div></div>`;
    if (it.options) return `<div class="set" data-k="${esc(it.label)}"><div class="top"><span>${esc(it.label)}</span><select>${it.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div></div>`;
    if (it.type === 'str') return `<div class="set" data-k="${esc(it.label)}"><div class="top"><span>${esc(it.label)}</span><span class="secc" style="font-size:14px;max-width:60%;overflow:hidden;text-overflow:ellipsis">${esc(v)}</span></div></div>`;
    const step = it.type === 'int' ? 1 : (it.max <= 1 ? 0.01 : it.max <= 100 ? 0.5 : 1);
    return `<div class="set" data-k="${esc(it.label)}"><div class="top"><span>${esc(it.label)}</span><input type="number" value="${v}" min="${it.min}" max="${it.max}" step="${step}"></div>
      <input type="range" value="${v}" min="${it.min}" max="${it.max}" step="${step}"></div>`;
  }

  // ---- OVERLAYS: coin, audit, search, bell ----
  function openOverlay(o) {
    S.overlay = o;
    const ov = $('#overlay'); ov.classList.remove('hidden'); ov.scrollTop = 0; ov.innerHTML = '';
    if (o.kind === 'bell' && S.state && S.state.pushes.length) localStorage.setItem('seenPush', String(S.state.pushes[0].ts));
    renderOverlay();
    if (o.kind === 'coin' && DP) get('coin/' + o.mint + '.json').then(d => { S.coin[o.mint] = d; renderOverlay(); }).catch(() => { S.coin[o.mint] = S.coin[o.mint] || { missing: true }; renderOverlay(); });
    if (o.kind === 'audit' && DP) get('audit/' + o.mint + '.json').then(d => { S.audit[o.mint] = d; renderOverlay(); }).catch(() => { S.audit[o.mint] = S.audit[o.mint] || { missing: true }; renderOverlay(); });
  }
  function closeOverlay() { S.overlay = null; const ov = $('#overlay'); ov.classList.add('hidden'); ov.innerHTML = ''; }
  const backBtn = `<div class="nav"><button class="back" id="ov-back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Back</button><div class="title"></div><span id="ov-paper"></span></div>`;
  function renderOverlay() {
    const o = S.overlay; if (!o) return;
    const ov = $('#overlay');
    if (o.kind === 'coin') renderCoin(ov, o.mint);
    else if (o.kind === 'audit') renderAudit(ov, o.mint);
    else if (o.kind === 'search') renderSearch(ov);
    else if (o.kind === 'bell') renderBell(ov);
    const b = $('#ov-back'); if (b) b.onclick = closeOverlay;
  }

  function renderCoin(ov, mint) {
    const d = S.coin[mint];
    if (!d) { ov.innerHTML = backBtn + `<div class="pad"><div class="sk" style="height:30px;width:60%"></div><div class="sk" style="height:50px;width:50%;margin-top:12px"></div><div class="sk" style="height:260px;margin-top:14px"></div><div class="sk" style="height:120px;margin-top:14px"></div></div>`; return; }
    if (d.missing) { ov.innerHTML = backBtn + `<div class="empty">No data for this coin yet</div>`; return; }
    const p = d.position;
    ov.innerHTML = backBtn + `
      <div class="pad" style="display:flex;align-items:center;gap:10px"><div style="flex:1;min-width:0"><div style="font-size:24px;font-weight:700;font-family:var(--disp);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</div>
      <div class="secc" style="font-size:14px">${esc(d.symbol || '')} · Solana · ${age(d.migratedAt)}</div></div>${d.shield ? `<button class="chip ${d.shield === '8/8' ? '' : 'bad'}" id="c-shield" style="min-height:44px;height:auto">⛨ ${d.shield}</button>` : ''}${paperPill()}</div>
      <div class="price num">${price(d.price)}</div>
      ${d.sinceEntryPct != null ? `<div class="pad ${d.sinceEntryPct >= 0 ? 'up' : 'down'}" style="font-weight:600">${d.sinceEntryPct >= 0 ? '▲' : '▼'} ${Math.abs(d.sinceEntryPct).toFixed(2)}% since entry</div>` : ''}
      <div class="chart-wrap" style="height:260px;margin:12px var(--g) 0"><canvas id="c-candles"></canvas></div>
      <div class="stats"><div><div class="k">Market cap</div><div class="vv num">${big(d.stats.marketCap)}</div></div><div><div class="k">Liquidity</div><div class="vv num">${big(d.stats.liquidity)}</div></div>
        <div><div class="k">24h volume</div><div class="vv num">${big(d.stats.volume24h)}</div></div><div><div class="k">Holders</div><div class="vv num">${d.stats.holders == null ? 'n/a' : d.stats.holders.toLocaleString()}</div></div></div>
      ${p ? `<div class="card"><h3>Your position · ${usd(p.size)} in · Executor</h3>
        <div class="kv"><span>Stop line</span><span class="down num">${price(p.stop)} · -${num(p.stopPct)}%</span></div>
        <div class="kv"><span>Trail line</span><span class="up num">${p.trailActive ? price(p.trail) + ' · ' + num(p.trailPct) + '% off the top' : 'starts at ' + price(p.trailStartPrice)}</span></div>
        <div class="kv"><span>Timeout</span><span class="num">${Math.floor(p.timeoutLeftS / 3600)}h ${Math.floor(p.timeoutLeftS % 3600 / 60)}m left</span></div></div>` : ''}
      <a class="cta ${p ? 'sell' : ''}" href="${esc(d.coin_url)}" target="_blank" rel="noopener">${p ? 'Sell on FOMO' : 'Buy on FOMO'}</a>`;
    Charts.candles($('#c-candles'), d.candles, p ? p.exitLine : null);
    const sh = $('#c-shield'); if (sh) sh.onclick = () => openOverlay({ kind: 'audit', mint });
  }

  function renderAudit(ov, mint) {
    const d = S.audit[mint];
    if (!d) { ov.innerHTML = backBtn + `<div class="pad"><div class="sk" style="height:300px;width:220px;margin:8px auto 0;border-radius:110px"></div>${skList(8)}</div>`; return; }
    if (d.missing || !d.layers.length) { ov.innerHTML = backBtn + `<div class="empty" style="padding-top:80px">No coin taken apart yet</div>`; return; }
    // beam: 350ms per layer top to bottom, then 150ms to green/red. Never shows a result the server didn't send.
    const b = S.beam[mint] || (S.beam[mint] = { shown: reduced() ? 8 : 0 });
    const avail = d.layers.filter(l => l.value !== 'not checked').length;
    const L = d.layers;
    const discs = L.map((l, i) => { const show = i < b.shown; const cls = !show ? (l.value === 'not checked' && b.shown >= avail ? 'nc' : '') : l.pass ? 'ok' : l.pass === false ? 'no' : 'nc';
      return `<div class="disc ${cls}" style="top:${i * 30}px;z-index:${10 - i}">${show ? (l.pass ? '✓' : l.pass === false ? '✕' : '') : ''}</div>`; }).join('');
    const nm = esc(d.name);
    const verdict = !d.done || b.shown < avail ? `<b>Taking apart ${nm}…</b>` : d.passed
      ? `<b class="up">Cleared · 8/8 parts</b><span>Sent to Executor${d.sentSize ? ' · ' + usd(d.sentSize) : ''}</span>`
      : `<b class="down">Rejected · ${esc(d.reason)}</b><span>Grok Bot won't buy ${nm}</span>`;
    ov.innerHTML = backBtn + `<div class="pad" style="font-size:24px;font-weight:700;font-family:var(--disp)">${nm}</div>
      <div class="discs">${discs}<div class="beam ${b.shown >= avail ? 'hidden' : ''}" style="top:${Math.min(b.shown, 7) * 30 + 25}px"></div></div>
      <div class="verdict">${verdict}</div>
      <div class="list" style="margin-top:14px">${L.map((l, i) => { const show = i < b.shown || l.value === 'not checked' && b.shown >= avail;
        return `<div class="lrow"><span class="n ${show && l.pass ? 'ok' : show && l.pass === false ? 'no' : ''}">${l.n}</span><span class="nm">${esc(l.name)}</span><span class="val ${!show || l.value === 'not checked' ? 'nc' : ''}">${show ? esc(l.value) : '…'}</span></div>`; }).join('')}</div>
      <div class="list" style="margin-top:14px"><div class="row" id="aud-toggle"><span class="mid"><div class="t">Take apart before buying</div><div class="s">Change in Telegram: set auditor.enabled off</div></span><span class="switch ${d.enabled ? 'on' : ''}"></span></div></div>
      <a class="cta" href="${esc(d.coin_url)}" target="_blank" rel="noopener">Open on FOMO</a>`;
    $('#aud-toggle').onclick = () => toast(d.enabled ? 'Turning it off asks twice: send "set auditor.enabled off" to @Zimcoin_bot' : 'Send "set auditor.enabled on"');
    if (b.shown < avail && !b.timer) {
      b.timer = setTimeout(() => { b.timer = null; b.shown++; if (S.overlay && S.overlay.mint === mint) renderOverlay(); }, b.shown === 0 ? 150 : 350 + 150);
    }
  }

  function renderSearch(ov) {
    if (!ov.dataset.s) {
      ov.dataset.s = 1;
      ov.innerHTML = backBtn + `<div class="search"><input id="q" placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off"></div><div id="sr" style="margin-top:12px"></div>`;
      $('#q').oninput = () => drawSr(); setTimeout(() => $('#q') && $('#q').focus(), 50);
    }
    drawSr();
    function drawSr() {
      const q = ($('#q') && $('#q').value || '').trim().toLowerCase();
      const coins = (S.index && S.index.coins) || [];
      const res = q ? coins.filter(c => (c.name || '').toLowerCase().includes(q) || (c.symbol || '').toLowerCase().includes(q) || c.mint.toLowerCase() === q).slice(0, 30) : [];
      $('#sr').innerHTML = !q ? '' : res.length ? `<div class="list">${res.map(c => `<button class="row" data-row="${c.hasCoin ? 'coin' : 'audit'}" data-mint="${esc(c.mint)}"><span class="mid"><div class="t">${esc(c.name || c.mint)}</div><div class="s">${esc(c.symbol || '')} · ${esc(c.mint.slice(0, 4))}…${esc(c.mint.slice(-4))}</div></span></button>`).join('')}</div>` : `<div class="empty">No coin found tonight</div>`;
      $('#sr').querySelectorAll('[data-row]').forEach(b => b.onclick = () => { delete ov.dataset.s; openOverlay({ kind: b.dataset.row === 'audit' ? 'coin' : 'coin', mint: b.dataset.mint }); });
    }
    const b = $('#ov-back'); if (b) b.onclick = () => { delete ov.dataset.s; closeOverlay(); };
  }

  function renderBell(ov) {
    const ps = (S.state && S.state.pushes) || [];
    ov.innerHTML = backBtn + `<h1 class="big">Pushes</h1>` + (ps.length ? `<div class="list">${ps.map(p => `<a class="row" href="${esc(p.url)}" target="_blank" rel="noopener"><span class="mid"><div class="s">Grok Bot · ${hm(p.ts)}</div><div class="t" style="white-space:normal">${esc(p.text)}</div></span><span class="v secc">›</span></a>`).join('')}</div>` : `<div class="list"><div class="empty">No pushes yet tonight</div></div>`);
  }

  window.addEventListener('resize', () => { const el = $('#home'); if (el) { renderAll(); } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  renderAll();
  poll();
})();
