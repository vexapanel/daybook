'use strict';

const API = 'https://api.groq.com/openai/v1';
const SB = 'https://hhwhnzdnqkiuzsedebhh.supabase.co';
const SB_KEY = 'sb_publishable_gXjsUp7EMdsIZ9oqke8-Bg_LpRCjZDQ'; // public by design; row level security guards the data
const STT_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const LANG = 'tr'; // spoken language; fixing it improves Whisper accuracy over auto-detect
const MIN_RECORDING_MS = 1000; // Whisper hallucinates text on near-silent clips
const DEFAULT_SILENCE_S = 3.5; // long enough for a thinking pause mid-sentence, short enough not to feel stuck
const NO_SPEECH_MS = 10000; // give up if nothing is said at all
const MIN_VOICE_RMS = 0.015; // below this is never treated as speech, even in a silent room

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
const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

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
    status('Kaydedilemedi: ' + e.message, true);
  }
  sync(); // runs even when the phone's storage is full, so the cloud copy still gets it
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
  b.setAttribute('aria-label', 'Sil');
  b.onclick = () => confirm('Bu kayıt silinsin mi?') && onDelete();
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
  $('#dateLabel').textContent = date.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
  const monthName = date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  $('#month').textContent = `${monthName}: gelen ${money.format(m.in)} · giden ${money.format(m.out)} · kalan ${money.format(m.in - m.out)}`;
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
  // Own key -> call Groq directly. No key -> go through the Supabase proxy, which holds the shared key.
  const key = localStorage.getItem('daybook.key');
  let url, headers;
  if (key) {
    url = API + path;
    headers = { Authorization: 'Bearer ' + key };
  } else {
    const s = await session();
    url = SB + '/functions/v1/groq' + path;
    headers = { Authorization: 'Bearer ' + s.access_token, apikey: SB_KEY };
  }
  if (json) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: json ? JSON.stringify(body) : body });
  } catch {
    throw new Error('İnternete bağlanılamadı.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || 'Groq hatası ' + res.status);
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
    status('Düzenleniyor…');
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
    if (error) status('Düzenlenmeden kaydedildi: ' + error.message, true);
    else status('Not kaydedildi.');
  } else {
    status('Tutarlar okunuyor…');
    const items = normalizeItems((await ask(MONEY_PROMPT, text)).items);
    if (!items.length) throw new Error('Tutar bulunamadı. Örneğin "öğlen yemeğe 250 verdim" de.');
    for (const i of items) db.tx.push({ id: uid(), date, time, ...i, note: text });
    save();
    render();
    status(`${items.length} kayıt eklendi.`);
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
  status('Yazıya dökülüyor…');
  let text;
  try {
    text = await transcribe(blob);
    pendingAudio = null;
  } catch (e) {
    pendingAudio = blob;
    setBusy(false);
    return status('Yazıya dökülemedi: ' + e.message, true, true);
  }
  setBusy(false);
  if (!text) return status('Bir şey anlaşılmadı. Mikrofona daha yakın konuş.', true);
  await submitText(text);
}

function stopRecorder(r) {
  if (r.state === 'recording') r.stop();
}

async function toggleMic() {
  if (recorder) return stopRecorder(recorder);
  const ctx = new AudioContext(); // created before any await so iOS still counts the tap as the user gesture
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    ctx.close();
    return status('Mikrofon izni verilmedi. Tarayıcı ayarlarından izin ver.', true);
  }
  ctx.resume();
  const analyser = ctx.createAnalyser();
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const silenceMs = (Number(localStorage.getItem('daybook.silence')) || DEFAULT_SILENCE_S) * 1000;
  const chunks = [];
  const started = Date.now();
  let lastVoice = started;
  let spoke = false;
  let floor = 1;
  const r = new MediaRecorder(stream);
  r.ondataavailable = e => e.data.size && chunks.push(e.data);
  r.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    ctx.close();
    clearInterval(timer);
    recorder = null;
    $('#mic').classList.remove('rec');
    if (!spoke) return status('Ses algılanmadı.', true);
    if (Date.now() - started < MIN_RECORDING_MS) return status('Çok kısa. Dokun ve konuş, susunca kendisi durur.', true);
    submitAudio(new Blob(chunks, { type: r.mimeType }));
  };
  r.start();
  recorder = r;
  $('#mic').classList.add('rec');
  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
    // The noise floor drops at once and rises slowly: steady workshop noise is learned within
    // seconds, while the short gaps between words keep it low during speech.
    // ponytail: energy-based voice detection, swap for a VAD model if loud machines keep it recording.
    floor = rms < floor ? rms : floor + (rms - floor) * 0.01;
    const now = Date.now();
    if (rms > Math.max(floor * 3, MIN_VOICE_RMS)) {
      lastVoice = now;
      spoke = true;
    }
    if (now - lastVoice > (spoke ? silenceMs : NO_SPEECH_MS)) return stopRecorder(r);
    const s = Math.floor((now - started) / 1000);
    status(`Dinliyorum… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · susunca kendisi durur`);
  };
  tick();
  timer = setInterval(tick, 100);
}

// ---------- backup ----------

function exportBackup() {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
  a.download = `cihan-not-yedek-${iso(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.notes) || !Array.isArray(d.tx)) throw new Error('bu dosya Cihan Not Ajanı yedeği değil');
    const merge = (mine, theirs) => {
      const ids = new Set(mine.map(x => x.id));
      let added = 0;
      for (const x of theirs) if (!ids.has(x.id)) { mine.push(x); added++; }
      return added;
    };
    const added = merge(db.notes, d.notes) + merge(db.tx, d.tx);
    save();
    render();
    status(`${added} yeni kayıt yüklendi.`);
  } catch (e) {
    status('Yüklenemedi: ' + e.message, true);
  }
}

// ---------- cloud copy ----------
// One-way: the phone pushes every change to Supabase and never reads anything back,
// so the server can never change or remove what is on the phone.

let syncing = false;
let syncAgain = false;
let deviceSent = false;

async function supa(path, body, token, method = 'POST') {
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(SB + path, { method, headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Supabase ${res.status}: ${text}`), { status: res.status });
  return text ? JSON.parse(text) : null;
}

async function session() {
  let s = JSON.parse(localStorage.getItem('daybook.sb') || 'null');
  if (s && s.expires_at * 1000 > Date.now() + 60000) return s;
  try {
    s = await supa(s ? '/auth/v1/token?grant_type=refresh_token' : '/auth/v1/signup', s ? { refresh_token: s.refresh_token } : {});
  } catch (e) {
    if (!s || ![400, 401, 403].includes(e.status)) throw e;
    // Refresh token revoked: continue as a new anonymous user and upload everything again under it.
    s = await supa('/auth/v1/signup', {});
    localStorage.removeItem('daybook.synced');
    deviceSent = false;
  }
  s = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, user_id: s.user.id };
  localStorage.setItem('daybook.sb', JSON.stringify(s));
  return s;
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  return h;
}

// Items that differ from what the server last confirmed, and ids deleted on the phone since then.
// Only hashes are kept for the comparison so the phone's storage isn't doubled.
function changes(data, synced) {
  const seen = {};
  const rows = [];
  for (const kind of ['notes', 'tx']) {
    for (const x of data[kind]) {
      seen[x.id] = hash(JSON.stringify(x));
      if (synced[x.id] !== seen[x.id]) rows.push({ kind, x });
    }
  }
  return { rows, gone: Object.keys(synced).filter(id => !(id in seen)), seen };
}

async function deviceName() {
  try {
    const h = await navigator.userAgentData?.getHighEntropyValues(['model', 'platformVersion']);
    if (h?.model) return `${h.model} · ${h.platform} ${h.platformVersion}`;
  } catch {}
  return navigator.userAgent.match(/\(([^)]*)\)/)?.[1] || navigator.userAgent;
}

async function sync() {
  if (syncing) return void (syncAgain = true);
  syncing = true;
  try {
    const s = await session();
    const now = new Date().toISOString();
    if (!deviceSent) {
      await supa('/rest/v1/devices', { user_id: s.user_id, device: await deviceName(), updated_at: now }, s.access_token);
      deviceSent = true;
    }
    const { rows, gone, seen } = changes(db, JSON.parse(localStorage.getItem('daybook.synced') || '{}'));
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500).map(({ kind, x }) => ({ user_id: s.user_id, id: x.id, kind, data: x, deleted: false, updated_at: now }));
      await supa('/rest/v1/items', batch, s.access_token);
    }
    if (gone.length) {
      const ids = encodeURIComponent(`(${gone.map(id => `"${id}"`).join(',')})`);
      await supa('/rest/v1/items?id=in.' + ids, { deleted: true, updated_at: now }, s.access_token, 'PATCH');
    }
    localStorage.setItem('daybook.synced', JSON.stringify(seen));
    localStorage.setItem('daybook.syncedAt', now);
  } catch (e) {
    console.warn('Cloud copy failed, retrying on the next change or launch:', e);
  } finally {
    syncing = false;
    if (syncAgain) {
      syncAgain = false;
      sync();
    }
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
  $('#silence').value = localStorage.getItem('daybook.silence') || '';
  $('#silence').placeholder = DEFAULT_SILENCE_S;
  dlg.showModal();
};
$('#cancel').onclick = () => dlg.close();
dlg.onclose = () => {
  if (dlg.returnValue !== 'save') return;
  dlg.returnValue = '';
  const v = $('#silence').value.trim();
  v ? localStorage.setItem('daybook.silence', v) : localStorage.removeItem('daybook.silence');
  status('Ayarlar kaydedildi.');
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
sync();
addEventListener('online', sync);
if (linkKey) status('Groq anahtarı kaydedildi. Şimdi bu sayfayı ana ekrana ekle.');

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
  const data = { notes: [{ id: 'a', text: 'x' }], tx: [{ id: 'b', amount: 1 }] };
  const first = changes(data, {});
  console.assert(first.rows.length === 2 && !first.gone.length, 'first sync uploads everything');
  data.notes[0].text = 'y';
  data.tx = [];
  const next = changes(data, first.seen);
  console.assert(next.rows.length === 1 && next.rows[0].x.id === 'a' && next.gone.join() === 'b', 'edit re-sent, delete marked');
  console.assert(!changes(data, next.seen).rows.length && !changes(data, next.seen).gone.length, 'no change, nothing sent');
  console.log('selftest done');
}
