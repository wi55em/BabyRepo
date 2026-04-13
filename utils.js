'use strict';

/* ════════════════════════════════════════
   GENERATORS & HELPERS
   ════════════════════════════════════════ */
function generateToken() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}

/* ════════════════════════════════════════
   DATE / DAY MATH
   ════════════════════════════════════════ */
function getCurrentDayNumber(birthDateTime) {
  const ms = Date.now() - new Date(birthDateTime).getTime();
  return ms < 0 ? 1 : Math.floor(ms / 86_400_000) + 1;
}

function getDayRange(birthDateTime, dayNum) {
  const birth = new Date(birthDateTime).getTime();
  return {
    start: new Date(birth + (dayNum - 1) * 86_400_000),
    end:   new Date(birth +  dayNum      * 86_400_000 - 1),
  };
}

function formatDayRange(birthDateTime, dayNum) {
  const { start, end } = getDayRange(birthDateTime, dayNum);
  const opts = { month: 'short', day: 'numeric' };
  const s = start.toLocaleDateString('en-US', opts);
  const e = end.toLocaleDateString('en-US', opts);
  return s === e ? s : `${s} – ${e}`;
}

function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function feedingSortKey(birthDateTime, hhmm) {
  const birth = new Date(birthDateTime);
  const base  = birth.getHours() * 60 + birth.getMinutes();
  const [h, m] = hhmm.split(':').map(Number);
  let v = h * 60 + m - base;
  if (v < 0) v += 1440;
  return v;
}

/* ════════════════════════════════════════
   SCREEN / MODAL MANAGEMENT
   ════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === id)
  );
}

function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

let _toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
}

/* ════════════════════════════════════════
   URL HELPERS
   ════════════════════════════════════════ */
function getShareUrl(token) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('b', token);
  return url.toString();
}

function updateUrl(token) {
  const url = new URL(window.location.href);
  url.searchParams.set('b', token);
  history.replaceState(null, '', url.toString());
}

function clearUrlParams() {
  history.replaceState(null, '', window.location.pathname);
}

function extractToken(raw) {
  const s = (raw || '').trim();
  try {
    const url = new URL(s);
    return url.searchParams.get('b') || url.searchParams.get('join') || s;
  } catch {
    return s;
  }
}
