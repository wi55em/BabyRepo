'use strict';

/* ════════════════════════════════════════════
   STORAGE HELPERS
   ════════════════════════════════════════════ */
const STORAGE = {
  BABY: 'bt-baby',
  DAYS: 'bt-days',
};

function loadBaby() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.BABY)) || null;
  } catch {
    return null;
  }
}

function saveBaby(baby) {
  localStorage.setItem(STORAGE.BABY, JSON.stringify(baby));
}

function loadDays() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.DAYS)) || {};
  } catch {
    return {};
  }
}

function saveDays(days) {
  localStorage.setItem(STORAGE.DAYS, JSON.stringify(days));
}

/** Returns a deep copy of day data, filling in defaults if not present. */
function getDayData(dayNum) {
  const days = loadDays();
  return Object.assign({ wetDiapers: 0, dirtyDiapers: 0, feedings: [] },
                       days[String(dayNum)] || {});
}

function saveDayData(dayNum, data) {
  const days = loadDays();
  days[String(dayNum)] = data;
  saveDays(days);
}

/* ════════════════════════════════════════════
   DATE / DAY CALCULATION HELPERS
   ════════════════════════════════════════════ */

/**
 * Returns the current day number since birth (1-based).
 * Day 1 = from birth moment to 24 h later, etc.
 */
function getCurrentDayNumber(birthDateTime) {
  const birth = new Date(birthDateTime);
  const now   = new Date();
  const ms    = now - birth;
  if (ms < 0) return 1; // clock edge case
  return Math.floor(ms / 86_400_000) + 1;
}

/**
 * Returns { start: Date, end: Date } for the given day number.
 */
function getDayRange(birthDateTime, dayNum) {
  const birth = new Date(birthDateTime);
  const start = new Date(birth.getTime() + (dayNum - 1) * 86_400_000);
  const end   = new Date(start.getTime() + 86_400_000 - 1);
  return { start, end };
}

/**
 * Human-readable date label for a day range.
 * If the 24 h window crosses midnight, shows "Jan 15–16".
 */
function formatDayRange(birthDateTime, dayNum) {
  const { start, end } = getDayRange(birthDateTime, dayNum);
  const opts = { month: 'short', day: 'numeric' };
  const s = start.toLocaleDateString('en-US', opts);
  const e = end.toLocaleDateString('en-US', opts);
  return s === e ? s : `${s} – ${e}`;
}

/**
 * Format a time string "HH:MM" into "h:MM AM/PM".
 */
function formatTime(hhmm) {
  if (!hhmm) return '';
  const [hh, mm] = hhmm.split(':').map(Number);
  const ampm = hh < 12 ? 'AM' : 'PM';
  const h    = hh % 12 || 12;
  return `${h}:${mm.toString().padStart(2, '0')} ${ampm}`;
}

/**
 * Converts "HH:MM" within a given day to a sortable integer.
 * Accounts for days that span midnight: the birth-time-of-day is "hour 0"
 * of each day, so we rotate the 24-h clock to start at birth hour.
 */
function feedingSort(birthDateTime, dayNum, hhmm) {
  const birth         = new Date(birthDateTime);
  const birthMinutes  = birth.getHours() * 60 + birth.getMinutes();
  const [hh, mm]      = hhmm.split(':').map(Number);
  let raw = hh * 60 + mm;
  let adjusted = raw - birthMinutes;
  if (adjusted < 0) adjusted += 1440; // wrap around midnight
  return adjusted;
}

/* ════════════════════════════════════════════
   UNIQUE ID GENERATOR
   ════════════════════════════════════════════ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ════════════════════════════════════════════
   SAFE HTML ESCAPE
   ════════════════════════════════════════════ */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str || '');
  return d.innerHTML;
}

/* ════════════════════════════════════════════
   TOAST NOTIFICATION
   ════════════════════════════════════════════ */
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

/* ════════════════════════════════════════════
   SCREEN MANAGEMENT
   ════════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === id);
  });
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

/* ════════════════════════════════════════════
   APP STATE
   ════════════════════════════════════════════ */
const state = {
  currentDayView:       null,  // day number currently shown in detail view
  pendingDeleteId:      null,  // feeding id pending deletion confirmation
};

/* ════════════════════════════════════════════
   SETUP SCREEN
   ════════════════════════════════════════════ */
function initSetupScreen() {
  // Pre-fill today's date/time as defaults
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('birth-date').value =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  document.getElementById('birth-time').value =
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/* ════════════════════════════════════════════
   MAIN SCREEN — DAYS LIST
   ════════════════════════════════════════════ */
function showMainScreen() {
  const baby = loadBaby();
  if (!baby) { showScreen('screen-setup'); return; }

  const currentDay = getCurrentDayNumber(baby.birthDateTime);

  document.getElementById('header-baby-name').textContent = baby.name;
  document.getElementById('header-day-badge').textContent =
    `Day ${currentDay} · ${formatDayRange(baby.birthDateTime, currentDay)}`;

  renderDaysList(baby, currentDay);
  showScreen('screen-main');
}

function renderDaysList(baby, currentDay) {
  const days = loadDays();
  const list = document.getElementById('days-list');
  list.innerHTML = '';

  for (let d = currentDay; d >= 1; d--) {
    const data    = Object.assign({ wetDiapers: 0, dirtyDiapers: 0, feedings: [] },
                                  days[String(d)] || {});
    const isToday = d === currentDay;
    const card    = buildDayCard(baby, d, data, isToday);
    list.appendChild(card);
  }
}

function buildDayCard(baby, dayNum, data, isToday) {
  const feedCount = (data.feedings || []).length;
  const el = document.createElement('div');
  el.className = `day-card${isToday ? ' today' : ''}`;
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `Day ${dayNum}, ${formatDayRange(baby.birthDateTime, dayNum)}`);

  el.innerHTML = `
    <div class="day-card-top">
      <div class="day-card-label">
        <div>
          <div class="day-number">
            Day ${dayNum}
            ${isToday ? '<span class="today-pill">Today</span>' : ''}
          </div>
          <div class="day-date">${formatDayRange(baby.birthDateTime, dayNum)}</div>
        </div>
      </div>
      <div class="day-card-chevron">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9,18 15,12 9,6"/>
        </svg>
      </div>
    </div>
    <div class="day-card-stats">
      <div class="day-stat stat-wet">
        <span class="day-stat-emoji">💧</span>
        <div>
          <div class="day-stat-count">${data.wetDiapers}</div>
          <div class="day-stat-label">Wet</div>
        </div>
      </div>
      <div class="day-stat stat-dirty">
        <span class="day-stat-emoji">💩</span>
        <div>
          <div class="day-stat-count">${data.dirtyDiapers}</div>
          <div class="day-stat-label">Dirty</div>
        </div>
      </div>
      <div class="day-stat stat-feed">
        <span class="day-stat-emoji">🤱</span>
        <div>
          <div class="day-stat-count">${feedCount}</div>
          <div class="day-stat-label">Feeds</div>
        </div>
      </div>
    </div>
  `;

  const openDetail = () => showDayDetail(dayNum);
  el.addEventListener('click', openDetail);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openDetail(); });
  return el;
}

/* ════════════════════════════════════════════
   DAY DETAIL SCREEN
   ════════════════════════════════════════════ */
function showDayDetail(dayNum) {
  state.currentDayView = dayNum;
  const baby = loadBaby();

  document.getElementById('day-detail-title').textContent = `Day ${dayNum}`;
  document.getElementById('day-detail-date').textContent  =
    formatDayRange(baby.birthDateTime, dayNum);

  renderDayDetail();
  showScreen('screen-day');
}

function renderDayDetail() {
  const data = getDayData(state.currentDayView);
  document.getElementById('wet-count').textContent   = data.wetDiapers;
  document.getElementById('dirty-count').textContent = data.dirtyDiapers;
  renderFeedingsList(data.feedings || []);
}

/* ════════════════════════════════════════════
   FEEDINGS LIST
   ════════════════════════════════════════════ */
function renderFeedingsList(feedings) {
  const container = document.getElementById('feedings-list');
  container.innerHTML = '';

  if (!feedings.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">🤱</div>
        <p class="empty-state-title">No sessions yet</p>
        <p class="empty-state-hint">Tap "Add Session" to log a feeding</p>
      </div>
    `;
    return;
  }

  const baby   = loadBaby();
  const sorted = [...feedings].sort((a, b) =>
    feedingSort(baby.birthDateTime, state.currentDayView, a.time) -
    feedingSort(baby.birthDateTime, state.currentDayView, b.time)
  );

  sorted.forEach((f, idx) => {
    const item = document.createElement('div');
    item.className = 'feeding-item';
    item.style.animationDelay = `${idx * 40}ms`;

    item.innerHTML = `
      <div>
        <div class="feeding-time">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12,6 12,12 16,14"/>
          </svg>
          ${esc(formatTime(f.time))}
        </div>
      </div>
      <div class="feeding-content">
        ${f.note
          ? `<p class="feeding-note">${esc(f.note)}</p>`
          : `<p class="feeding-no-note">No note</p>`
        }
      </div>
      <div class="feeding-actions">
        <button class="icon-btn-sm" data-action="edit" data-id="${f.id}"
                aria-label="Edit session" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="icon-btn-sm delete" data-action="delete" data-id="${f.id}"
                aria-label="Delete session" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3,6 5,6 21,6"/>
            <path d="M19,6l-1,14H6L5,6"/>
            <path d="M10,11v6"/><path d="M14,11v6"/>
            <path d="M9,6V4h6v2"/>
          </svg>
        </button>
      </div>
    `;

    item.querySelector('[data-action="edit"]')
        .addEventListener('click', () => openEditFeedingModal(f.id));
    item.querySelector('[data-action="delete"]')
        .addEventListener('click', () => promptDeleteFeeding(f.id));

    container.appendChild(item);
  });
}

/* ════════════════════════════════════════════
   DIAPER CONTROLS
   ════════════════════════════════════════════ */
function changeDiaper(type, delta) {
  const data = getDayData(state.currentDayView);
  const key  = type === 'wet' ? 'wetDiapers' : 'dirtyDiapers';
  data[key]  = Math.max(0, (data[key] || 0) + delta);
  saveDayData(state.currentDayView, data);
  document.getElementById(`${type}-count`).textContent = data[key];

  // Bounce animation on counter value
  const el = document.getElementById(`${type}-count`);
  el.style.transform = 'scale(1.3)';
  setTimeout(() => { el.style.transform = ''; }, 150);
}

/* ════════════════════════════════════════════
   ADD / EDIT FEEDING MODAL
   ════════════════════════════════════════════ */
function openAddFeedingModal() {
  document.getElementById('feeding-modal-title').textContent = 'Add Feeding Session';
  document.getElementById('feeding-edit-id').value = '';
  document.getElementById('feeding-note').value    = '';

  // Default time = now, clamped to the current day window
  const baby = loadBaby();
  const { start, end } = getDayRange(baby.birthDateTime, state.currentDayView);
  const now  = new Date();
  const clampedTime = now >= start && now <= end ? now : start;

  const pad = n => String(n).padStart(2, '0');
  document.getElementById('feeding-time').value =
    `${pad(clampedTime.getHours())}:${pad(clampedTime.getMinutes())}`;

  openModal('modal-feeding');
  document.getElementById('feeding-time').focus();
}

function openEditFeedingModal(feedingId) {
  const data    = getDayData(state.currentDayView);
  const feeding = (data.feedings || []).find(f => f.id === feedingId);
  if (!feeding) return;

  document.getElementById('feeding-modal-title').textContent = 'Edit Feeding Session';
  document.getElementById('feeding-edit-id').value = feedingId;
  document.getElementById('feeding-time').value    = feeding.time;
  document.getElementById('feeding-note').value    = feeding.note || '';

  openModal('modal-feeding');
  document.getElementById('feeding-time').focus();
}

function handleFeedingFormSubmit(e) {
  e.preventDefault();

  const time      = document.getElementById('feeding-time').value;
  const note      = document.getElementById('feeding-note').value.trim();
  const editingId = document.getElementById('feeding-edit-id').value;

  if (!time) return;

  const data = getDayData(state.currentDayView);
  data.feedings = data.feedings || [];

  if (editingId) {
    const f = data.feedings.find(x => x.id === editingId);
    if (f) {
      f.time = time;
      f.note = note;
    }
    showToast('Session updated');
  } else {
    data.feedings.push({ id: uid(), time, note });
    showToast('Session added');
  }

  saveDayData(state.currentDayView, data);
  closeModal('modal-feeding');
  renderDayDetail();
}

/* ════════════════════════════════════════════
   DELETE FEEDING
   ════════════════════════════════════════════ */
function promptDeleteFeeding(feedingId) {
  state.pendingDeleteId = feedingId;
  openModal('modal-confirm');
}

function executeDeleteFeeding() {
  if (!state.pendingDeleteId) return;

  const data = getDayData(state.currentDayView);
  data.feedings = (data.feedings || []).filter(f => f.id !== state.pendingDeleteId);
  saveDayData(state.currentDayView, data);

  state.pendingDeleteId = null;
  closeModal('modal-confirm');
  renderDayDetail();
  showToast('Session deleted');
}

/* ════════════════════════════════════════════
   SETTINGS MODAL
   ════════════════════════════════════════════ */
function openSettingsModal() {
  const baby = loadBaby();
  if (!baby) return;

  const [date, time] = baby.birthDateTime.split('T');
  document.getElementById('settings-name').value = baby.name;
  document.getElementById('settings-date').value = date;
  document.getElementById('settings-time').value = time ? time.slice(0, 5) : '';

  openModal('modal-settings');
  document.getElementById('settings-name').focus();
}

function handleSettingsFormSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('settings-name').value.trim();
  const date = document.getElementById('settings-date').value;
  const time = document.getElementById('settings-time').value;

  if (!name || !date || !time) return;

  saveBaby({ name, birthDateTime: `${date}T${time}` });
  closeModal('modal-settings');
  showMainScreen();
  showToast('Settings saved');
}

/* ════════════════════════════════════════════
   SETUP FORM SUBMIT
   ════════════════════════════════════════════ */
function handleSetupFormSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('baby-name').value.trim();
  const date = document.getElementById('birth-date').value;
  const time = document.getElementById('birth-time').value;

  if (!name || !date || !time) return;

  saveBaby({ name, birthDateTime: `${date}T${time}` });
  showMainScreen();
}

/* ════════════════════════════════════════════
   CLOSE MODALS ON OVERLAY CLICK
   ════════════════════════════════════════════ */
function bindOverlayClose(overlayId) {
  document.getElementById(overlayId).addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal(overlayId);
  });
}

/* ════════════════════════════════════════════
   BIND ALL EVENT LISTENERS
   ════════════════════════════════════════════ */
function bindEvents() {
  // Setup screen
  document.getElementById('setup-form')
    .addEventListener('submit', handleSetupFormSubmit);

  // Main screen: settings button
  document.getElementById('btn-settings')
    .addEventListener('click', openSettingsModal);

  // Day detail: back button
  document.getElementById('btn-back').addEventListener('click', () => {
    showMainScreen();
  });

  // Diaper counters
  document.getElementById('wet-plus')
    .addEventListener('click', () => changeDiaper('wet', +1));
  document.getElementById('wet-minus')
    .addEventListener('click', () => changeDiaper('wet', -1));
  document.getElementById('dirty-plus')
    .addEventListener('click', () => changeDiaper('dirty', +1));
  document.getElementById('dirty-minus')
    .addEventListener('click', () => changeDiaper('dirty', -1));

  // Add feeding button
  document.getElementById('btn-add-feeding')
    .addEventListener('click', openAddFeedingModal);

  // Feeding modal
  document.getElementById('feeding-form')
    .addEventListener('submit', handleFeedingFormSubmit);
  document.getElementById('btn-close-feeding')
    .addEventListener('click', () => closeModal('modal-feeding'));
  document.getElementById('btn-cancel-feeding')
    .addEventListener('click', () => closeModal('modal-feeding'));

  // Settings modal
  document.getElementById('settings-form')
    .addEventListener('submit', handleSettingsFormSubmit);
  document.getElementById('btn-close-settings')
    .addEventListener('click', () => closeModal('modal-settings'));
  document.getElementById('btn-cancel-settings')
    .addEventListener('click', () => closeModal('modal-settings'));

  // Delete confirm modal
  document.getElementById('btn-confirm-delete')
    .addEventListener('click', executeDeleteFeeding);
  document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    state.pendingDeleteId = null;
    closeModal('modal-confirm');
  });

  // Overlay click-outside closes
  ['modal-settings', 'modal-feeding', 'modal-confirm'].forEach(bindOverlayClose);

  // Keyboard: Escape closes topmost visible modal
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const modals = ['modal-feeding', 'modal-settings', 'modal-confirm'];
    for (const id of modals) {
      const el = document.getElementById(id);
      if (!el.classList.contains('hidden')) {
        closeModal(id);
        if (id === 'modal-confirm') state.pendingDeleteId = null;
        break;
      }
    }
  });
}

/* ════════════════════════════════════════════
   SERVICE WORKER REGISTRATION
   ════════════════════════════════════════════ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .catch(err => console.warn('SW registration failed:', err));
    });
  }
}

/* ════════════════════════════════════════════
   BOOTSTRAP
   ════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initSetupScreen();
  registerSW();

  const baby = loadBaby();
  if (baby) {
    showMainScreen();
  } else {
    showScreen('screen-setup');
  }
});
