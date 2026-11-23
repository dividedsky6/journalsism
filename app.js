/* Journalism: a personal journal app.
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
const S = { view: 'entries', q: '', journal: '', tag: '', starred: false, day: '', shown: 50, cal: null };

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
  e._tz = tzOk(e.tz || LOCAL_TZ);
  const dt = new Date(e.date); if (isNaN(dt)) { e.date = new Date().toISOString(); }
  e._k = keyOf(new Date(e.date), e._tz); e._md = e._k.slice(5); e._ym = e._k.slice(0, 7);
  const lines = plain(e.text).split('\n').map(s => s.trim()).filter(Boolean);
  e._title = lines[0] || 'Untitled';
  e._ex = lines.slice(1).join(' ').slice(0, 240);
  e._words = plain(e.text).split(/\s+/).filter(Boolean).length;
  e._hay = (e.text + ' ' + e.tags.join(' ') + ' ' + (e.place || '') + ' ' + (e.journal || '')).toLowerCase();
  return e;
}
function body(e) { return { date: e.date, tz: e.tz || LOCAL_TZ, text: e.text || '', tags: e.tags || [], journal: e.journal || 'Journal', starred: !!e.starred, place: e.place || '', weather: e.weather || null, created: e.created || e.date, modified: e.modified || e.date, source: e.source || 'journal' }; }
const sorted = () => [...entries.values()].sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
function filtered() {
  const q = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return sorted().filter(e => (!S.journal || e.journal === S.journal) && (!S.tag || e.tags.includes(S.tag)) && (!S.starred || e.starred) && (!S.day || e._k === S.day) && q.every(w => e._hay.includes(w)));
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
  t = t.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, (_, a, h) => put(`<a href="${esc(h)}" target="_blank" rel="noopener">${esc(a)}</a>`));
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
function stats() {
  const all = [...entries.values()]; if (!all.length) { $('#stats').textContent = ''; return; }
  const days = new Set(all.map(e => e._k)); let streak = 0;
  const d = new Date(); if (!days.has(keyOf(d, LOCAL_TZ))) d.setDate(d.getDate() - 1);
  while (days.has(keyOf(d, LOCAL_TZ))) { streak++; d.setDate(d.getDate() - 1); }
  const words = all.reduce((s, e) => s + e._words, 0);
  $('#stats').textContent = `${all.length.toLocaleString()} entries · ${days.size.toLocaleString()} days · ${words.toLocaleString()} words${streak ? ` · ${streak}-day streak` : ''}`;
}
function journals() { return [...new Set([...entries.values()].map(e => e.journal || 'Journal'))].sort(); }
function tags() { const c = new Map(); entries.forEach(e => e.tags.forEach(t => c.set(t, (c.get(t) || 0) + 1))); return [...c].sort((a, b) => b[1] - a[1]).map(x => x[0]); }

function cardHTML(e) {
  const meta = [fmt(e, { hour: 'numeric', minute: '2-digit' })];
  if (e.place) meta.push(esc(e.place));
  if (e.weather) meta.push(esc(weatherTxt(e.weather)));
  const tg = e.tags.slice(0, 4).map(t => `<span class="tag">#${esc(t)}</span>`).join(' ');
  return `<button class="card" data-id="${esc(e.id)}">
    <div class="dn"><b>${esc(fmt(e, { day: 'numeric' }))}</b><span>${esc(fmt(e, { weekday: 'short' }))}</span></div>
    <div><h3>${esc(e._title)}</h3>${e._ex ? `<p>${esc(e._ex)}</p>` : ''}
    <div class="meta">${e.starred ? `<span class="st">${ICON.star}</span>` : ''}${meta.map(m => `<span>${m}</span>`).join('')}${journals().length > 1 ? `<span>${esc(e.journal)}</span>` : ''}${tg}</div></div>
</button>`;
}

function renderEntries() {
  const list = filtered(); const js = journals(); const ts = tags();
  let h = `<div class="filters">
    <button class="chip" data-j="" aria-pressed="${!S.journal}">All journals</button>
    ${js.length > 1 ? js.map(j => `<button class="chip" data-j="${esc(j)}" aria-pressed="${S.journal === j}">${esc(j)}</button>`).join('') : ''}
    <button class="chip" id="fstar" aria-pressed="${S.starred}">${ICON.star} Starred</button>
    ${ts.length ? `<label class="chip">Tag <select id="ftag"><option value="">Any</option>${ts.map(t => `<option ${S.tag === t ? 'selected' : ''} value="${esc(t)}">${esc(t)}</option>`).join('')}</select></label>` : ''}
    ${S.day ? `<button class="chip" id="fday" aria-pressed="true">${esc(S.day)} ✕</button>` : ''}
  </div>`;
  const plainView = !S.q && !S.journal && !S.tag && !S.starred && !S.day;
  if (plainView) {
    const tmd = todayKey().slice(5), yr = todayKey().slice(0, 4);
    const otd = sorted().filter(e => e._md === tmd && e._k.slice(0, 4) !== yr);
    if (otd.length) h += `<section class="otd"><h2>On this day</h2><div class="rail">${otd.map(e => `<button class="tile" data-id="${esc(e.id)}"><span class="yr">${esc(e._k.slice(0, 4))}</span><span class="tl">${esc(e._title)}</span></button>`).join('')}</div></section>`;
  }
  if (!entries.size) {
    h += `<div class="empty"><h2>Your first page is blank</h2><p>Write today’s entry, or bring your Day One journals across from the Import tab.</p><p><button class="btn pri" data-act="new">Write an entry</button> <button class="btn" data-act="import">Import from Day One</button></p></div>`;
  } else if (!list.length) {
    h += `<div class="empty"><h2>Nothing matches</h2><p>Try a different search or clear the filters.</p></div>`;
  } else {
    let ym = '';
    for (const e of list.slice(0, S.shown)) {
      if (e._ym !== ym) { ym = e._ym; h += `<h2 class="month">${esc(fmt(e, { month: 'long', year: 'numeric' }))}</h2>`; }
      h += cardHTML(e);
    }
    if (list.length > S.shown) h += `<div class="more"><button class="btn" id="more">Show more (${(list.length - S.shown).toLocaleString()} left)</button></div>`;
  }
  $('#main').innerHTML = h;
}

function renderCalendar() {
  const now = new Date(); if (!S.cal) S.cal = { y: now.getFullYear(), m: now.getMonth() };
  const { y, m } = S.cal; const first = new Date(y, m, 1); const n = new Date(y, m + 1, 0).getDate();
  const byDay = new Map(); entries.forEach(e => { if (!byDay.has(e._k)) byDay.set(e._k, []); byDay.get(e._k).push(e); });
  const tk = todayKey();
  let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="wd">${d}</div>`).join('') + '<div></div>'.repeat(first.getDay());
  let count = 0;
  for (let d = 1; d <= n; d++) {
    const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; const es = byDay.get(k) || [];
    count += es.length;
    cells += `<button class="d ${es.length ? 'has' : ''} ${k === tk ? 'today' : ''}" ${es.length ? `data-day="${k}"` : 'disabled'} aria-label="${k}, ${es.length} entries">${d}${es.length > 1 ? `<i>${es.length}</i>` : ''}</button>`;
  }
  const years = [...new Set([...entries.values()].map(e => e._k.slice(0, 4)))].sort().reverse();
  $('#main').innerHTML = `<div class="calh"><button class="iconbtn" id="cprev" aria-label="Previous month"><svg class="ico" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>
    <div style="text-align:center"><h2>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><span style="color:var(--mute);font-size:14px">${count} ${count === 1 ? 'entry' : 'entries'}</span></div>
    <button class="iconbtn" id="cnext" aria-label="Next month"><svg class="ico" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button></div>
    <div class="cal">${cells}</div>
    ${years.length ? `<div class="yearrow">Jump to: ${years.map(yy => `<button class="chip" data-y="${yy}">${yy}</button>`).join('')}<button class="chip" data-y="now">Today</button></div>` : ''}`;
}

function renderImport() {
  $('#main').innerHTML = `<section class="imp">
    <h2>Bring over your Day One journals</h2>
    <ol>
      <li>In Day One, open <b>Settings → Import/Export → Export</b> (on Mac: File → Export).</li>
      <li>Choose <b>JSON</b> format and the journals you want. You'll get a <b>.zip</b> file.</li>
      <li>Pick that .zip below. A single <b>Journal.json</b> from inside it works too, and so does a Journalism backup file.</li>
    </ol>
    <label class="drop" id="drop"><input type="file" id="file" accept=".zip,.json,application/zip,application/json">
      <b>Choose your Day One export</b><br><span style="color:var(--mute);font-size:14px">or drop it here</span></label>
    <label class="chk2"><input type="checkbox" id="skip" checked> Skip entries already imported (safe to re-run if an import stops)</label>
    <div id="prog" hidden><div class="bar"><div id="pbar"></div></div><div id="ptxt" style="font-weight:600"></div><div class="log" id="plog"></div></div>
  </section>
  <section class="imp">
    <h2>Backup</h2>
    <p style="color:var(--mute);margin:0 0 14px">Entries are saved in this browser only. Download a backup regularly; to restore it, pick the file in the importer above.</p>
    <button class="btn" id="export" ${entries.size ? '' : 'disabled'}>Download backup (${entries.size.toLocaleString()} entries)</button>
  </section>`;
  const drop = $('#drop');
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, x => { x.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', x => { x.preventDefault(); const f = x.dataTransfer.files[0]; if (f) runImport(f); });
  $('#file').addEventListener('change', x => { const f = x.target.files[0]; if (f) runImport(f); x.target.value = ''; });
}

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.v === S.view));
  stats();
  if (importing && S.view === 'import') return;
  ({ entries: renderEntries, calendar: renderCalendar, import: renderImport })[S.view]();
}

/* ---------- entry sheet ---------- */
let cur = null, editing = false, saveT = null, chain = Promise.resolve(), lastSaved = '';
function openEntry(id, edit) {
  const e = id ? entries.get(id) : null; if (id && !e) return;
  if (!e && !store) { toast('Journal storage is not ready yet'); return; }
  const nowISO = new Date().toISOString();
  cur = e ? norm(e.id, body(e)) : norm('e-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), { date: nowISO, tz: LOCAL_TZ, text: '', tags: [], journal: S.journal || journals()[0] || 'Journal', created: nowISO, modified: nowISO });
  lastSaved = e ? JSON.stringify(body(e)) : '';
  editing = !!edit || !e; $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; drawSheet();
  if (editing) setTimeout(() => $('#ed-text') && $('#ed-text').focus(), 50);
}
/** Show the first line as the title even when it was written without a leading #. */
const asTitled = t => String(t || '').replace(/^\s*(?!#|[-*+>]\s|\d+[.)]\s|!\[)(\S[^\n]*)/, '# $1');
function drawSheet() {
  const e = cur;
  $('#when').innerHTML = `${esc(fmt(e, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}<small>${esc(fmt(e, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }))}</small>`;
  $('#star').classList.toggle('on', !!e.starred); $('#star').setAttribute('aria-pressed', !!e.starred);
  $('#mode').textContent = editing ? 'Done' : 'Edit';
  if (!editing) {
    const facts = [e.journal, e.place, weatherTxt(e.weather), ...e.tags.map(t => '#' + t)].filter(Boolean);
    $('#sbody').innerHTML = `<article class="prose">${facts.length ? `<div class="facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}${md(asTitled(e.text), e) || '<p style="color:var(--mute)">Empty entry</p>'}</article>`;
    return;
  }
  const js = journals(); const all = tags();
  $('#sbody').innerHTML = `<div class="ed">
    <textarea id="ed-text" placeholder="What's on your mind today?" aria-label="Entry text">${esc(e.text)}</textarea>
    <div class="edbar">
      <span id="saved">${lastSaved ? 'Saved' : ''}</span>
    </div>
    <div class="fields">
      <label>Date &amp; time<input id="ed-date" type="datetime-local" value="${esc(toLocalInput(e))}"></label>
      <label>Journal<input id="ed-journal" list="dl-j" value="${esc(e.journal)}"><datalist id="dl-j">${js.map(j => `<option value="${esc(j)}">`).join('')}</datalist></label>
      <label>Tags (comma separated)<input id="ed-tags" list="dl-t" value="${esc(e.tags.join(', '))}"><datalist id="dl-t">${all.slice(0, 50).map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
      <label>Place<input id="ed-place" value="${esc(e.place || '')}" placeholder="Where are you?"></label>
    </div>
    <p style="color:var(--mute);font-size:13px;margin:0">Formatting: # heading, **bold**, *italic*, - list, - [ ] checklist, &gt; quote. The first line is the entry's title.</p>
  </div>`;
  const t = $('#ed-text');
  t.addEventListener('input', () => { cur.text = t.value; queueSave(); });
  $('#ed-date').addEventListener('change', x => { if (x.target.value) { cur.date = fromLocalInput(x.target.value, cur._tz); cur = norm(cur.id, { ...body(cur), text: cur.text }); queueSave(); $('#when').innerHTML = `${esc(fmt(cur, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}<small>${esc(fmt(cur, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }))}</small>`; } });
  $('#ed-journal').addEventListener('input', x => { cur.journal = x.target.value.trim() || 'Journal'; queueSave(); });
  $('#ed-tags').addEventListener('input', x => { cur.tags = [...new Set(x.target.value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean))]; queueSave(); });
  $('#ed-place').addEventListener('input', x => { cur.place = x.target.value; queueSave(); });
}
function setSaved(s) { const el = $('#saved'); if (el) el.textContent = s; }
function queueSave() { clearTimeout(saveT); setSaved('Editing…'); saveT = setTimeout(saveNow, 900); }
function saveNow() {
  clearTimeout(saveT); if (!cur || !store) return chain;
  const e = cur; const b = body(e); const json = JSON.stringify(b);
  if (json === lastSaved) { setSaved(lastSaved ? 'Saved' : ''); return chain; }
  if (!b.text.trim() && !entries.has(e.id)) return chain;
  lastSaved = json; b.modified = new Date().toISOString(); setSaved('Saving…');
  chain = chain.then(() => store.put(e.id, b)).then(() => { entries.set(e.id, norm(e.id, b)); setSaved('Saved'); render(); })
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
    entries.delete(e.id); cur = null; $('#sheet').hidden = true; document.body.style.overflow = ''; render(); toast('Entry deleted');
  } catch (err) { toast('Could not delete: ' + ((err && err.message) || 'try again')); }
});
document.addEventListener('keydown', x => { if (x.key === 'Escape' && !$('#modal').hidden) $('#m-no').click(); else if (x.key === 'Escape' && !$('#sheet').hidden && !editing) closeSheet(); });

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
      if (data.app === 'Journalism') { log(`Backup: ${data.entries.length.toLocaleString()} entries`); data.entries.forEach(en => jobs.push([null, en])); continue; }
      const journal = s.name.replace(/\.json$/i, '') || 'Journal';
      log(`${journal}: ${data.entries.length.toLocaleString()} entries`);
      data.entries.forEach(en => jobs.push([journal, en]));
    }
    total = jobs.length;
    if (!total) throw new Error('No entries found in that file. Use a Day One JSON export or a Journalism backup.');
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
        if (skip && entries.has(id)) { skipped++; tick(); continue; }
        try {
          let text = String(en.text || '').replace(/!\[[^\]]*\]\(dayone-moment:[^)]*\)/g, '');
          text = unescapeDO(text).replace(/\n{3,}/g, '\n\n').trim();
          const L = en.location || {};
          const place = [L.placeName, L.localityName, L.administrativeArea, L.country].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
          const W = en.weather;
          const b = { date: en.creationDate || new Date().toISOString(), tz: en.timeZone || 'UTC', text, tags: Array.isArray(en.tags) ? en.tags : [], journal, starred: !!en.starred, place,
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
    ptxt.textContent = `Done: ${done.toLocaleString()} imported${skipped ? `, ${skipped.toLocaleString()} already here` : ''}${failed ? `, ${failed} failed` : ''}.`;
    toast(`Imported ${done.toLocaleString()} entries`);
  } catch (err) {
    ptxt.textContent = 'Import stopped'; log((err && err.message) || String(err));
  } finally {
    importing = false; stats(); const ex = $('#export'); if (ex) { ex.disabled = !entries.size; ex.textContent = `Download backup (${entries.size.toLocaleString()} entries)`; }
  }
}
async function exportAll() {
  const out = { exported: new Date().toISOString(), app: 'Journalism', entries: sorted().map(e => ({ id: e.id, ...body(e) })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `journalism-backup-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- events ---------- */
$('#tabs').addEventListener('click', x => { const b = x.target.closest('button'); if (!b) return; S.view = b.dataset.v; window.scrollTo(0, 0); render(); });
let qT; $('#q').addEventListener('input', x => { clearTimeout(qT); qT = setTimeout(() => { S.q = x.target.value; S.shown = 50; if (S.view !== 'entries') S.view = 'entries'; render(); }, 200); });
$('#new').addEventListener('click', () => openEntry(null, true));
$('#fab').addEventListener('click', () => openEntry(null, true));
$('#main').addEventListener('click', x => {
  const t = x.target;
  const open = t.closest('[data-id]'); if (open) return openEntry(open.dataset.id);
  const j = t.closest('[data-j]'); if (j) { S.journal = j.dataset.j; S.shown = 50; return render(); }
  if (t.closest('#fstar')) { S.starred = !S.starred; return render(); }
  if (t.closest('#fday')) { S.day = ''; return render(); }
  if (t.closest('#more')) { S.shown += 100; return render(); }
  const a = t.closest('[data-act]'); if (a) { if (a.dataset.act === 'new') openEntry(null, true); else { S.view = 'import'; render(); } return; }
  const d = t.closest('[data-day]'); if (d) { S.day = d.dataset.day; S.view = 'entries'; S.shown = 50; return render(); }
  if (t.closest('#cprev') || t.closest('#cnext')) { const dir = t.closest('#cprev') ? -1 : 1; let { y, m } = S.cal; m += dir; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.cal = { y, m }; return render(); }
  const yb = t.closest('[data-y]'); if (yb) { const now = new Date(); S.cal = yb.dataset.y === 'now' ? { y: now.getFullYear(), m: now.getMonth() } : { y: +yb.dataset.y, m: Math.max(0, ...[...entries.values()].filter(e => e._k.startsWith(yb.dataset.y)).map(e => +e._k.slice(5, 7) - 1)) }; return render(); }
  if (t.closest('#export')) return exportAll();
});
$('#main').addEventListener('change', x => { if (x.target.id === 'ftag') { S.tag = x.target.value; S.shown = 50; render(); } });
window.addEventListener('beforeunload', () => { saveNow(); });
new ResizeObserver(setHH).observe($('#top'));

/* ---------- boot ---------- */
render();
(async () => {
  try {
    store = await JournalStore.open();
    for (const v of await store.all()) if (v && v.id && v.date) entries.set(v.id, norm(v.id, v));
    status(''); render();
  } catch (err) {
    status('Could not open journal storage in this browser: ' + ((err && err.message) || err) + '. Private browsing can block it.');
  }
})();

})();
