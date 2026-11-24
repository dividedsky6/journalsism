/* Journalsism: a personal journal app.
 * Entries live in this browser's IndexedDB (see storage.js).
 * Sections: dates, entries, markdown, ui helpers, views, entry sheet, import, events, boot. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
const USE_F = /^en-US/.test(navigator.language || 'en-US');
const ICON = {
  star: '<svg class="ico" viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>'
};

let store = null; // set at boot, see storage.js
const entries = new Map();
/* Bumped on every change to entries or journals, so derived lists are only rebuilt when something changed. */
let ver = 0;
const watch = m => { const set = m.set.bind(m), del = m.delete.bind(m); m.set = (k, v) => (ver++, set(k, v)); m.delete = k => (ver++, del(k)); return m; };
watch(entries);
const memo = fn => { let v = -1, r; return () => (v === ver ? r : (v = ver, r = fn())); };
/* Journals: name -> {name, color, created}. Each journal has its own color, like Day One. */
const J = watch(new Map());
const PALETTE = [['Blue', '#2b7bd6'], ['Green', '#2f8f4e'], ['Orange', '#d9651a'], ['Teal', '#0f8a8a'], ['Light purple', '#9a7ae0'], ['Watermelon', '#d63b5e'], ['Honey', '#c27c0e'], ['Lavender', '#7b5cd6'], ['Rose', '#c24b93'], ['Pewter', '#5e6b7d']];
const PRESET = (window.JOURNALISM_CONFIG && window.JOURNALISM_CONFIG.DEFAULT_JOURNAL_COLORS) || {};
const HEX = /^#[0-9a-f]{6}$/i;
const colorOf = name => { const j = J.get(name); return j && HEX.test(j.color) ? j.color : '#5e6b7d'; };
const S = { view: 'journals', q: '', journal: '', tag: '', starred: false, day: '', shown: 50, cal: null };

/* ---------- dates ---------- */
const fcache = new Map();
function tzOk(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return LOCAL_TZ; } }
function F(tz, opts, loc) { const k = tz + JSON.stringify(opts) + (loc || ''); let f = fcache.get(k); if (!f) { f = new Intl.DateTimeFormat(loc, { ...opts, timeZone: tz }); fcache.set(k, f); } return f; }
function fmt(e, opts) { return F(e._tz, opts).format(new Date(e.date)); }
function keyOf(date, tz) { const o = {}; F(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA').formatToParts(date).forEach(p => o[p.type] = p.value); return `${o.year}-${o.month}-${o.day}`; }
const todayKey = () => keyOf(new Date(), LOCAL_TZ);
function toLocalInput(e) { const o = {}; F(e._tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-CA').formatToParts(new Date(e.date)).forEach(p => o[p.type] = p.value); return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`; }
function fromLocalInput(v, tz) { // wall time in tz -> ISO UTC
  const guess = new Date(v + ':00Z');
  const o = {}; F(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-CA').formatToParts(guess).forEach(p => o[p.type] = p.value);
  const shown = Date.UTC(+o.year, o.month - 1, +o.day, +o.hour, +o.minute);
  return new Date(guess.getTime() - (shown - guess.getTime())).toISOString();
}

/* ---------- entries ---------- */
const MEDIA_RE = /!\[[^\]]*\]\(media:([\w.:~-]+)\)/g;
function plain(t) { return String(t || '').replace(MEDIA_RE, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`~]|^\s*[-+]\s(\[[ xX]\]\s)?|^\s*\d+[.)]\s/gm, '').trim(); }
function norm(id, d) {
  const e = { ...d, id, tags: Array.isArray(d.tags) ? d.tags : [], media: Array.isArray(d.media) ? d.media : [] };
  // An entry can be in several journals; the first one is its main journal and sets its color.
  const jl = (Array.isArray(d.journals) && d.journals.length ? d.journals : [d.journal || 'Journal']).filter(x => typeof x === 'string' && x.trim());
  e.journals = [...new Set(jl.length ? jl : ['Journal'])]; e.journal = e.journals[0];
  e._tz = tzOk(e.tz || LOCAL_TZ);
  const dt = new Date(e.date); if (isNaN(dt)) { e.date = new Date().toISOString(); }
  e._k = keyOf(new Date(e.date), e._tz); e._md = e._k.slice(5); e._ym = e._k.slice(0, 7);
  const lines = plain(e.text).split('\n').map(s => s.trim()).filter(Boolean);
  e._title = lines[0] || 'Untitled';
  e._ex = lines.slice(1).join(' ').slice(0, 240);
  e._words = plain(e.text).split(/\s+/).filter(Boolean).length;
  e._hay = (e.text + ' ' + e.tags.join(' ') + ' ' + (e.place || '') + ' ' + e.journals.join(' ')).toLowerCase();
  return e;
}
function body(e) { return { date: e.date, tz: e.tz || LOCAL_TZ, text: e.text || '', tags: e.tags || [], journals: e.journals && e.journals.length ? [...e.journals] : [e.journal || 'Journal'], journal: (e.journals && e.journals[0]) || e.journal || 'Journal', starred: !!e.starred, place: e.place || '', weather: e.weather || null, created: e.created || e.date, modified: e.modified || e.date, source: e.source || 'journal', ...(e.mergedFrom && e.mergedFrom.length ? { mergedFrom: [...e.mergedFrom] } : {}) }; }
const sorted = memo(() => [...entries.values()].sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
function filtered() {
  const q = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return sorted().filter(e => (!S.journal || e.journals.includes(S.journal)) && (!S.tag || e.tags.includes(S.tag)) && (!S.starred || e.starred) && (!S.day || e._k === S.day) && q.every(w => e._hay.includes(w)));
}
const weatherTxt = w => w && typeof w.c === 'number' ? `${USE_F ? Math.round(w.c * 9 / 5 + 32) + '°F' : Math.round(w.c) + '°C'}${w.desc ? ' ' + w.desc : ''}` : '';

async function withRetry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (err) {
      const c = err && err.code;
      if (i >= 6 || !(c === 'resource_exhausted' || c === 'unavailable')) throw err;
      await sleep(700 * 2 ** i + Math.random() * 400);
    }
  }
}

/* ---------- markdown ---------- */
function inline(s, e) {
  const hold = []; const put = h => '\u0000' + (hold.push(h) - 1) + '\u0000';
  let t = String(s).replace(MEDIA_RE, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/`([^`]+)`/g, (_, c) => put('<code>' + esc(c) + '</code>'));
  t = t.replace(/\[([^\]]+)\]\(<?(https:\/\/[^)\s>]+)>?\)/g, (_, a, h) => put(`<a href="${esc(h)}" target="_blank" rel="noopener">${esc(a)}</a>`));
  let h = esc(t);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  h = h.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return h.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[i]);
}
function md(text, e) {
  let out = '', list = null, para = [];
  const flush = () => { if (para.length) { out += '<p>' + para.map(l => inline(l, e)).join('<br>') + '</p>'; para = []; } };
  const close = () => { if (list) { out += `</${list === 'chk' ? 'ul' : list}>`; list = null; } };
  const open = k => { if (list !== k) { close(); out += k === 'chk' ? '<ul class="chk">' : `<${k}>`; list = k; } };
  for (const raw of String(text || '').split('\n')) {
    const l = raw.replace(/\s+$/, ''); let m;
    if (!l.trim()) { flush(); close(); continue; }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { flush(); close(); const n = Math.min(m[1].length + 1, 4); out += `<h${n}>${inline(m[2], e)}</h${n}>`; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); close(); out += '<hr>'; continue; }
    if ((m = l.match(/^\s*[-*+]\s+\[( |x|X)\]\s*(.*)$/))) { flush(); open('chk'); out += `<li class="${m[1] === ' ' ? '' : 'done'}">${inline(m[2], e)}</li>`; continue; }
    if ((m = l.match(/^\s*[-*+]\s+(.*)$/))) { flush(); open('ul'); out += `<li>${inline(m[1], e)}</li>`; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { flush(); open('ol'); out += `<li>${inline(m[1], e)}</li>`; continue; }
    if ((m = l.match(/^>\s?(.*)$/))) { flush(); close(); out += `<blockquote>${inline(m[1], e)}</blockquote>`; continue; }
    close(); para.push(l);
  }
  flush(); close(); return out;
}

/* ---------- ui helpers ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function status(msg) { $('#status').textContent = msg || ''; }
function ask(title, text, yes = 'Delete') {
  return new Promise(res => {
    $('#m-t').textContent = title; $('#m-p').textContent = text; $('#m-yes').textContent = yes; $('#modal').hidden = false; $('#m-yes').focus();
    const done = v => { $('#modal').hidden = true; $('#m-yes').onclick = $('#m-no').onclick = null; res(v); };
    $('#m-yes').onclick = () => done(true); $('#m-no').onclick = () => done(false);
  });
}
function setHH() { document.documentElement.style.setProperty('--hh', $('#top').offsetHeight + 'px'); }

/* ---------- views ---------- */
const statsText = memo(() => {
  const all = [...entries.values()]; if (!all.length) return '';
  const days = new Set(all.map(e => e._k)); let streak = 0;
  const d = new Date(); if (!days.has(keyOf(d, LOCAL_TZ))) d.setDate(d.getDate() - 1);
  while (days.has(keyOf(d, LOCAL_TZ))) { streak++; d.setDate(d.getDate() - 1); }
  const words = all.reduce((s, e) => s + e._words, 0);
  return `${all.length.toLocaleString()} entries · ${days.size.toLocaleString()} days · ${words.toLocaleString()} words${streak ? ` · ${streak}-day streak` : ''}`;
});
function stats() { $('#stats').textContent = statsText(); }
const journals = memo(() => { const s = new Set(J.keys()); entries.forEach(e => e.journals.forEach(j => s.add(j))); return [...s].sort((a, b) => a.localeCompare(b)); });
/** Give every journal without settings the next unused color, and save it. */
async function ensureJournals() {
  const used = new Set([...J.values()].map(j => j.color));
  for (const name of journals()) {
    if (J.has(name)) continue;
    const preset = HEX.test(PRESET[name] || '') ? PRESET[name] : null;
    const free = PALETTE.find(p => !used.has(p[1]) && !Object.values(PRESET).includes(p[1])) || PALETTE.find(p => !used.has(p[1])) || PALETTE[J.size % PALETTE.length];
    const j = { name, color: preset || free[1], created: new Date().toISOString() };
    J.set(name, j); used.add(j.color);
    try { await store.putJournal(j); } catch {}
  }
}
/** Entry count, days, words and first/last entry for each journal, in one pass. */
const journalStats = memo(() => {
  const agg = new Map();
  for (const e of entries.values()) {
    for (const k of e.journals) {
      let a = agg.get(k);
      if (!a) agg.set(k, a = { n: 0, words: 0, days: new Set(), first: e, last: e });
      a.n++; a.words += e._words; a.days.add(e._k);
      if (e.date < a.first.date) a.first = e; if (e.date > a.last.date) a.last = e;
    }
  }
  return agg;
});
const tags = memo(() => { const c = new Map(); entries.forEach(e => e.tags.forEach(t => c.set(t, (c.get(t) || 0) + 1))); return [...c].sort((a, b) => b[1] - a[1]).map(x => x[0]); });

/** The card's left edge: one stripe per journal the entry is in. */
function edgeOf(e) {
  const cs = e.journals.map(colorOf); if (cs.length === 1) return cs[0];
  return 'linear-gradient(' + cs.map((c, i) => `${c} ${(100 * i / cs.length).toFixed(1)}% ${(100 * (i + 1) / cs.length).toFixed(1)}%`).join(',') + ')';
}
function cardHTML(e, showJ) {
  const jl = S.journal ? e.journals.filter(j => j !== S.journal) : (showJ ? e.journals : []);
  const meta = [fmt(e, { hour: 'numeric', minute: '2-digit' })];
  if (e.place) meta.push(esc(e.place));
  if (e.weather) meta.push(esc(weatherTxt(e.weather)));
  const tg = e.tags.slice(0, 4).map(t => `<span class="tag">#${esc(t)}</span>`).join(' ');
  return `<button class="card" data-id="${esc(e.id)}" style="--jc:${colorOf(S.journal && e.journals.includes(S.journal) ? S.journal : e.journal)};--edge:${edgeOf(e)}">
    <div class="dn"><b>${esc(fmt(e, { day: 'numeric' }))}</b><span>${esc(fmt(e, { weekday: 'short' }))}</span></div>
    <div><h3>${esc(e._title)}</h3>${e._ex ? `<p>${esc(e._ex)}</p>` : ''}
    <div class="meta">${e.starred ? `<span class="st">${ICON.star}</span>` : ''}${meta.map(m => `<span>${m}</span>`).join('')}${jl.map(j => `<span class="jtag" style="--jc:${colorOf(j)}"><i class="dot"></i>${esc(j)}</span>`).join('')}${tg}</div></div>
</button>`;
}

function renderEntries() {
  const list = filtered(); const js = journals(); const ts = tags(); const showJ = !S.journal && js.length > 1;
  let h = '';
  if (S.journal) {
    const a = journalStats().get(S.journal);
    h += `<section class="jban" style="--jc:${colorOf(S.journal)}">
      <button class="jback" data-openj="">‹ All entries</button>
      <h2>${esc(S.journal)}</h2>
      <p>${a ? `${a.n.toLocaleString()} ${a.n === 1 ? 'entry' : 'entries'} · ${a.days.size.toLocaleString()} days · ${a.words.toLocaleString()} words` : 'No entries yet'}</p>
      <button class="btn" data-editj="${esc(S.journal)}">Edit journal</button>
    </section>`;
  }
  h += `<div class="filters">
    <button class="chip" data-j="" aria-pressed="${!S.journal}">All</button>
    ${js.length > 1 ? js.map(j => `<button class="chip jc" style="--jc:${colorOf(j)}" data-j="${esc(j)}" aria-pressed="${S.journal === j}"><i class="dot"></i>${esc(j)}</button>`).join('') : ''}
    <button class="chip" id="fstar" aria-pressed="${S.starred}">${ICON.star} Starred</button>
    ${ts.length ? `<label class="chip">Tag <select id="ftag"><option value="">Any</option>${ts.map(t => `<option ${S.tag === t ? 'selected' : ''} value="${esc(t)}">${esc(t)}</option>`).join('')}</select></label>` : ''}
    ${S.day ? `<button class="chip" id="fday" aria-pressed="true">${esc(S.day)} ✕</button>` : ''}
  </div>`;
  const plainView = !S.q && !S.journal && !S.tag && !S.starred && !S.day;
  if (plainView) {
    const tmd = todayKey().slice(5), yr = todayKey().slice(0, 4);
    const otd = sorted().filter(e => e._md === tmd && e._k.slice(0, 4) !== yr);
    if (otd.length) h += `<section class="otd"><h2>On this day</h2><div class="rail">${otd.map(e => `<button class="tile" data-id="${esc(e.id)}" style="--jc:${colorOf(e.journal)}"><span class="yr">${esc(e._k.slice(0, 4))}</span><span class="tl">${esc(e._title)}</span></button>`).join('')}</div></section>`;
  }
  if (!list.length && !S.q && !S.tag && !S.starred && !S.day) {
    h += S.journal ? `<div class="empty"><h2>Nothing in ${esc(S.journal)} yet</h2><p><button class="btn pri" data-act="new">Write an entry</button></p></div>` : `<div class="empty"><h2>Your first page is blank</h2><p>Write today’s entry, or bring your Day One journals across from the Settings tab.</p><p><button class="btn pri" data-act="new">Write an entry</button> <button class="btn" data-act="import">Import from Day One</button></p></div>`;
  } else if (!list.length) {
    h += `<div class="empty"><h2>Nothing matches</h2><p>Try a different search or clear the filters.</p></div>`;
  } else {
    let ym = '';
    for (const e of list.slice(0, S.shown)) {
      if (e._ym !== ym) { ym = e._ym; h += `<h2 class="month">${esc(fmt(e, { month: 'long', year: 'numeric' }))}</h2>`; }
      h += cardHTML(e, showJ);
    }
    if (list.length > S.shown) h += `<div class="more"><button class="btn" id="more">Show more (${(list.length - S.shown).toLocaleString()} left)</button></div>`;
  }
  $('#main').innerHTML = h;
}

function renderJournals() {
  const agg = journalStats(); const js = journals();
  if (!js.length) {
    $('#main').innerHTML = `<div class="empty"><h2>Your first page is blank</h2><p>Start a journal, or bring your Day One journals across from the Settings tab.</p><p><button class="btn pri" data-newj>New journal</button> <button class="btn" data-act="import">Import from Day One</button></p></div>`;
    return;
  }
  const span = a => { const f = fmt(a.first, { month: 'short', year: 'numeric' }), l = fmt(a.last, { month: 'short', year: 'numeric' }); return f === l ? f : `${f} – ${l}`; };
  const book = (name, color, a, cls, key) => `<button class="jcard ${cls}" style="--jc:${color}" data-openj="${esc(key)}">
      <span class="jname">${esc(name)}</span>
      <span class="jcount"><b>${(a ? a.n : 0).toLocaleString()}</b>${a && a.n === 1 ? 'entry' : 'entries'}</span>
      <span class="jspan">${a ? esc(span(a)) : 'No entries yet'}</span>
      ${a ? `<span class="jlast">${esc(a.last._title)}</span>` : ''}
    </button>`;
  let all = null;
  if (entries.size) { const sd = sorted(); all = { n: sd.length, first: sd[sd.length - 1], last: sd[0] }; }
  $('#main').innerHTML = `${backupNudge()}<div class="jgrid">
    ${js.length > 1 ? book('All Entries', '#2a2f3a', all, 'all', '') : ''}
    ${js.map(j => book(j, colorOf(j), agg.get(j), '', j)).join('')}
    <button class="jcard new" data-newj><svg class="ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>New journal</button>
  </div>`;
}

/** Colors for a day: the selected journal's, or every journal with an entry that day. */
function dayColors(es) { return [...new Set(es.flatMap(e => S.journal ? [S.journal] : e.journals).map(colorOf))]; }
/** One flat color, or an equal slice of each color. */
function fillOf(cs) { return cs.length === 1 ? cs[0] : `conic-gradient(${cs.map((c, i) => `${c} ${Math.round(360 * i / cs.length)}deg ${Math.round(360 * (i + 1) / cs.length)}deg`).join(',')})`; }
const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const label = (k, n) => `${k}, ${n} ${n === 1 ? 'entry' : 'entries'}`;
const dkey = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Entries live only in this browser, so nudge for a backup every 30 days. */
function backupNudge() {
  if (!entries.size) return '';
  const days = daysSinceBackup();
  if (days !== null && days < 30) return '';
  return `<div class="nudge"><span>${days === null ? 'You haven’t backed up your journal yet.' : `Your last backup was ${days} days ago.`} Entries are saved only in this browser.</span><button class="btn" id="export">Save backup</button></div>`;
}

function renderCalendar() {
  const now = new Date(); if (!S.cal) S.cal = { y: now.getFullYear(), m: now.getMonth() };
  const mode = S.calMode || 'month', { y, m } = S.cal, tk = todayKey();
  const byDay = new Map();
  entries.forEach(e => { if (S.journal && !e.journals.includes(S.journal)) return; let a = byDay.get(e._k); if (!a) byDay.set(e._k, a = []); a.push(e); });
  let body, title, count = 0, days = 0;
  if (mode === 'years') return renderYears(byDay, tk);
  if (mode === 'month') {
    const first = new Date(y, m, 1), n = new Date(y, m + 1, 0).getDate();
    let cells = WD.map(d => `<div class="wd">${d}</div>`).join('') + '<div></div>'.repeat(first.getDay());
    for (let d = 1; d <= n; d++) {
      const k = dkey(y, m, d), es = byDay.get(k) || [], cs = es.length ? dayColors(es) : [];
      count += es.length; if (es.length) days++;
      cells += `<button class="d${es.length ? ' has' : ''}${cs.length === 1 ? ' one' : ''}${k === tk ? ' today' : ''}" ${es.length ? `data-day="${k}"` : 'disabled'} ${cs.length ? `style="--dc:${cs[0]}"` : ''} aria-label="${label(k, es.length)}"><span class="n">${d}</span>${es.length > 1 ? `<em class="ct">${es.length}</em>` : ''}${cs.length ? `<span class="dots">${cs.slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>` : ''}</button>`;
    }
    body = `<div class="cal">${cells}</div>`;
    title = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  } else {
    let months = '';
    for (let mm = 0; mm < 12; mm++) {
      const first = new Date(y, mm, 1), n = new Date(y, mm + 1, 0).getDate();
      let cells = '<i></i>'.repeat(first.getDay()), mc = 0;
      for (let d = 1; d <= n; d++) {
        const k = dkey(y, mm, d), es = byDay.get(k) || [];
        if (es.length) { mc += es.length; days++; cells += `<button class="yd has${k === tk ? ' today' : ''}" data-day="${k}" style="background:${fillOf(dayColors(es))}" aria-label="${label(k, es.length)}">${d}</button>`; }
        else cells += `<span class="yd${k === tk ? ' today' : ''}">${d}</span>`;
      }
      count += mc;
      months += `<section class="ym"><button class="ymh" data-month="${mm}" aria-label="Open ${first.toLocaleDateString(undefined, { month: 'long' })}"><b>${first.toLocaleDateString(undefined, { month: 'long' })}</b>${mc ? `<span>${mc}</span>` : ''}</button><div class="ygrid">${cells}</div></section>`;
    }
    body = `<div class="year">${months}</div>`;
    title = String(y);
  }
  const sub = `${count.toLocaleString()} ${count === 1 ? 'entry' : 'entries'}${days ? ` on ${days} ${days === 1 ? 'day' : 'days'}` : ''}${S.journal ? ` in <b style="color:${colorOf(S.journal)}">${esc(S.journal)}</b>` : ''}`;
  const years = [...new Set([...entries.values()].filter(e => !S.journal || e.journals.includes(S.journal)).map(e => e._k.slice(0, 4)))].sort().reverse();
  const unit = mode === 'month' ? 'month' : 'year';
  $('#main').innerHTML = `${calBar(mode)}
    <div class="calh"><button class="iconbtn" id="cprev" aria-label="Previous ${unit}"><svg class="ico" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>
    <div style="text-align:center"><h2>${title}</h2><span class="calsub">${sub}</span></div>
    <button class="iconbtn" id="cnext" aria-label="Next ${unit}"><svg class="ico" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button></div>
    ${calFilters()}
    ${body}
    ${years.length ? `<div class="yearrow">Jump to: ${years.map(yy => `<button class="chip" data-y="${yy}" aria-pressed="${+yy === y}">${yy}</button>`).join('')}<button class="chip" data-y="now">Today</button></div>` : ''}`;
}
function calBar(mode) {
  return `<div class="calbar"><div class="seg" role="group" aria-label="Calendar view">${[['month', 'Month'], ['year', 'Year'], ['years', 'All years']].map(([k, l]) => `<button data-calmode="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div></div>`;
}
function calFilters() {
  return journals().length > 1 ? `<div class="filters"><button class="chip" data-j="" aria-pressed="${!S.journal}">All</button>${journals().map(j => `<button class="chip jc" style="--jc:${colorOf(j)}" data-j="${esc(j)}" aria-pressed="${S.journal === j}"><i class="dot"></i>${esc(j)}</button>`).join('')}</div>` : '';
}
/** Every year from your first entry to now, newest first: a strip of weeks per year, days in journal colors. */
function renderYears(byDay, tk) {
  const keys = [...byDay.keys()].sort();
  const nowY = new Date().getFullYear();
  if (!keys.length) {
    $('#main').innerHTML = `${calBar('years')}${calFilters()}<div class="empty"><h2>No entries yet</h2><p>Your years will fill in here as you write.</p></div>`;
    return;
  }
  const firstY = +keys[0].slice(0, 4), lastY = Math.max(nowY, +keys[keys.length - 1].slice(0, 4));
  const perYear = new Map();
  for (const [k, es] of byDay) { const y = +k.slice(0, 4); let a = perYear.get(y); if (!a) perYear.set(y, a = { n: 0, days: 0, js: new Map() }); a.n += es.length; a.days++; for (const e of es) for (const j of (S.journal ? [S.journal] : e.journals)) a.js.set(j, (a.js.get(j) || 0) + 1); }
  let out = '', gap = [], total = 0;
  const flushGap = () => { if (!gap.length) return; out += `<p class="ygap">${gap.length === 1 ? gap[0] : `${gap[gap.length - 1]}–${gap[0]}`} · no entries</p>`; gap = []; };
  for (let y = lastY; y >= firstY; y--) {
    const a = perYear.get(y);
    if (!a && y !== nowY) { gap.push(y); continue; }
    flushGap();
    total += a ? a.n : 0;
    const jan1 = new Date(y, 0, 1), nd = (new Date(y + 1, 0, 1) - jan1) / 864e5;
    let cells = '<i></i>'.repeat(jan1.getDay());
    for (let i = 0; i < nd; i++) {
      const d = new Date(y, 0, 1 + i), k = dkey(y, d.getMonth(), d.getDate()), es = byDay.get(k);
      cells += es ? `<b data-day="${k}" class="${k === tk ? 'today' : ''}" style="background:${fillOf(dayColors(es))}" title="${label(k, es.length)}"></b>` : `<i${k === tk ? ' class="today"' : ''}></i>`;
    }
    const share = a ? [...a.js].sort((p, q) => q[1] - p[1]) : [];
    const sum = share.reduce((t, p) => t + p[1], 0);
    out += `<section class="yrow">
      <button class="yrh" data-yopen="${y}"><b>${y}</b><span>${a ? `${a.n.toLocaleString()} ${a.n === 1 ? 'entry' : 'entries'} · ${a.days} ${a.days === 1 ? 'day' : 'days'}` : 'No entries yet'}</span></button>
      <div class="ystrip" role="img" aria-label="${y}: ${a ? a.n : 0} entries">${cells}</div>
      ${share.length > 1 ? `<div class="yshare">${share.map(([j, n]) => `<i style="flex:${n};background:${colorOf(j)}" title="${esc(j)}: ${n}"></i>`).join('')}</div>` : ''}
    </section>`;
  }
  const yrs = lastY - firstY + 1;
  $('#main').innerHTML = `${calBar('years')}
    <div class="calh"><span></span><div style="text-align:center"><h2>All years</h2><span class="calsub">${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'} across ${yrs} ${yrs === 1 ? 'year' : 'years'}${S.journal ? ` in <b style="color:${colorOf(S.journal)}">${esc(S.journal)}</b>` : ''}</span></div><span></span></div>
    ${calFilters()}
    <div class="years">${out}</div>`;
}
/** Step the calendar one month (month view) or one year (year view). */
function calStep(dir) {
  let { y, m } = S.cal;
  if (S.calMode === 'years') return;
  if (S.calMode === 'year') y += dir;
  else { m += dir; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } }
  S.cal = { y, m }; render();
}

function renderImport() {
  $('#main').innerHTML = `<section class="imp">
    <h2>Bring over your Day One journals</h2>
    <ol>
      <li>In Day One, open <b>Settings → Import/Export → Export</b> (on Mac: File → Export).</li>
      <li>Choose <b>JSON</b> format and the journals you want. You'll get a <b>.zip</b> file.</li>
      <li>Pick that .zip below. A single <b>Journal.json</b> from inside it works too, and so does a Journalsism backup file.</li>
    </ol>
    <label class="drop" id="drop"><input type="file" id="file" accept=".zip,.json,application/zip,application/json">
      <b>Choose your Day One export</b><br><span style="color:var(--mute);font-size:14px">or drop it here</span></label>
    <label class="chk2"><input type="checkbox" id="skip" checked> Skip entries already imported (safe to re-run if an import stops)</label>
    <div id="prog" hidden><div class="bar"><div id="pbar"></div></div><div id="ptxt" style="font-weight:600"></div><div class="log" id="plog"></div></div>
  </section>
  <section class="imp" id="pinsec"></section>
  <section class="imp" id="remind"></section>
  <section class="imp" id="dups">
    <h2>Copies across journals</h2>
    <p style="color:var(--mute);margin:0 0 14px">Day One can't put one entry in two journals, so you may have copied some. Merge each copy into one entry that's filed in all of its journals. The earliest version is kept.</p>
    <div id="duplist"></div>
    <button class="btn" id="findcopies" ${entries.size ? '' : 'disabled'}>Find copies</button>
  </section>
  <section class="imp">
    <h2>Backup</h2>
    <p style="color:var(--mute);margin:0 0 14px">Entries are saved in this browser only. A backup is one .json file with every entry, journal and color. To restore it, pick the file in the importer above.</p>
    <span id="unlockslot"></span>
    <button class="btn" id="export" ${entries.size ? '' : 'disabled'}>Save backup (${entries.size.toLocaleString()} entries)</button>
    <p class="hint" style="margin:10px 0 0">${daysSinceBackup() === null ? 'No backup yet.' : `Last backup: ${daysSinceBackup() === 0 ? 'today' : daysSinceBackup() + ' days ago'}.`} You'll be reminded every 30 days. On iPhone, choose <b>Save to Files</b> → iCloud Drive.</p>
  </section>`;
  const drop = $('#drop');
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, x => { x.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', x => { x.preventDefault(); const f = x.dataTransfer.files[0]; if (f) runImport(f); });
  $('#file').addEventListener('change', x => { const f = x.target.files[0]; if (f) runImport(f); x.target.value = ''; });
  drawCopies();
  drawReminders();
  drawPinSection();
  fetchLocked().then(d => { const el = $('#unlockslot'); if (d && el) el.innerHTML = '<button class="btn" id="unlockrepo">Unlock the journal saved on this site</button>'; });
}

/* ---------- daily reminder (push notifications) and Home Screen badge ---------- */
const CFG = window.JOURNALISM_CONFIG || {};
const REMIND_TEXT = CFG.REMINDER_TEXT || 'What happened today?';
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** This device's own push key pair (made on the phone, never sent anywhere except the setup code you copy). */
async function deviceKeys() {
  try { const k = JSON.parse(localStorage.getItem('journalism.pushKeys') || 'null'); if (k && k.pub && k.priv) return k; } catch {}
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const k = { pub: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)), priv: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d };
  localStorage.setItem('journalism.pushKeys', JSON.stringify(k));
  return k;
}
/** One line to paste into the PUSH_SUBSCRIPTIONS secret: this device's subscription plus its keys. */
function setupCode(sub) { let k = null; try { k = JSON.parse(localStorage.getItem('journalism.pushKeys') || 'null'); } catch {} return JSON.stringify(k ? { s: sub.toJSON(), k: k.pub, p: k.priv } : sub.toJSON()); }
function b64ToBytes(s) { const r = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); }
const swReg = async () => ('serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistration()) || null : null);
/** Badge "1" on the app icon until you've written something today. */
async function updateBadge() {
  if (!navigator.setAppBadge) return;
  const tk = todayKey(); const wrote = sorted().slice(0, 40).some(e => keyOf(new Date(e.date), LOCAL_TZ) === tk);
  try { if (wrote) await navigator.clearAppBadge(); else await navigator.setAppBadge(1); } catch {}
}
async function drawReminders() {
  const el = $('#remind'); if (!el) return;
  let h = '<h2>Daily reminder</h2>';
  if (isIOS() && !isStandalone()) h += `<p style="margin:0 0 8px">To get a nightly “${esc(REMIND_TEXT)}” notification and a badge on the app icon, add Journalsism to your Home Screen first:</p>
    <ol><li>Tap the <b>Share</b> button in Safari.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open Journalsism from the new icon and come back to Settings.</li></ol>
    <p class="hint">The Home Screen app keeps its own copy of your journal, so import your Day One file or a backup there.</p>`;
  else if (!pushSupported()) h += '<p class="hint">This browser can\'t receive notifications. On iPhone, open Journalsism from its Home Screen icon.</p>';
  else {
    const reg = await swReg(); const sub = reg && await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') {
      h += `<p style="margin:0 0 8px"><b>Reminders are on for this device.</b> Last step, once per device: copy this setup code and paste it into the <code>PUSH_SUBSCRIPTIONS</code> secret in your GitHub repo. Keep it private; it works like a password for your reminders.</p>
        <textarea class="subcode" id="subcode" readonly aria-label="Setup code">${esc(setupCode(sub))}</textarea>
        <div class="acts2"><button class="btn pri" id="copysub">Copy setup code</button><button class="btn" id="testpush">Test notification</button><button class="btn" id="pushoff">Turn off</button></div>`;
    } else if (Notification.permission === 'denied') {
      h += '<p style="margin:0">Notifications are blocked for Journalsism. Turn them on in your iPhone\'s <b>Settings → Notifications → Journalsism</b>, then come back here.</p>';
    } else {
      h += `<p style="margin:0 0 12px">Get a “${esc(REMIND_TEXT)}” notification every evening, and a badge on the app icon on days you haven't written yet.</p><button class="btn pri" id="pushon">Turn on daily reminders</button>`;
    }
  }
  el.innerHTML = h;
}
async function turnOnPush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications were not allowed'); return drawReminders(); }
    const reg = await navigator.serviceWorker.ready;
    const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe();
    const keys = await deviceKeys();
    await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(keys.pub) });
    updateBadge(); toast('Reminders turned on'); drawReminders();
  } catch (err) { toast('Could not turn on reminders: ' + ((err && err.message) || err)); }
}

/* ---------- copies across journals ---------- */
/** Overlapping 5-word phrases of an entry's text, used to spot copies. */
function shingles(t) {
  const w = (plain(t).toLowerCase().match(/[a-z0-9']+/g) || []).map(h32); const s = new Set();
  for (let i = 0; i + 5 <= w.length; i++) s.add((Math.imul(w[i], 31) ^ Math.imul(w[i + 1], 961) ^ Math.imul(w[i + 2], 29791) ^ Math.imul(w[i + 3], 923521) ^ Math.imul(w[i + 4], 28629151)) >>> 0);
  if (!s.size && w.length) s.add(w.reduce((a, b) => Math.imul(a, 31) ^ b, 7) >>> 0);
  return s;
}
function h32(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Groups of entries in different journals whose text is (nearly) the same, oldest first. */
function findCopies() {
  const list = [...entries.values()].map(e => ({ e, sh: shingles(e.text) })).filter(x => x.sh.size >= 3);
  const buckets = new Map();   // only compare entries that share one of their 16 lowest phrase hashes
  list.forEach((x, i) => [...x.sh].sort((a, b) => a - b).slice(0, 16).forEach(h => { let b = buckets.get(h); if (!b) buckets.set(h, b = []); b.push(i); }));
  const parent = list.map((_, i) => i); const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const seen = new Set();
  for (const b of buckets.values()) for (let a = 0; a < b.length; a++) for (let c = a + 1; c < b.length; c++) {
    const i = Math.min(b[a], b[c]), j = Math.max(b[a], b[c]), key = i + ',' + j;
    if (seen.has(key)) continue; seen.add(key);
    const x = list[i], y = list[j];
    if (x.e.journals.some(k => y.e.journals.includes(k))) continue; // already share a journal
    let inter = 0; for (const p of x.sh) if (y.sh.has(p)) inter++;
    if (inter / Math.min(x.sh.size, y.sh.size) >= 0.9) parent[find(i)] = find(j);
  }
  const groups = new Map(); list.forEach((x, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x.e); });
  return [...groups.values()].filter(g => g.length > 1).map(g => g.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).sort((a, b) => a[0].date < b[0].date ? 1 : -1);
}
/** Keep the oldest entry, file it in every journal of the group, delete the copies. */
async function mergeGroup(g) {
  const [keep, ...rest] = g;
  const js = [...new Set(g.flatMap(e => e.journals))];
  const b = { ...body(keep), journals: js, journal: js[0], starred: g.some(e => e.starred), tags: [...new Set(g.flatMap(e => e.tags))],
    place: keep.place || (rest.find(e => e.place) || {}).place || '', weather: keep.weather || (rest.find(e => e.weather) || {}).weather || null,
    modified: new Date().toISOString(), mergedFrom: [...new Set([...(keep.mergedFrom || []), ...rest.flatMap(e => [e.id, ...(e.mergedFrom || [])])])] };
  await store.put(keep.id, b); entries.set(keep.id, norm(keep.id, b));
  for (const e of rest) { await store.delete(e.id); entries.delete(e.id); }
}
function drawCopies() {
  const el = $('#duplist'); if (!el) return; const g = S.copies;
  if (!g) { el.innerHTML = ''; return; }
  if (!g.length) { el.innerHTML = '<p class="hint" style="margin:0 0 12px">No copies found. Every entry is in one place.</p>'; return; }
  el.innerHTML = `<p style="margin:0 0 6px;font-weight:600">${g.length} ${g.length === 1 ? 'entry is' : 'entries are'} copied into more than one journal:</p>
    <ul class="copies">${g.map((grp, i) => `<li><label class="chk2"><input type="checkbox" data-ci="${i}" checked><span><b>${esc(grp[0]._title)}</b> <small>${esc(fmt(grp[0], { month: 'short', day: 'numeric', year: 'numeric' }))}</small><br>${[...new Set(grp.flatMap(e => e.journals))].map(j => `<span class="jtag" style="--jc:${colorOf(j)}"><i class="dot"></i>${esc(j)}</span>`).join(' ')}</span></label></li>`).join('')}</ul>
    <button class="btn pri" id="mergecopies">Merge selected</button>`;
}

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.v === S.view));
  stats();
  if (importing && S.view === 'import') return;
  ({ journals: renderJournals, entries: renderEntries, calendar: renderCalendar, import: renderImport })[S.view]();
}

/* ---------- entry sheet ---------- */
let cur = null, editing = false, saveT = null, chain = Promise.resolve(), lastSaved = '';
function openEntry(id, edit) {
  const e = id ? entries.get(id) : null; if (id && !e) return;
  if (!e && !store) { toast('Journal storage is not ready yet'); return; }
  const nowISO = new Date().toISOString();
  cur = e ? norm(e.id, body(e)) : norm('e-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), { date: nowISO, tz: LOCAL_TZ, text: '', tags: [], journals: [S.journal || (sorted()[0] || {}).journal || journals()[0] || 'Journal'], created: nowISO, modified: nowISO });
  lastSaved = e ? JSON.stringify(body(e)) : '';
  editing = !!edit || !e; $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; drawSheet();
  if (editing) setTimeout(() => $('#ed-text') && $('#ed-text').focus(), 50);
}
/** Show the first line as the title even when it was written without a leading #. */
const asTitled = t => String(t || '').replace(/^\s*(?!#|[-*+>]\s|\d+[.)]\s|!\[)(\S[^\n]*)/, '# $1');
function drawSheet() {
  const e = cur;
  $('#sheet').style.setProperty('--jc', colorOf(e.journal));
  $('#when').innerHTML = `${esc(fmt(e, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}<small>${esc(fmt(e, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }))}</small>`;
  $('#star').classList.toggle('on', !!e.starred); $('#star').setAttribute('aria-pressed', !!e.starred);
  $('#mode').textContent = editing ? 'Done' : 'Edit';
  if (!editing) {
    const where = [String(e.place || '').replace(/,\s*(United States|USA|US)$/i, ''), weatherTxt(e.weather)].filter(Boolean).join(' · ');
    const facts = [where, ...e.tags.map(t => '#' + t)].filter(Boolean);
    $('#sbody').innerHTML = `<article class="prose"><div class="facts">${e.journals.map(j => `<span class="jf" style="--jc:${colorOf(j)}">${esc(j)}</span>`).join('')}${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>${md(asTitled(e.text), e) || '<p style="color:var(--mute)">Empty entry</p>'}</article>`;
    return;
  }
  const all = tags();
  $('#sbody').innerHTML = `<div class="ed">
    <textarea id="ed-text" placeholder="What's on your mind today?" aria-label="Entry text">${esc(e.text)}</textarea>
    <div class="edbar">
      <span id="saved">${lastSaved ? 'Saved' : ''}</span>
    </div>
    <div class="jpick" id="ed-jpick" role="group" aria-label="Journal">${jpickHTML(e.journals)}</div>
    <p class="hint">Tap to file this entry in more than one journal. The first one sets its color.</p>
    <div class="fields">
      <label>Date &amp; time<input id="ed-date" type="datetime-local" value="${esc(toLocalInput(e))}"></label>
      <label>Tags (comma separated)<input id="ed-tags" list="dl-t" value="${esc(e.tags.join(', '))}"><datalist id="dl-t">${all.slice(0, 50).map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
      <label>Place<input id="ed-place" value="${esc(e.place || '')}" placeholder="Where are you?"></label>
    </div>
    <p style="color:var(--mute);font-size:13px;margin:0">Formatting: # heading, **bold**, *italic*, - list, - [ ] checklist, &gt; quote. The first line is the entry's title.</p>
  </div>`;
  const t = $('#ed-text');
  t.addEventListener('input', () => { cur.text = t.value; queueSave(); });
  $('#ed-date').addEventListener('change', x => { if (x.target.value) { cur.date = fromLocalInput(x.target.value, cur._tz); cur = norm(cur.id, { ...body(cur), text: cur.text }); queueSave(); $('#when').innerHTML = `${esc(fmt(cur, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}<small>${esc(fmt(cur, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }))}</small>`; } });
  const setJournals = js => { cur.journals = js; cur.journal = js[0]; $('#ed-jpick').innerHTML = jpickHTML(js); $('#sheet').style.setProperty('--jc', colorOf(js[0])); queueSave(); };
  $('#ed-jpick').addEventListener('click', x => {
    const b = x.target.closest('[data-pick]');
    if (b) {
      const js = cur.journals.slice(), i = js.indexOf(b.dataset.pick);
      if (i < 0) js.push(b.dataset.pick);
      else if (js.length === 1) return toast('An entry needs at least one journal');
      else js.splice(i, 1);
      return setJournals(js);
    }
    if (x.target.closest('[data-pick-new]')) openJournalDialog(null, nn => setJournals([...cur.journals, nn]));
  });
  $('#ed-tags').addEventListener('input', x => { cur.tags = [...new Set(x.target.value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean))]; queueSave(); });
  $('#ed-place').addEventListener('input', x => { cur.place = x.target.value; queueSave(); });
}
function jpickHTML(sel) {
  return journals().map(j => `<button type="button" class="chip jc" style="--jc:${colorOf(j)}" data-pick="${esc(j)}" aria-pressed="${sel.includes(j)}"><i class="dot"></i>${esc(j)}${sel[0] === j && sel.length > 1 ? '<small>main</small>' : ''}</button>`).join('')
    + `<button type="button" class="chip" data-pick-new>+ New journal</button>`;
}

/* ---------- journal dialog: create, rename, recolor, delete ---------- */
function openJournalDialog(name, onDone) {
  const ex = name != null ? (J.get(name) || { name, color: colorOf(name), created: new Date().toISOString() }) : null;
  let color = ex ? colorOf(ex.name) : (PALETTE.find(p => ![...J.values()].some(j => j.color === p[1])) || PALETTE[0])[1];
  const count = ex ? [...entries.values()].filter(e => e.journals.includes(ex.name)).length : 0;
  $('#jm-t').textContent = ex ? 'Edit journal' : 'New journal';
  $('#jm-name').value = ex ? ex.name : ''; $('#jm-err').textContent = '';
  $('#jm-del').hidden = !ex || count > 0; // only an empty journal can be deleted
  const drawSw = () => {
    const custom = !PALETTE.some(p => p[1] === color);
    $('#jm-sw').innerHTML = PALETTE.map(([n, c]) => `<button type="button" class="sw" style="--jc:${c}" data-c="${c}" aria-label="${n}" aria-pressed="${c === color}"></button>`).join('')
      + `<label class="sw sw-custom" style="--jc:${custom ? color : 'transparent'}" aria-pressed="${custom}" title="Custom color"><input type="color" id="jm-custom" value="${color}" aria-label="Custom color"></label>`;
  };
  drawSw();
  $('#jm-sw').onclick = x => { const b = x.target.closest('[data-c]'); if (b) { color = b.dataset.c; drawSw(); } };
  $('#jm-sw').oninput = x => { if (x.target.id === 'jm-custom' && HEX.test(x.target.value)) { color = x.target.value.toLowerCase(); const l = $('.sw-custom'); l.style.setProperty('--jc', color); l.setAttribute('aria-pressed', 'true'); $('#jm-sw').querySelectorAll('[data-c]').forEach(b => b.setAttribute('aria-pressed', 'false')); } };
  $('#jmodal').hidden = false; setTimeout(() => $('#jm-name').focus(), 30);
  const close = () => { $('#jmodal').hidden = true; $('#jm-yes').onclick = $('#jm-no').onclick = $('#jm-del').onclick = $('#jm-name').onkeydown = null; };
  $('#jm-no').onclick = close;
  $('#jm-name').onkeydown = x => { if (x.key === 'Enter') { x.preventDefault(); $('#jm-yes').click(); } };
  $('#jm-del').onclick = async () => {
    try { await store.deleteJournal(ex.name); J.delete(ex.name); if (S.journal === ex.name) S.journal = ''; close(); render(); toast('Journal deleted'); }
    catch (err) { $('#jm-err').textContent = 'Could not delete: ' + ((err && err.message) || err); }
  };
  $('#jm-yes').onclick = async () => {
    const nn = $('#jm-name').value.trim().replace(/\s+/g, ' ');
    if (!nn) { $('#jm-err').textContent = 'Give the journal a name.'; return; }
    if ((!ex || nn !== ex.name) && journals().includes(nn)) { $('#jm-err').textContent = 'A journal with that name already exists.'; return; }
    $('#jm-yes').disabled = true;
    try {
      const j = { name: nn, color, created: ex ? ex.created : new Date().toISOString() };
      await store.putJournal(j); J.set(nn, j);
      if (ex && nn !== ex.name) { // rename: move its entries over
        for (const e of [...entries.values()].filter(e => e.journals.includes(ex.name))) { const js = [...new Set(e.journals.map(x => x === ex.name ? nn : x))]; const b = { ...body(e), journals: js, journal: js[0] }; await store.put(e.id, b); entries.set(e.id, norm(e.id, b)); }
        await store.deleteJournal(ex.name); J.delete(ex.name);
        if (S.journal === ex.name) S.journal = nn;
        if (cur && cur.journals.includes(ex.name)) { cur.journals = [...new Set(cur.journals.map(x => x === ex.name ? nn : x))]; cur.journal = cur.journals[0]; }
      }
      close(); render(); if (onDone) onDone(nn);
    } catch (err) { $('#jm-err').textContent = 'Could not save: ' + ((err && err.message) || err); }
    finally { $('#jm-yes').disabled = false; }
  };
}
function setSaved(s) { const el = $('#saved'); if (el) el.textContent = s; }
function queueSave() { clearTimeout(saveT); setSaved('Editing…'); saveT = setTimeout(saveNow, 900); }
function saveNow() {
  clearTimeout(saveT); if (!cur || !store) return chain;
  const e = cur; const b = body(e); const json = JSON.stringify(b);
  if (json === lastSaved) { setSaved(lastSaved ? 'Saved' : ''); return chain; }
  if (!b.text.trim() && !entries.has(e.id)) return chain;
  lastSaved = json; b.modified = new Date().toISOString(); setSaved('Saving…');
  chain = chain.then(() => store.put(e.id, b)).then(() => { entries.set(e.id, norm(e.id, b)); setSaved('Saved'); render(); updateBadge(); })
    .catch(err => { lastSaved = ''; setSaved('Not saved'); toast(err && err.code === 'quota_exceeded' ? 'Storage is full: entry not saved' : 'Could not save: ' + ((err && err.message) || 'try again')); });
  return chain;
}
async function closeSheet() { await saveNow(); $('#sheet').hidden = true; document.body.style.overflow = ''; cur = null; render(); }

$('#back').addEventListener('click', closeSheet);
$('#mode').addEventListener('click', async () => { if (editing) { await saveNow(); editing = false; } else editing = true; drawSheet(); });
$('#star').addEventListener('click', () => { cur.starred = !cur.starred; $('#star').classList.toggle('on', cur.starred); if (entries.has(cur.id) || cur.text.trim()) saveNow(); });
$('#del').addEventListener('click', async () => {
  if (!cur) return;
  if (!entries.has(cur.id)) { cur.text = ''; return closeSheet(); }
  if (!(await ask('Delete this entry?', 'This entry will be removed for good.'))) return;
  const e = cur; clearTimeout(saveT);
  try {
    await store.delete(e.id);
    entries.delete(e.id); updateBadge(); cur = null; $('#sheet').hidden = true; document.body.style.overflow = ''; render(); toast('Entry deleted');
  } catch (err) { toast('Could not delete: ' + ((err && err.message) || 'try again')); }
});
document.addEventListener('keydown', x => {
  if (x.key === 'Escape' && !$('#bmodal').hidden) { $('#b-no').click(); return; }
  if (x.key === 'Escape' && !$('#umodal').hidden) { $('#u-no').click(); return; }
  if (S.view === 'calendar' && (x.key === 'ArrowLeft' || x.key === 'ArrowRight') && $('#sheet').hidden && $('#jmodal').hidden && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { calStep(x.key === 'ArrowLeft' ? -1 : 1); return; } if (x.key === 'Escape' && !$('#jmodal').hidden) $('#jm-no').click(); else if (x.key === 'Escape' && !$('#modal').hidden) $('#m-no').click(); else if (x.key === 'Escape' && !$('#sheet').hidden && !editing) closeSheet(); });

/* ---------- import ---------- */
let importing = false;
function unescapeDO(t) { return t.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1'); }
async function runImport(file) {
  if (!store) { toast('Journal storage is not ready yet'); return; }
  if (importing) return;
  importing = true;
  const prog = $('#prog'), pbar = $('#pbar'), ptxt = $('#ptxt'), plog = $('#plog'); prog.hidden = false; plog.textContent = '';
  const log = s => { plog.textContent += s + '\n'; plog.scrollTop = plog.scrollHeight; };
  const skip = $('#skip').checked;
  const merged = new Set(); entries.forEach(e => (e.mergedFrom || []).forEach(id => merged.add(id)));
  let done = 0, skipped = 0, failed = 0, total = 0;
  try {
    ptxt.textContent = 'Reading file…';
    const sources = [];
    if (/\.json$/i.test(file.name)) sources.push({ name: file.name, text: () => file.text() });
    else {
      if (!window.JSZip) throw new Error('The zip reader did not load. Check your connection and reload.');
      const zip = await JSZip.loadAsync(file);
      zip.forEach((p, f) => {
        if (f.dir || /__MACOSX|\/\._/.test(p)) return;
        const base = p.split('/').pop();
        if (/\.json$/i.test(base)) sources.push({ name: base, text: () => f.async('string') });
      });
    }
    const jobs = [];
    for (const s of sources) {
      let data; try { data = JSON.parse(await s.text()); } catch { log(`Skipped ${s.name}: not valid JSON`); continue; }
      if (!data || !Array.isArray(data.entries)) continue;
      if (data.app === 'Journalism' && Array.isArray(data.journals)) {
        for (const j of data.journals) if (j && typeof j.name === 'string' && j.name && HEX.test(j.color || '')) { const v = { name: j.name, color: j.color, created: j.created || '' }; J.set(v.name, v); await store.putJournal(v); }
      }
      if (data.app === 'Journalism') { log(`Backup: ${data.entries.length.toLocaleString()} entries`); data.entries.forEach(en => jobs.push([null, en])); continue; }
      const journal = s.name.replace(/\.json$/i, '') || 'Journal';
      log(`${journal}: ${data.entries.length.toLocaleString()} entries`);
      data.entries.forEach(en => jobs.push([journal, en]));
    }
    total = jobs.length;
    if (!total) throw new Error('No entries found in that file. Use a Day One JSON export or a Journalsism backup.');
    const tick = () => { const n = done + skipped + failed; pbar.style.width = (100 * n / total) + '%'; ptxt.textContent = `${n.toLocaleString()} of ${total.toLocaleString()} entries`; };
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const [journal, en] = jobs[next++];
        if (journal === null) {
          if (!en || !en.id || !en.date) { failed++; tick(); continue; }
          if (skip && entries.has(en.id)) { skipped++; tick(); continue; }
          try { const b = body(en); await store.put(en.id, b); entries.set(en.id, norm(en.id, b)); done++; }
          catch (err) { failed++; log(`Could not restore an entry: ${(err && err.message) || err}`); }
          tick(); continue;
        }
        const id = 'd1-' + String(en.uuid || Math.random().toString(36).slice(2)).replace(/[^\w-]/g, '');
        if (skip && (entries.has(id) || merged.has(id))) { skipped++; tick(); continue; }
        try {
          let text = String(en.text || '').replace(/!\[[^\]]*\]\(dayone-moment:[^)]*\)/g, '');
          text = unescapeDO(text).replace(/\n{3,}/g, '\n\n').trim();
          const L = en.location || {};
          const place = [L.placeName, L.localityName, L.administrativeArea, L.country].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
          const W = en.weather;
          const b = { date: en.creationDate || new Date().toISOString(), tz: en.timeZone || 'UTC', text, tags: Array.isArray(en.tags) ? en.tags : [], journals: [journal], journal, starred: !!en.starred, place,
            weather: W && typeof W.temperatureCelsius === 'number' ? { c: W.temperatureCelsius, desc: W.conditionsDescription || '' } : null,
            created: en.creationDate || '', modified: en.modifiedDate || en.creationDate || '', source: 'dayone' };
          await store.put(id, b);
          entries.set(id, norm(id, b)); done++;
        } catch (err) {
          failed++; log(`Could not import entry from ${(en.creationDate || '').slice(0, 10)}: ${(err && (err.message || err.code)) || err}`);
          if (err && err.code === 'quota_exceeded') { log('Storage is full: stopping.'); next = jobs.length; }
        }
        tick();
      }
    };
    tick();
    await Promise.all([worker(), worker(), worker()]);
    await ensureJournals();
    S.copies = findCopies(); drawCopies();
    if (S.copies.length) log(`Found ${S.copies.length} ${S.copies.length === 1 ? 'entry' : 'entries'} copied between journals. See "Copies across journals" below to merge them.`);
    ptxt.textContent = `Done: ${done.toLocaleString()} imported${skipped ? `, ${skipped.toLocaleString()} already here` : ''}${failed ? `, ${failed} failed` : ''}.`;
    toast(`Imported ${done.toLocaleString()} entries`);
  } catch (err) {
    ptxt.textContent = 'Import stopped'; log((err && err.message) || String(err));
  } finally {
    importing = false; stats(); const ex = $('#export'); if (ex) { ex.disabled = !entries.size; ex.textContent = `Download backup (${entries.size.toLocaleString()} entries)`; }
  }
}
/* ---------- passcode-locked journal shipped with the site (journal.locked.json) ---------- */
async function fetchLocked() {
  try { const r = await fetch('journal.locked.json', { cache: 'no-cache' }); if (!r.ok) return null; const d = await r.json(); return d && d.locked && d.data ? d : null; } catch { return null; }
}
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function unlockText(d, pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(d.salt), iterations: d.iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(d.iv) }, key, fromB64(d.data)));
}
/** On a device with no entries yet, offer to unlock the journal saved on the site. Returns true if the dialog opened. */
async function offerUnlock(force) {
  if (!force) { if (entries.size) return false; try { if (localStorage.getItem('journalism.unlockDismissed')) return false; } catch {} }
  const d = await fetchLocked();
  if (!d) { if (force) toast('No locked journal on this site'); return false; }
  $('#u-pass').value = ''; $('#u-err').textContent = ''; $('#umodal').hidden = false; setTimeout(() => $('#u-pass').focus(), 30);
  const close = () => { $('#umodal').hidden = true; $('#u-yes').onclick = $('#u-no').onclick = $('#u-pass').onkeydown = null; };
  $('#u-no').onclick = () => { try { localStorage.setItem('journalism.unlockDismissed', '1'); } catch {} close(); };
  $('#u-pass').onkeydown = x => { if (x.key === 'Enter') { x.preventDefault(); $('#u-yes').click(); } };
  $('#u-yes').onclick = async () => {
    const pass = $('#u-pass').value.trim(); if (!pass) { $('#u-err').textContent = 'Type your passcode.'; return; }
    $('#u-yes').disabled = true; $('#u-err').textContent = 'Unlocking…';
    let text;
    try { text = await unlockText(d, pass); }
    catch { $('#u-err').textContent = 'That passcode didn’t work. Check it and try again.'; $('#u-yes').disabled = false; return; }
    $('#u-yes').disabled = false; close();
    S.view = 'import'; render();
    await runImport(new File([text], 'Journalsism.json', { type: 'application/json' }));
    try { localStorage.setItem('journalism.lastBackup', String(Date.now())); } catch {} // the site's locked copy counts as a backup
    if (!getPin()) { const p = await pinPad('set'); if (p) toast('App passcode set'); }
    S.view = 'journals'; render(); toast(`Unlocked ${entries.size.toLocaleString()} entries`);
  };
  return true;
}

/* ---------- app passcode: 4 digits, kept only on this device (a lock screen, not encryption) ---------- */
const PIN_KEY = 'journalism.pin';
const sha = async t => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
const getPin = () => { try { return JSON.parse(localStorage.getItem(PIN_KEY) || 'null'); } catch { return null; } };
async function setPin(pin) { const salt = b64url(crypto.getRandomValues(new Uint8Array(16))); localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash: await sha(salt + ':' + pin) })); }
async function checkPin(pin) { const p = getPin(); return !!p && p.hash === await sha(p.salt + ':' + pin); }
let pinOpen = false, hiddenAt = 0;
/** The keypad. 'unlock' resolves true once the right code is typed; 'set' resolves with the new code, or null for "Not now". */
function pinPad(mode) {
  pinOpen = true;
  return new Promise(resolve => {
    const root = document.documentElement, dots = [...document.querySelectorAll('#pins i')];
    let typed = '', first = null;
    const say = t => { $('#lock-msg').textContent = t; };
    const draw = () => dots.forEach((d, i) => d.classList.toggle('on', i < typed.length));
    const shake = t => { say(t); typed = ''; draw(); const p = $('#pins'); p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake'); };
    say(mode === 'set' ? 'Choose a 4-digit passcode' : 'Enter passcode'); draw();
    $('#lock-forgot').hidden = mode !== 'unlock'; $('#lock-skip').hidden = mode !== 'set'; $('#lock-alt').hidden = true; $('#keys').hidden = false;
    root.classList.add('locked');
    const done = v => {
      root.classList.remove('locked'); pinOpen = false;
      $('#keys').onclick = $('#lock-forgot').onclick = $('#lock-skip').onclick = $('#lock-alt').onsubmit = null;
      document.removeEventListener('keydown', onKey, true); resolve(v);
    };
    const full = async () => {
      if (mode === 'unlock') { if (await checkPin(typed)) done(true); else shake('Wrong passcode. Try again.'); }
      else if (first === null) { first = typed; typed = ''; draw(); say('Enter it again'); }
      else if (typed === first) { await setPin(typed); done(typed); }
      else { first = null; shake('Those didn’t match. Choose a passcode.'); }
    };
    const press = k => {
      if (k === 'del') { typed = typed.slice(0, -1); return draw(); }
      if (typed.length >= 4) return;
      typed += k; draw(); if (typed.length === 4) setTimeout(full, 140);
    };
    const onKey = x => {
      if (!$('#lock-alt').hidden) return;
      if (/^[0-9]$/.test(x.key)) { press(x.key); x.preventDefault(); x.stopPropagation(); }
      else if (x.key === 'Backspace') { press('del'); x.preventDefault(); x.stopPropagation(); }
    };
    document.addEventListener('keydown', onKey, true);
    $('#keys').onclick = x => { const b = x.target.closest('[data-k]'); if (b) press(b.dataset.k); };
    $('#lock-skip').onclick = () => done(null);
    // Forgot: prove it's you with the long journal passcode, then the app passcode is removed.
    $('#lock-forgot').onclick = () => { $('#keys').hidden = true; $('#lock-alt').hidden = false; say('Forgot your passcode?'); setTimeout(() => $('#lock-alt-pass').focus(), 30); };
    $('#lock-alt').onsubmit = async x => {
      x.preventDefault();
      const d = await fetchLocked();
      if (!d) { say('This site has no journal passcode to check. Clear this app’s website data to reset.'); return; }
      try { await unlockText(d, $('#lock-alt-pass').value.trim()); }
      catch { say('That journal passcode didn’t work.'); return; }
      localStorage.removeItem(PIN_KEY); $('#lock-alt-pass').value = '';
      done(true); toast('App passcode removed. Set a new one in Settings.');
    };
  });
}
/** Ask for the passcode when the app opens, and again after 5 minutes away. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (getPin() && !pinOpen && hiddenAt && Date.now() - hiddenAt > 5 * 60e3) pinPad('unlock');
});
function drawPinSection() {
  const el = $('#pinsec'); if (!el) return;
  el.innerHTML = getPin()
    ? `<h2>App passcode</h2><p style="margin:0 0 12px">On. Journalsism asks for your 4-digit passcode when you open it, and again after 5 minutes away. It only guards this device; your journal file on the site has its own, longer passcode.</p><div class="acts2"><button class="btn" id="pinchange">Change passcode</button><button class="btn" id="pinoff">Turn off</button></div>`
    : `<h2>App passcode</h2><p style="margin:0 0 12px">Off. Add a 4-digit passcode so nobody can open your journal on this device.</p><button class="btn pri" id="pinon">Set passcode</button>`;
}

/* ---------- backups ---------- */
const lastBackup = () => { try { return +localStorage.getItem('journalism.lastBackup') || 0; } catch { return 0; } };
const daysSinceBackup = () => { const l = lastBackup(); return l ? Math.floor((Date.now() - l) / 864e5) : null; };
/** Save every entry and journal as one JSON file. On iPhone/iPad this opens the share sheet so you can
 *  tap "Save to Files" (iCloud Drive); elsewhere it downloads. Returns true when the file was handed over. */
async function exportAll() {
  const out = { exported: new Date().toISOString(), app: 'Journalism', journals: [...J.values()], entries: sorted().map(e => ({ id: e.id, ...body(e) })) };
  const name = `journalism-backup-${todayKey()}.json`;
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  let saved = false;
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
  const touch = navigator.maxTouchPoints > 0;
  if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Journalsism backup' }); saved = true; }
    catch (err) { if (err && err.name === 'AbortError') { toast('Backup not saved'); return false; } }
  }
  if (!saved) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  try { localStorage.setItem('journalism.lastBackup', String(Date.now())); localStorage.removeItem('journalism.backupSnooze'); } catch {}
  toast(`Backup saved: ${out.entries.length.toLocaleString()} entries`);
  if (S.view === 'journals' || S.view === 'import') render();
  return true;
}
/** Once a month (or if you've never backed up), ask when the app opens. "Tomorrow" snoozes for a day. */
function monthlyBackupPrompt() {
  if (!entries.size) return;
  const d = daysSinceBackup(); if (d !== null && d < 30) return;
  let snooze = 0; try { snooze = +localStorage.getItem('journalism.backupSnooze') || 0; } catch {}
  if (Date.now() < snooze) return;
  $('#b-p').textContent = (d === null ? 'You haven’t backed up your journal yet. ' : `It’s been ${d} days since your last backup. `)
    + `Your ${entries.size.toLocaleString()} entries are saved only in this browser. Save a copy to Files — iCloud Drive keeps it safe.`;
  $('#bmodal').hidden = false;
  const close = () => { $('#bmodal').hidden = true; $('#b-yes').onclick = $('#b-no').onclick = null; };
  $('#b-no').onclick = () => { try { localStorage.setItem('journalism.backupSnooze', String(Date.now() + 864e5)); } catch {} close(); };
  $('#b-yes').onclick = async () => { if (await exportAll()) close(); };
}

/* ---------- events ---------- */
$('#tabs').addEventListener('click', x => { const b = x.target.closest('button'); if (!b) return; S.view = b.dataset.v; window.scrollTo(0, 0); render(); });
let qT; $('#q').addEventListener('input', x => { clearTimeout(qT); qT = setTimeout(() => { S.q = x.target.value; S.shown = 50; if (S.view !== 'entries') S.view = 'entries'; render(); }, 200); });
$('#new').addEventListener('click', () => openEntry(null, true));
$('#fab').addEventListener('click', () => openEntry(null, true));
$('#main').addEventListener('click', x => {
  const t = x.target;
  const open = t.closest('[data-id]'); if (open) return openEntry(open.dataset.id);
  const oj = t.closest('[data-openj]'); if (oj) { S.journal = oj.dataset.openj; S.view = 'entries'; S.day = ''; S.shown = 50; window.scrollTo(0, 0); return render(); }
  const ej = t.closest('[data-editj]'); if (ej) return openJournalDialog(ej.dataset.editj);
  if (t.closest('[data-newj]')) return openJournalDialog(null, nn => { S.journal = nn; S.view = 'entries'; render(); });
  const j = t.closest('[data-j]'); if (j) { S.journal = j.dataset.j; S.shown = 50; return render(); }
  if (t.closest('#fstar')) { S.starred = !S.starred; return render(); }
  if (t.closest('#fday')) { S.day = ''; return render(); }
  if (t.closest('#more')) { S.shown += 100; return render(); }
  const a = t.closest('[data-act]'); if (a) { if (a.dataset.act === 'new') openEntry(null, true); else { S.view = 'import'; render(); } return; }
  const d = t.closest('[data-day]'); if (d) { S.day = d.dataset.day; S.view = 'entries'; S.shown = 50; return render(); }
  if (t.closest('#cprev') || t.closest('#cnext')) return calStep(t.closest('#cprev') ? -1 : 1);
  const cm = t.closest('[data-calmode]'); if (cm) { S.calMode = cm.dataset.calmode; return render(); }
  const yo = t.closest('[data-yopen]'); if (yo) { S.cal = { y: +yo.dataset.yopen, m: S.cal ? S.cal.m : 0 }; S.calMode = 'year'; return render(); }
  const mo = t.closest('[data-month]'); if (mo) { S.cal = { y: S.cal.y, m: +mo.dataset.month }; S.calMode = 'month'; return render(); }
  const yb = t.closest('[data-y]');
  if (yb) {
    const now = new Date();
    if (yb.dataset.y === 'now') S.cal = { y: now.getFullYear(), m: now.getMonth() };
    else { const yy = +yb.dataset.y, ms = [...entries.values()].filter(e => e._k.startsWith(yb.dataset.y) && (!S.journal || e.journals.includes(S.journal))).map(e => +e._k.slice(5, 7) - 1); S.cal = { y: yy, m: ms.length ? Math.max(...ms) : 0 }; }
    return render();
  }
  if (t.closest('#export')) return exportAll();
  if (t.closest('#pushon')) return turnOnPush();
  if (t.closest('#unlockrepo')) return offerUnlock(true);
  if (t.closest('#pinon')) { pinPad('set').then(p => { if (p) toast('App passcode set'); drawPinSection(); }); return; }
  if (t.closest('#pinchange')) { pinPad('unlock').then(() => pinPad('set')).then(p => { if (p) toast('Passcode changed'); drawPinSection(); }); return; }
  if (t.closest('#pinoff')) { pinPad('unlock').then(() => { localStorage.removeItem(PIN_KEY); toast('App passcode turned off'); drawPinSection(); }); return; }
  if (t.closest('#copysub')) { const v = $('#subcode').value; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast('Setup code copied'), () => { $('#subcode').select(); toast('Select the code and copy it'); }); return; }
  if (t.closest('#testpush')) { swReg().then(r => r && r.showNotification('Journalsism', { body: REMIND_TEXT, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'daily-reminder', data: { url: './#write' } })).catch(() => toast('Could not show a notification')); return; }
  if (t.closest('#pushoff')) { swReg().then(r => r && r.pushManager.getSubscription()).then(s => s && s.unsubscribe()).then(() => { toast('Reminders turned off on this device'); drawReminders(); }); return; }
  if (t.closest('#findcopies')) { S.copies = findCopies(); return drawCopies(); }
  const mc = t.closest('#mergecopies');
  if (mc) {
    const pick = [...document.querySelectorAll('#duplist [data-ci]')].filter(c => c.checked).map(c => S.copies[+c.dataset.ci]);
    if (!pick.length) return toast('Select at least one entry to merge');
    mc.disabled = true;
    (async () => {
      try { for (const g of pick) await mergeGroup(g); toast(`Merged ${pick.length} ${pick.length === 1 ? 'entry' : 'entries'}`); }
      catch (err) { toast('Could not merge: ' + ((err && err.message) || err)); }
      S.copies = findCopies(); stats(); drawCopies();
    })();
    return;
  }
});
$('#main').addEventListener('change', x => { if (x.target.id === 'ftag') { S.tag = x.target.value; S.shown = 50; render(); } });
window.addEventListener('beforeunload', () => { saveNow(); });
new ResizeObserver(setHH).observe($('#top'));

/* ---------- boot ---------- */
$('#dateline').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
render();
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'write' && store) openEntry(null, true); });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && store) updateBadge(); });
window.addEventListener('hashchange', () => { if (location.hash === '#write' && store) { history.replaceState(null, '', location.pathname + location.search); openEntry(null, true); } });
(async () => {
  if (getPin()) await pinPad('unlock'); else document.documentElement.classList.remove('locked');
  try {
    store = await JournalStore.open();
    for (const j of await store.journals()) if (j && j.name) J.set(j.name, j);
    for (const v of await store.all()) if (v && v.id && v.date) entries.set(v.id, norm(v.id, v));
    await ensureJournals();
    status(''); render();
    updateBadge();
    const unlocking = await offerUnlock(false);
    if (location.hash === '#write') { history.replaceState(null, '', location.pathname + location.search); openEntry(null, true); }
    else if (!unlocking) monthlyBackupPrompt();
  } catch (err) {
    status('Could not open journal storage in this browser: ' + ((err && err.message) || err) + '. Private browsing can block it.');
  }
})();

})();
