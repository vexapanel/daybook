'use strict';

const API = 'https://api.groq.com/openai/v1';
const STT_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const LANG = 'tr'; // spoken language; fixing it improves Whisper accuracy over auto-detect
const MIN_RECORDING_MS = 1000; // Whisper hallucinates text on near-silent clips

const JOURNAL_PROMPT = `You turn a spoken work-diary voice note into a clean written diary entry.
The input is a raw speech transcript, usually Turkish, full of filler words, repetitions and transcription errors.
Rewrite it in the SAME language as clear, well-punctuated sentences.
Keep the speaker's own person and tense: "yaptık" stays "yaptık", never "yaptım".
Remove fillers (e.g. "ııı", "şey", "yani", "anladın mı", "falan filan") and fix obvious transcription mistakes.
Keep every fact, time, number and detail. Do not add, guess, summarize away or comment on anything.
Reply only with JSON: {"text": "<entry>"}`;

const MONEY_PROMPT = `You extract income and expense entries from a spoken note, usually Turkish.
Reply only with JSON: {"items": [{"type": "in" | "out", "amount": <number>, "desc": "<short label>"}]}
- "in": money received (salary, advance, payment received, something sold). "out": money spent or paid.
- amount: a plain positive number, Turkish lira unless another currency is said. Convert spoken numbers ("iki bin beş yüz" = 2500, "bin iki yüz elli" = 1250).
- desc: a short label in the note's language, e.g. "Öğle yemeği", "Avans".
- Skip anything without an amount. If nothing is found reply {"items": []}.`;

const $ = s => document.querySelector(s);
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'TRY' });

const db = load();
let day = iso(new Date());
let tab = localStorage.getItem('daybook.tab') || 'journal';
let recorder = null;
let pendingAudio = null;
let timer = 0;

function load() {
  const raw = localStorage.getItem('daybook');
  try {
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.notes) && Array.isArray(d.tx)) return d;
  } catch {}
  if (raw) localStorage.setItem('daybook.bak', raw); // keep unreadable data instead of overwriting it
  return { notes: [], tx: [] };
}

function save() {
  try {
    localStorage.setItem('daybook', JSON.stringify(db));
  } catch (e) {
    status('Could not save: ' + e.message, true);
  }
}

function iso(d) {
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function delButton(onDelete) {
  const b = el('button', 'del', '×');
  b.setAttribute('aria-label', 'Delete');
  b.onclick = () => confirm('Delete this entry?') && onDelete();
  return b;
}

function status(msg, isError = false, canRetry = false) {
  $('#statusText').textContent = msg;
  $('#status').classList.toggle('error', isError);
  $('#retry').hidden = !canRetry;
}

function setBusy(busy) {
  for (const id of ['#mic', '#send', '#text']) $(id).disabled = busy;
}

// ---------- rendering ----------

function render() {
  const date = new Date(day + 'T12:00');
  $('#date').value = day;
  $('#dateLabel').textContent = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.body.dataset.tab = tab;
  for (const b of document.querySelectorAll('[data-tab-btn]')) b.setAttribute('aria-selected', b.dataset.tabBtn === tab);

  const notes = db.notes.filter(n => n.date === day);
  $('#notes').replaceChildren(...notes.map(noteItem));
  $('#notesEmpty').hidden = notes.length > 0;

  const txs = db.tx.filter(t => t.date === day);
  $('#txs').replaceChildren(...txs.map(txItem));
  $('#txEmpty').hidden = txs.length > 0;

  const d = totals(txs);
  $('#dayIn').textContent = money.format(d.in);
  $('#dayOut').textContent = money.format(d.out);
  $('#dayNet').textContent = money.format(d.in - d.out);

  const m = totals(db.tx.filter(t => t.date.startsWith(day.slice(0, 7))));
  const monthName = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#month').textContent = `${monthName}: in ${money.format(m.in)} · out ${money.format(m.out)} · net ${money.format(m.in - m.out)}`;
}

function noteItem(n) {
  const li = el('li', 'card note');
  const meta = el('div', 'meta');
  meta.append(el('time', '', n.time), delButton(() => remove('notes', n.id)));
  const p = el('p', '', n.text);
  p.contentEditable = 'plaintext-only';
  p.onblur = () => {
    const text = p.innerText.trim();
    if (!text) return (p.textContent = n.text);
    if (text !== n.text) { n.text = text; save(); }
  };
  li.append(meta, p);
  return li;
}

function txItem(t) {
  const li = el('li', `card tx ${t.type}`);
  const info = el('div');
  info.append(el('span', 'desc', t.desc), el('time', '', t.time));
  const sign = t.type === 'in' ? '+' : '−';
  li.append(info, el('span', 'amt', sign + money.format(t.amount)), delButton(() => remove('tx', t.id)));
  return li;
}

function totals(list) {
  const r = { in: 0, out: 0 };
  for (const t of list) r[t.type] += t.amount;
  return r;
}

function remove(kind, id) {
  db[kind] = db[kind].filter(x => x.id !== id);
  save();
  render();
}

// ---------- Groq ----------

async function groq(path, body, json) {
  const key = localStorage.getItem('daybook.key');
  if (!key) throw new Error('Add your Groq API key in Settings (gear icon).');
  const headers = { Authorization: 'Bearer ' + key };
  if (json) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method: 'POST', headers, body: json ? JSON.stringify(body) : body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || 'Groq error ' + res.status);
  return data;
}

async function transcribe(blob) {
  const ext = (blob.type.match(/webm|ogg|mp4|mpeg|wav/) || ['webm'])[0];
  const form = new FormData();
  form.append('file', blob, 'note.' + ext);
  form.append('model', STT_MODEL);
  form.append('language', LANG);
  const { text } = await groq('/audio/transcriptions', form, false);
  // Whisper's known Turkish hallucination on silence/noise, learned from subtitle credits.
  return text.replace(/altyaz[ıi] m\.? ?k\.?/gi, '').trim();
}

async function ask(system, user) {
  const data = await groq('/chat/completions', {
    model: localStorage.getItem('daybook.model') || DEFAULT_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }, true);
  return JSON.parse(data.choices[0].message.content);
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(i => ({
      type: i?.type === 'in' ? 'in' : 'out',
      amount: Math.round(Math.abs(Number(i?.amount)) * 100) / 100,
      desc: String(i?.desc ?? '').trim() || '—',
    }))
    .filter(i => i.amount > 0);
}

// ---------- input handling ----------

async function handle(text) {
  const date = day;
  const time = new Date().toTimeString().slice(0, 5);
  if (tab === 'journal') {
    status('Writing it up…');
    let clean = text;
    let error = null;
    try {
      clean = String((await ask(JOURNAL_PROMPT, text)).text || '').trim() || text;
    } catch (e) {
      error = e;
    }
    db.notes.push({ id: uid(), date, time, text: clean, raw: text });
    save();
    render();
    if (error) status('Saved unedited: ' + error.message, true);
    else status('Note saved.');
  } else {
    status('Reading amounts…');
    const items = normalizeItems((await ask(MONEY_PROMPT, text)).items);
    if (!items.length) throw new Error('No amount found. Say e.g. "spent 250 on lunch".');
    for (const i of items) db.tx.push({ id: uid(), date, time, ...i, note: text });
    save();
    render();
    status(`Added ${items.length} entr${items.length === 1 ? 'y' : 'ies'}.`);
  }
}

async function submitText(text) {
  text = text.trim();
  if (!text) return;
  setBusy(true);
  try {
    $('#text').value = '';
    await handle(text);
  } catch (e) {
    $('#text').value = text; // keep it so nothing is lost and it can be resent
    status(e.message, true);
  } finally {
    setBusy(false);
  }
}

async function submitAudio(blob) {
  setBusy(true);
  status('Transcribing…');
  let text;
  try {
    text = await transcribe(blob);
    pendingAudio = null;
  } catch (e) {
    pendingAudio = blob;
    setBusy(false);
    return status('Transcription failed: ' + e.message, true, true);
  }
  setBusy(false);
  if (!text) return status('Heard nothing. Try again closer to the mic.', true);
  await submitText(text);
}

async function toggleMic() {
  if (recorder) return recorder.stop();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return status('Microphone access denied. Allow it in the browser settings.', true);
  }
  const chunks = [];
  const started = Date.now();
  const r = new MediaRecorder(stream);
  r.ondataavailable = e => e.data.size && chunks.push(e.data);
  r.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    clearInterval(timer);
    recorder = null;
    $('#mic').classList.remove('rec');
    if (Date.now() - started < MIN_RECORDING_MS) return status('Too short. Tap, speak, then tap again.', true);
    submitAudio(new Blob(chunks, { type: r.mimeType }));
  };
  r.start();
  recorder = r;
  $('#mic').classList.add('rec');
  const tick = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    status(`Listening… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} — tap to stop`);
  };
  tick();
  timer = setInterval(tick, 500);
}

// ---------- backup ----------

function exportBackup() {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
  a.download = `daybook-${iso(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.notes) || !Array.isArray(d.tx)) throw new Error('not a Daybook backup');
    const merge = (mine, theirs) => {
      const ids = new Set(mine.map(x => x.id));
      let added = 0;
      for (const x of theirs) if (!ids.has(x.id)) { mine.push(x); added++; }
      return added;
    };
    const added = merge(db.notes, d.notes) + merge(db.tx, d.tx);
    save();
    render();
    status(`Imported ${added} new entries.`);
  } catch (e) {
    status('Import failed: ' + e.message, true);
  }
}

// ---------- wiring ----------

function shiftDay(n) {
  const d = new Date(day + 'T12:00');
  d.setDate(d.getDate() + n);
  day = iso(d);
  render();
}

$('#prev').onclick = () => shiftDay(-1);
$('#next').onclick = () => shiftDay(1);
$('#date').onchange = e => { if (e.target.value) { day = e.target.value; render(); } };

for (const b of document.querySelectorAll('[data-tab-btn]')) {
  b.onclick = () => {
    tab = b.dataset.tabBtn;
    localStorage.setItem('daybook.tab', tab);
    render();
  };
}

$('#bar').onsubmit = e => { e.preventDefault(); submitText($('#text').value); };
$('#mic').onclick = toggleMic;
$('#retry').onclick = () => pendingAudio && submitAudio(pendingAudio);

const dlg = $('#settings');
$('#openSettings').onclick = () => {
  $('#key').value = localStorage.getItem('daybook.key') || '';
  $('#model').value = localStorage.getItem('daybook.model') || '';
  $('#model').placeholder = DEFAULT_MODEL;
  dlg.showModal();
};
$('#cancel').onclick = () => dlg.close();
dlg.onclose = () => {
  if (dlg.returnValue !== 'save') return;
  dlg.returnValue = '';
  for (const k of ['key', 'model']) {
    const v = $('#' + k).value.trim();
    v ? localStorage.setItem('daybook.' + k, v) : localStorage.removeItem('daybook.' + k);
  }
  status('Settings saved.');
};
$('#export').onclick = exportBackup;
$('#import').onclick = () => $('#importFile').click();
$('#importFile').onchange = e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; };

// One-time setup link (opened from a QR code): #key=gsk_… stores the key and is wiped from the address bar.
// The fragment never reaches the server, so the key stays off GitHub.
const linkKey = new URLSearchParams(location.hash.slice(1)).get('key');
if (linkKey) {
  localStorage.setItem('daybook.key', linkKey.trim());
  history.replaceState(null, '', location.pathname + location.search);
}

navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
render();
if (!localStorage.getItem('daybook.key')) status('First, add your Groq API key in Settings (gear icon).');
else if (linkKey) status('Groq key saved. Now add this page to your home screen.');

if (location.hash === '#selftest') {
  const items = normalizeItems([
    { type: 'in', amount: '2000', desc: ' Avans ' },
    { type: 'expense', amount: -250.555, desc: 'Yemek' },
    { type: 'out', amount: 'abc' },
    null,
  ]);
  console.assert(items.length === 2, 'invalid items dropped');
  console.assert(items[0].type === 'in' && items[0].amount === 2000 && items[0].desc === 'Avans', 'income parsed');
  console.assert(items[1].type === 'out' && items[1].amount === 250.56, 'unknown type -> out, amount abs+rounded');
  const t = totals(items);
  console.assert(t.in === 2000 && t.out === 250.56, 'totals');
  console.assert(iso(new Date(2026, 0, 31, 23, 59)) === '2026-01-31', 'iso uses local date');
  console.log('selftest done');
}
