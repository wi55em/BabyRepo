'use strict';

/* ════════════════════════════════════════
   APP STATE
   ════════════════════════════════════════ */
const ST = {
  token:        null,
  baby:         null,
  currentDay:   null,
  currentData:  null,
  pendingDelId: null,
  setupMode:    'new', // 'new' | 'add'
};

/* ════════════════════════════════════════
   SETUP SCREEN
   ════════════════════════════════════════ */
function openSetupScreen(mode) {
  ST.setupMode = mode || 'new';
  const isAdd  = ST.setupMode === 'add';
  const now    = new Date();
  const pad    = n => String(n).padStart(2, '0');

  document.getElementById('setup-title').textContent =
    isAdd ? 'Add New Baby' : 'Baby Tracker';
  document.getElementById('setup-subtitle').textContent =
    isAdd ? "Enter the new baby's details" : "Start tracking your baby's journey";
  document.getElementById('setup-submit-btn').textContent =
    isAdd ? 'Add Baby' : 'Start Tracking';
  document.getElementById('baby-name').value  = '';
  document.getElementById('birth-date').value =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  document.getElementById('birth-time').value =
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  document.getElementById('setup-back-btn').classList.toggle('hidden', !isAdd);

  showScreen('screen-setup');
}

async function handleSetupSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('baby-name').value.trim();
  const date = document.getElementById('birth-date').value;
  const time = document.getElementById('birth-time').value;
  if (!name || !date || !time) return;

  const btn = document.getElementById('setup-submit-btn');
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Setting up…';

  try {
    const token = await createBaby(name, `${date}T${time}`);
    setActiveToken(token);
    ST.token = token;
    ST.baby  = getCachedBaby(token);
    updateUrl(token);
    await showMainScreen();
    showToast(`${name}'s tracker is ready!`);
  } catch (err) {
    console.error(err);
    showToast('Setup failed — please try again.');
  } finally {
    btn.disabled    = false;
    btn.textContent = ST.setupMode === 'add' ? 'Add Baby' : 'Start Tracking';
  }
}

/* ════════════════════════════════════════
   CLOUD INDICATOR
   Traffic-light style, driven by db.js's CLOUD_STATE machine:
     hidden    — Firebase not configured (no chip shown)
     pending   — pulsing orange  "Connecting…"
     connected — pulsing green   "Sharing on"
     offline   — solid red       "Offline"
     error     — solid red       "Connection failed"
   ════════════════════════════════════════ */
const CLOUD_UI = {
  pending:   { label: 'Connecting…',       title: 'Connecting to cloud…' },
  connected: { label: 'Sharing on',        title: 'Cloud sync active — data syncs across all devices' },
  offline:   { label: 'Offline',           title: 'Offline — changes will sync when reconnected' },
  error:     { label: 'Connection failed', title: 'Cloud connection failed — check Firebase configuration' },
};

function renderCloudIndicator(state) {
  const el = document.getElementById('cloud-indicator');
  if (!el) return;
  el.classList.remove('cloud-pending', 'cloud-connected', 'cloud-offline', 'cloud-error');
  // Effective state: browser-offline trumps whatever the probe last reported.
  const effective = (state !== 'hidden' && !navigator.onLine) ? 'offline' : state;
  const ui = CLOUD_UI[effective];
  if (!ui) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.classList.add(`cloud-${effective}`);
  el.title = ui.title;
  el.querySelector('.cloud-label').textContent = ui.label;
}

/* ════════════════════════════════════════
   MAIN SCREEN
   ════════════════════════════════════════ */
async function showMainScreen() {
  if (!ST.baby) { openSetupScreen('new'); return; }

  const currentDay = getCurrentDayNumber(ST.baby.birthDateTime);
  document.getElementById('header-baby-name').textContent = ST.baby.name;
  document.getElementById('header-day-badge').textContent =
    `Day ${currentDay} · ${formatDayRange(ST.baby.birthDateTime, currentDay)}`;

  const count = getKnownTokens().length;
  const multi = document.getElementById('header-baby-count');
  multi.textContent = count > 1 ? `${count} babies` : '';
  multi.classList.toggle('hidden', count <= 1);

  renderCloudIndicator(getCloudState());
  renderDaysList(ST.token, ST.baby);
  showScreen('screen-main');
}

/* ════════════════════════════════════════
   DAY DETAIL
   ════════════════════════════════════════ */
async function openDayDetail(dayNum) {
  unsubscribeDayData();
  ST.currentDay = dayNum;

  document.getElementById('day-detail-title').textContent = `Day ${dayNum}`;
  document.getElementById('day-detail-date').textContent  =
    formatDayRange(ST.baby.birthDateTime, dayNum);

  showScreen('screen-day');

  const data = await readDayData(ST.token, dayNum);
  ST.currentData = data;
  applyDayData(data);

  subscribeDayData(ST.token, dayNum, live => {
    ST.currentData = live;
    applyDayData(live);
  });
}

/* ════════════════════════════════════════
   DIAPERS
   ════════════════════════════════════════ */
async function changeDiaper(type, delta) {
  const data = ST.currentData || getCachedDayData(ST.token, ST.currentDay);
  const key  = type === 'wet' ? 'wetDiapers' : 'dirtyDiapers';
  data[key]  = Math.max(0, (data[key] || 0) + delta);
  ST.currentData = data;

  const el = document.getElementById(`${type}-count`);
  el.textContent = data[key];
  el.classList.remove('bounce');
  void el.offsetWidth; // trigger reflow for re-animation
  el.classList.add('bounce');

  await writeDayData(ST.token, ST.currentDay, data);
}

/* ════════════════════════════════════════
   FEEDING MODAL
   ════════════════════════════════════════ */
function openAddFeedingModal() {
  document.getElementById('feeding-modal-title').textContent = 'Add Feeding Session';
  document.getElementById('feeding-edit-id').value = '';
  document.getElementById('feeding-note').value    = '';

  const { start, end } = getDayRange(ST.baby.birthDateTime, ST.currentDay);
  const now = new Date();
  const t   = (now >= start && now <= end) ? now : start;
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('feeding-time').value =
    `${pad(t.getHours())}:${pad(t.getMinutes())}`;

  openModal('modal-feeding');
  setTimeout(() => document.getElementById('feeding-time').focus(), 60);
}

function openEditFeedingModal(id) {
  const f = (ST.currentData?.feedings || []).find(x => x.id === id);
  if (!f) return;
  document.getElementById('feeding-modal-title').textContent = 'Edit Feeding Session';
  document.getElementById('feeding-edit-id').value = id;
  document.getElementById('feeding-time').value    = f.time;
  document.getElementById('feeding-note').value    = f.note || '';
  openModal('modal-feeding');
  setTimeout(() => document.getElementById('feeding-time').focus(), 60);
}

async function handleFeedingSubmit(e) {
  e.preventDefault();
  const time   = document.getElementById('feeding-time').value;
  const note   = document.getElementById('feeding-note').value.trim();
  const editId = document.getElementById('feeding-edit-id').value;
  if (!time) return;

  const data = ST.currentData || getCachedDayData(ST.token, ST.currentDay);
  data.feedings = data.feedings || [];

  if (editId) {
    const f = data.feedings.find(x => x.id === editId);
    if (f) { f.time = time; f.note = note; }
    showToast('Session updated');
  } else {
    data.feedings.push({ id: uid(), time, note });
    showToast('Session added');
  }

  ST.currentData = data;
  await writeDayData(ST.token, ST.currentDay, data);
  closeModal('modal-feeding');
  renderFeedingsList(data.feedings);
}

/* ════════════════════════════════════════
   DELETE FEEDING
   ════════════════════════════════════════ */
function promptDeleteFeeding(id) {
  ST.pendingDelId = id;
  openModal('modal-confirm');
}

async function executeDeleteFeeding() {
  const data = ST.currentData || getCachedDayData(ST.token, ST.currentDay);
  data.feedings   = (data.feedings || []).filter(f => f.id !== ST.pendingDelId);
  ST.currentData  = data;
  ST.pendingDelId = null;
  closeModal('modal-confirm');
  await writeDayData(ST.token, ST.currentDay, data);
  renderFeedingsList(data.feedings);
  showToast('Session deleted');
}

/* ════════════════════════════════════════
   SETTINGS MODAL
   ════════════════════════════════════════ */
function openSettingsModal() {
  if (!ST.baby) return;
  const [date, time] = ST.baby.birthDateTime.split('T');
  document.getElementById('settings-name').value = ST.baby.name;
  document.getElementById('settings-date').value = date;
  document.getElementById('settings-time').value = (time || '').slice(0, 5);

  // Label the delete button based on shared state
  const label = document.getElementById('delete-current-baby-label');
  label.textContent = ST.baby.shared ? 'Remove from my device' : 'Delete Baby';

  openModal('modal-settings');
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('settings-name').value.trim();
  const date = document.getElementById('settings-date').value;
  const time = document.getElementById('settings-time').value;
  if (!name || !date || !time) return;

  ST.baby = await updateBabyInfo(ST.token, { name, birthDateTime: `${date}T${time}` });
  closeModal('modal-settings');
  await showMainScreen();
  showToast('Settings saved');
}

/* ════════════════════════════════════════
   DELETE / REMOVE BABY

   Story matrix — decided at prompt time based on live Firestore membership:

     D1  Firebase off (local-only)   → Delete permanently (localStorage only)
     D2  Firebase on, only me        → Delete permanently (Firestore + local)
     D3  Firebase on, shared (>1)    → Only: Remove from my device (arrayRemove me)
     D4  Firebase on, unreachable    → Only: Remove from my device (permanent disabled)
     D5  Offline delete              → Remove from my device always works locally;
                                        permanent deletes queue via Firestore
                                        offline persistence and flush on reconnect.
   ════════════════════════════════════════ */
let _deleteBabyToken = null;

async function promptDeleteBaby(token) {
  const baby = getCachedBaby(token);
  if (!baby) return;
  _deleteBabyToken = token;

  const title     = document.getElementById('delete-baby-title');
  const text      = document.getElementById('delete-baby-text');
  const permBtn   = document.getElementById('btn-delete-baby-perm');
  const removeBtn = document.getElementById('btn-remove-device-baby');

  closeModal('modal-settings');
  closeModal('modal-baby-picker');

  // D1 — local-only: one-step permanent delete
  if (!USE_FIREBASE) {
    title.textContent     = `Delete ${esc(baby.name)}?`;
    text.textContent      = 'All tracking data will be permanently removed from this device.';
    permBtn.textContent   = 'Delete permanently';
    permBtn.disabled      = false;
    permBtn.classList.remove('hidden');
    removeBtn.classList.add('hidden');
    openModal('modal-delete-baby');
    return;
  }

  // Firebase is on — show modal immediately with a "checking" placeholder,
  // then update it once we've read the server-side member count.
  title.textContent   = `Delete ${esc(baby.name)}?`;
  text.textContent    = 'Checking who has access…';
  permBtn.classList.add('hidden');
  removeBtn.classList.add('hidden');
  openModal('modal-delete-baby');

  const memberCount = await getBabyMemberCount(token);
  // If the user already dismissed / switched away, bail out.
  if (_deleteBabyToken !== token) return;

  if (memberCount === null) {
    // D4 — Firestore unreachable. Only safe option is local removal.
    title.textContent     = `Remove ${esc(baby.name)}?`;
    text.textContent      = "Can't verify who else has access right now (offline). You can remove this tracker from this device — it will stay intact on the cloud for anyone else who has the link. Permanent deletion is disabled until you reconnect.";
    removeBtn.textContent = 'Remove from my device';
    removeBtn.classList.remove('hidden');
    permBtn.classList.add('hidden');
    return;
  }

  if (memberCount > 1) {
    // D3 — others still have access; never wipe their data.
    const others = memberCount - 1;
    title.textContent     = `Remove ${esc(baby.name)}?`;
    text.textContent      = `This tracker is shared with ${others} other device${others === 1 ? '' : 's'}. You can remove it from your device — the others will keep full access.`;
    removeBtn.textContent = 'Remove from my device';
    removeBtn.classList.remove('hidden');
    permBtn.classList.add('hidden');
    return;
  }

  // D2 / D5 — I'm the only (or last) member. Permanent delete is safe.
  title.textContent     = `Delete ${esc(baby.name)}?`;
  text.textContent      = "You're the only device with access. All tracking data will be permanently deleted from the cloud and from this device.";
  permBtn.textContent   = 'Delete permanently';
  permBtn.disabled      = false;
  permBtn.classList.remove('hidden');
  removeBtn.textContent = 'Remove from my device only';
  removeBtn.classList.remove('hidden');
}

async function executeRemoveFromDevice() {
  const token = _deleteBabyToken;
  if (!token) return;
  _deleteBabyToken = null;
  closeModal('modal-delete-baby');
  // Tell the cloud we left — safe no-op in local-only mode.
  // Fire-and-forget: don't block UI if offline (write queues automatically).
  leaveBabyAsMember(token);
  removeBabyLocally(token);
  await afterBabyDeleted(token);
  showToast('Removed from this device');
}

async function executeDeletePermanently() {
  const token = _deleteBabyToken;
  if (!token) return;
  _deleteBabyToken = null;
  closeModal('modal-delete-baby');
  // Firestore writes queue via offline persistence — safe to call while offline.
  await deleteBabyPermanently(token);
  await afterBabyDeleted(token);
  showToast('Baby deleted');
}

async function afterBabyDeleted(deletedToken) {
  // If we deleted the active baby, switch to another or go to setup
  if (ST.token === deletedToken) {
    unsubscribeDayData();
    ST.token = null;
    ST.baby  = null;
    const remaining = getKnownTokens();
    if (remaining.length) {
      await switchBaby(remaining[0]);
    } else {
      openSetupScreen('new');
    }
  } else {
    // Refresh picker if it was open, or just re-render main if visible
    renderDaysList(ST.token, ST.baby);
  }
}

/* ════════════════════════════════════════
   BABY PICKER
   ════════════════════════════════════════ */
function openBabyPicker() {
  renderBabyPicker();
  openModal('modal-baby-picker');
}

async function switchBaby(token) {
  setActiveToken(token);
  ST.token = token;
  ST.baby  = getCachedBaby(token) || await fetchBabyInfo(token);
  if (!ST.baby) { showToast('Baby not found'); return; }
  unsubscribeDayData();
  updateUrl(token);
  await showMainScreen();
}

/* ════════════════════════════════════════
   SHARE MODAL
   ════════════════════════════════════════ */
function openShareModal() {
  if (!ST.baby) return;
  document.getElementById('share-baby-name').textContent = ST.baby.name;

  const noFb    = document.getElementById('share-no-firebase');
  const linkRow = document.getElementById('share-link-row');

  if (!USE_FIREBASE) {
    noFb.classList.remove('hidden');
    linkRow.classList.add('hidden');
  } else {
    noFb.classList.add('hidden');
    linkRow.classList.remove('hidden');
    document.getElementById('share-link-text').textContent = getShareUrl(ST.token);
  }
  openModal('modal-share');
}

async function copyShareLink() {
  const link = getShareUrl(ST.token);
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const inp = document.createElement('input');
    inp.value = link;
    document.body.appendChild(inp);
    inp.select();
    document.execCommand('copy');
    document.body.removeChild(inp);
  }
  // Mark baby as shared so deletion won't wipe Firestore for other users
  await markBabyAsShared(ST.token);
  ST.baby = getCachedBaby(ST.token);
  showToast('Link copied!');
}

/* ════════════════════════════════════════
   JOIN MODAL
   ════════════════════════════════════════ */
let _joinToken = null;

function openJoinModal() {
  closeModal('modal-baby-picker');
  document.getElementById('join-input').value = '';
  document.getElementById('join-form-view').classList.remove('hidden');
  document.getElementById('join-confirm-view').classList.add('hidden');
  _joinToken = null;
  openModal('modal-join');
}

async function handleJoinLookup() {
  if (!USE_FIREBASE) {
    showToast('Firebase not configured — sharing unavailable.');
    return;
  }
  const raw   = document.getElementById('join-input').value;
  const token = extractToken(raw);
  if (!token) { showToast('Enter a valid link or token.'); return; }

  const btn = document.getElementById('btn-join-lookup');
  btn.disabled    = true;
  btn.textContent = 'Looking up…';

  try {
    const info = await fetchBabyInfo(token);
    if (!info) { showToast('Tracker not found. Check the link.'); return; }

    _joinToken = token;
    document.getElementById('join-found-name').textContent = info.name;
    document.getElementById('join-found-born').textContent =
      `Born ${new Date(info.birthDateTime).toLocaleString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      })}`;
    document.getElementById('join-form-view').classList.add('hidden');
    document.getElementById('join-confirm-view').classList.remove('hidden');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Find Tracker';
  }
}

async function handleJoinConfirm() {
  if (!_joinToken) return;
  const info = await fetchBabyInfo(_joinToken);
  if (!info) { showToast('Baby not found.'); return; }

  addKnownToken(_joinToken);
  setCachedBaby(_joinToken, info);
  setActiveToken(_joinToken);
  ST.token   = _joinToken;
  ST.baby    = info;
  // Register this device as a member so the delete flow can detect
  // that others still have access.
  joinBabyAsMember(_joinToken);
  _joinToken = null;

  closeModal('modal-join');
  updateUrl(ST.token);
  await showMainScreen();
  showToast(`Joined ${info.name}'s tracker!`);
}

/* ════════════════════════════════════════
   EVENT BINDING
   ════════════════════════════════════════ */
function bindEvents() {
  // Setup
  document.getElementById('setup-form').addEventListener('submit', handleSetupSubmit);
  document.getElementById('setup-back-btn').addEventListener('click', openBabyPicker);

  // Main header
  document.getElementById('btn-switch-baby').addEventListener('click', openBabyPicker);
  document.getElementById('btn-share').addEventListener('click', openShareModal);
  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);

  // Day detail: back
  document.getElementById('btn-back').addEventListener('click', () => {
    unsubscribeDayData();
    showMainScreen();
  });

  // Diapers
  document.getElementById('wet-plus').addEventListener('click',    () => changeDiaper('wet',   +1));
  document.getElementById('wet-minus').addEventListener('click',   () => changeDiaper('wet',   -1));
  document.getElementById('dirty-plus').addEventListener('click',  () => changeDiaper('dirty', +1));
  document.getElementById('dirty-minus').addEventListener('click', () => changeDiaper('dirty', -1));

  // Feedings
  document.getElementById('btn-add-feeding').addEventListener('click', openAddFeedingModal);
  document.getElementById('feeding-form').addEventListener('submit', handleFeedingSubmit);
  document.getElementById('btn-close-feeding').addEventListener('click',  () => closeModal('modal-feeding'));
  document.getElementById('btn-cancel-feeding').addEventListener('click', () => closeModal('modal-feeding'));

  // Delete confirm
  document.getElementById('btn-confirm-delete').addEventListener('click', executeDeleteFeeding);
  document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    ST.pendingDelId = null;
    closeModal('modal-confirm');
  });

  // Settings
  document.getElementById('settings-form').addEventListener('submit', handleSettingsSubmit);
  document.getElementById('btn-close-settings').addEventListener('click',  () => closeModal('modal-settings'));
  document.getElementById('btn-cancel-settings').addEventListener('click', () => closeModal('modal-settings'));

  // Baby picker
  document.getElementById('btn-close-baby-picker').addEventListener('click', () => closeModal('modal-baby-picker'));
  document.getElementById('btn-picker-add').addEventListener('click', () => {
    closeModal('modal-baby-picker');
    openSetupScreen('add');
  });
  document.getElementById('btn-picker-join').addEventListener('click', openJoinModal);

  // Delete baby — from settings modal
  document.getElementById('btn-delete-current-baby').addEventListener('click', () => {
    closeModal('modal-settings');
    promptDeleteBaby(ST.token);
  });
  // Delete baby confirm modal
  document.getElementById('btn-cancel-delete-baby').addEventListener('click', () => {
    _deleteBabyToken = null;
    closeModal('modal-delete-baby');
  });
  document.getElementById('btn-remove-device-baby').addEventListener('click', executeRemoveFromDevice);
  document.getElementById('btn-delete-baby-perm').addEventListener('click', executeDeletePermanently);

  // Share
  document.getElementById('btn-close-share').addEventListener('click', () => closeModal('modal-share'));
  document.getElementById('btn-copy-link').addEventListener('click', copyShareLink);

  // Join
  document.getElementById('btn-close-join').addEventListener('click',   () => closeModal('modal-join'));
  document.getElementById('btn-cancel-join').addEventListener('click',  () => closeModal('modal-join'));
  document.getElementById('btn-join-lookup').addEventListener('click',  handleJoinLookup);
  document.getElementById('btn-join-back').addEventListener('click', () => {
    document.getElementById('join-form-view').classList.remove('hidden');
    document.getElementById('join-confirm-view').classList.add('hidden');
  });
  document.getElementById('btn-join-confirm').addEventListener('click', handleJoinConfirm);

  // Close modals by clicking the overlay backdrop
  ['modal-settings', 'modal-feeding', 'modal-confirm',
   'modal-baby-picker', 'modal-share', 'modal-join', 'modal-delete-baby'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal(id);
    });
  });

  // Escape key closes topmost open modal
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const modals = ['modal-feeding', 'modal-settings', 'modal-confirm',
                    'modal-baby-picker', 'modal-share', 'modal-join', 'modal-delete-baby'];
    for (const id of modals) {
      if (!document.getElementById(id).classList.contains('hidden')) {
        if (id === 'modal-confirm') ST.pendingDelId = null;
        closeModal(id);
        break;
      }
    }
  });
}

/* ════════════════════════════════════════
   BOOT
   ════════════════════════════════════════ */
async function boot() {
  initFirebase();
  bindEvents();
  // Subscribe the header chip to the cloud state machine in db.js.
  // Fires immediately with the current state.
  onCloudStateChange(renderCloudIndicator);
  // navigator.onLine transitions — re-render so the chip flips to red
  // as soon as the device drops connectivity, without waiting for the probe.
  window.addEventListener('online',  () => renderCloudIndicator(getCloudState()));
  window.addEventListener('offline', () => renderCloudIndicator(getCloudState()));
  await migrateV1();

  const params    = new URLSearchParams(window.location.search);
  const joinParam = params.get('join');
  const bParam    = params.get('b');

  // Handle incoming share link (?b=token or ?join=token)
  if (joinParam || bParam) {
    const token = joinParam || bParam;
    clearUrlParams();
    const info = await fetchBabyInfo(token);
    if (info) {
      const isNew = !getKnownTokens().includes(token); // check BEFORE addKnownToken
      addKnownToken(token);
      setCachedBaby(token, info);
      setActiveToken(token);
      ST.token = token;
      ST.baby  = info;
      // Register this device as a member (idempotent).
      joinBabyAsMember(token);
      updateUrl(token);
      await showMainScreen();
      if (isNew) showToast(`Joined ${info.name}'s tracker!`);
      return;
    }
    showToast('Link not found — start a new tracker below.');
  }

  // Load last active baby
  const activeToken = getActiveToken();
  if (activeToken) {
    const info = await fetchBabyInfo(activeToken);
    if (info) {
      ST.token = activeToken;
      ST.baby  = info;
      updateUrl(activeToken);
      await showMainScreen();
      return;
    }
  }

  // Try first known baby
  const known = getKnownTokens();
  if (known.length) {
    const info = await fetchBabyInfo(known[0]);
    if (info) {
      ST.token = known[0];
      ST.baby  = info;
      setActiveToken(known[0]);
      updateUrl(known[0]);
      await showMainScreen();
      return;
    }
  }

  openSetupScreen('new');
}

document.addEventListener('DOMContentLoaded', boot);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('sw.js').catch(console.warn)
  );
}
