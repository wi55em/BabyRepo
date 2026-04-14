'use strict';

/* ════════════════════════════════════════
   CLOUD STATE MACHINE
   States: 'hidden' | 'pending' | 'connected' | 'offline' | 'error'
   App-level listeners subscribe via onCloudStateChange().
   ════════════════════════════════════════ */
let CLOUD_STATE = 'hidden';
const _cloudListeners = [];

function onCloudStateChange(fn) {
  _cloudListeners.push(fn);
  fn(CLOUD_STATE); // fire immediately with current state
}

function setCloudState(state) {
  if (CLOUD_STATE === state) return;
  CLOUD_STATE = state;
  _cloudListeners.forEach(fn => { try { fn(state); } catch {} });
}

function getCloudState() { return CLOUD_STATE; }

/* ════════════════════════════════════════
   DEVICE ID (stable per browser/device)
   Used to track unique members of a shared baby.
   ════════════════════════════════════════ */
const DEVICE_ID_KEY = 'bt-device-id';
function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    id = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/* ════════════════════════════════════════
   FIREBASE INITIALISATION
   ════════════════════════════════════════ */
let USE_FIREBASE = false;
let db = null;
let _probeUnsub = null;

function initFirebase() {
  const cfg = window.FIREBASE_CONFIG;

  // C1: no config → stay local-only, hide the indicator
  if (!cfg || !cfg.projectId || cfg.projectId === '') {
    console.info('[Firebase] No config — running in local-only mode.');
    setCloudState('hidden');
    return;
  }

  // C5: SDK failed to load → surface an error
  if (typeof firebase === 'undefined') {
    console.error('[Firebase] SDK not loaded (check network / script order).');
    setCloudState('error');
    return;
  }

  try {
    // C2: starting up
    setCloudState('pending');

    if (!firebase.apps.length) {
      firebase.initializeApp(cfg);
    }
    db = firebase.firestore();

    db.enablePersistence({ synchronizeTabs: true }).catch(err => {
      // Persistence may fail in private-browsing or multi-tab edge cases; not fatal.
      console.warn('[Firebase] Offline persistence unavailable:', err.code || err);
    });

    USE_FIREBASE = true;
    console.info('[Firebase] Initialised (project:', cfg.projectId + ')');

    startConnectivityProbe();

    // Browser connectivity changes — flip to offline immediately, let the probe
    // flip us back to connected once the server responds.
    window.addEventListener('online',  () => setCloudState('pending'));
    window.addEventListener('offline', () => setCloudState('offline'));
  } catch (e) {
    console.error('[Firebase] Init failed:', e);
    USE_FIREBASE = false;
    setCloudState('error');
  }
}

/**
 * Live connectivity probe — subscribes to a fixed doc with metadata changes.
 * Firestore reports fromCache=false the moment the server confirms the read,
 * regardless of whether the doc exists. That's our signal for "connected".
 */
function startConnectivityProbe() {
  if (_probeUnsub) { _probeUnsub(); _probeUnsub = null; }
  try {
    _probeUnsub = db.collection('babies').doc('__probe__').onSnapshot(
      { includeMetadataChanges: true },
      snap => {
        if (!navigator.onLine)            setCloudState('offline');
        else if (snap.metadata.fromCache) setCloudState('pending');
        else                              setCloudState('connected');
      },
      err => {
        console.warn('[Firebase] Probe error:', err.code || err);
        setCloudState('error');
      }
    );
  } catch (e) {
    console.warn('[Firebase] Could not start probe:', e);
    setCloudState('error');
  }
}

/* ════════════════════════════════════════
   LOCAL STORAGE
   ════════════════════════════════════════ */
const LS = {
  KNOWN:  'bt-known',
  ACTIVE: 'bt-active',
  BABIES: 'bt-babies',
  DAYS:   'bt-days',
};

function lsGet(key)      { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function getKnownTokens()    { return lsGet(LS.KNOWN)  || []; }
function getActiveToken()    { return lsGet(LS.ACTIVE) || null; }
function setActiveToken(tok) { lsSet(LS.ACTIVE, tok); }

function addKnownToken(tok) {
  const list = getKnownTokens();
  if (!list.includes(tok)) { list.unshift(tok); lsSet(LS.KNOWN, list); }
}

function getCachedBabies()         { return lsGet(LS.BABIES) || {}; }
function getCachedBaby(tok)        { return getCachedBabies()[tok] || null; }
function setCachedBaby(tok, info)  { const m = getCachedBabies(); m[tok] = info; lsSet(LS.BABIES, m); }

function getAllCachedDays()                { return lsGet(LS.DAYS) || {}; }
function getCachedDayData(tok, dayNum)    {
  const all = getAllCachedDays();
  return Object.assign({ wetDiapers: 0, dirtyDiapers: 0, feedings: [] },
                       (all[tok] || {})[String(dayNum)] || {});
}
function setCachedDayData(tok, dayNum, d) {
  const all = getAllCachedDays();
  if (!all[tok]) all[tok] = {};
  all[tok][String(dayNum)] = d;
  lsSet(LS.DAYS, all);
}

/* ════════════════════════════════════════
   DATA LAYER — BABIES
   ════════════════════════════════════════ */
async function createBaby(name, birthDateTime) {
  const token    = generateToken();
  const deviceId = getOrCreateDeviceId();
  const info     = {
    name, birthDateTime, token,
    createdAt: new Date().toISOString(),
    members:   [deviceId],
  };
  if (USE_FIREBASE) {
    try { await db.collection('babies').doc(token).set(info); }
    catch (e) { console.warn('createBaby: Firestore write queued offline', e); }
  }
  setCachedBaby(token, info);
  addKnownToken(token);
  return token;
}

async function fetchBabyInfo(token) {
  if (USE_FIREBASE) {
    try {
      const snap = await db.collection('babies').doc(token).get();
      if (!snap.exists) return null;
      const info = snap.data();
      setCachedBaby(token, info);
      return info;
    } catch { /* fall through to cache */ }
  }
  return getCachedBaby(token);
}

async function updateBabyInfo(token, fields) {
  const info = Object.assign({}, getCachedBaby(token), fields);
  setCachedBaby(token, info);
  if (USE_FIREBASE) {
    try {
      // Use set+merge so it works even if the doc doesn't exist in Firestore yet
      await db.collection('babies').doc(token).set(fields, { merge: true });
    } catch (e) { console.warn('updateBabyInfo failed:', e); }
  }
  return info;
}

/** Called when the share link is first copied — marks baby as shared in Firestore. */
async function markBabyAsShared(token) {
  const baby = getCachedBaby(token);
  if (baby && baby.shared) return; // already marked
  await updateBabyInfo(token, { shared: true });
}

/* ════════════════════════════════════════
   MEMBERSHIP — who has access to a baby
   ════════════════════════════════════════ */

/** Add this device to the baby's members array (idempotent via arrayUnion). */
async function joinBabyAsMember(token) {
  if (!USE_FIREBASE) return;
  const deviceId = getOrCreateDeviceId();
  try {
    await db.collection('babies').doc(token).set(
      { members: firebase.firestore.FieldValue.arrayUnion(deviceId) },
      { merge: true }
    );
  } catch (e) {
    console.warn('joinBabyAsMember failed:', e);
  }
}

/** Remove this device from the baby's members array. */
async function leaveBabyAsMember(token) {
  if (!USE_FIREBASE) return;
  const deviceId = getOrCreateDeviceId();
  try {
    await db.collection('babies').doc(token).set(
      { members: firebase.firestore.FieldValue.arrayRemove(deviceId) },
      { merge: true }
    );
  } catch (e) {
    console.warn('leaveBabyAsMember failed:', e);
  }
}

/**
 * Server-authoritative member count.
 * Returns:
 *   number — number of devices with access
 *   null   — Firestore unreachable (offline / error) OR local-only mode
 *
 * For legacy docs with no `members` field, falls back to the `shared` flag:
 *   shared=true  → 2 (others have it)
 *   shared=false → 1 (only me)
 */
async function getBabyMemberCount(token) {
  if (!USE_FIREBASE) return null;
  try {
    const snap = await db.collection('babies').doc(token).get({ source: 'server' });
    if (!snap.exists) return 0;
    const data = snap.data();
    if (Array.isArray(data.members)) return data.members.length;
    return data.shared ? 2 : 1;
  } catch (e) {
    console.warn('getBabyMemberCount: cannot reach Firestore', e.code || e);
    return null;
  }
}

/* ════════════════════════════════════════
   DELETE / REMOVE
   ════════════════════════════════════════ */

/** Remove baby from this device only (localStorage). Firestore data is preserved. */
function removeBabyLocally(token) {
  const known = getKnownTokens().filter(t => t !== token);
  lsSet(LS.KNOWN, known);
  const babies = getCachedBabies();
  delete babies[token];
  lsSet(LS.BABIES, babies);
  const days = getAllCachedDays();
  delete days[token];
  lsSet(LS.DAYS, days);
  if (getActiveToken() === token) localStorage.removeItem(LS.ACTIVE);
}

/**
 * Permanently delete a baby from Firestore (all days subcollection + baby doc)
 * and from local storage. Firestore writes queue offline and flush on reconnect.
 */
async function deleteBabyPermanently(token) {
  removeBabyLocally(token);
  if (!USE_FIREBASE) return;

  // Delete all day documents first (Firestore doesn't cascade-delete subcollections).
  try {
    const daysSnap = await db.collection('babies').doc(token).collection('days').get();
    if (!daysSnap.empty) {
      const batch = db.batch();
      daysSnap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn('deleteBabyPermanently: days deletion deferred', e.code || e);
  }
  try {
    await db.collection('babies').doc(token).delete();
  } catch (e) {
    console.warn('deleteBabyPermanently: doc deletion deferred', e.code || e);
  }
}

/* ════════════════════════════════════════
   DATA LAYER — DAYS
   ════════════════════════════════════════ */
async function readDayData(token, dayNum) {
  if (USE_FIREBASE) {
    try {
      const snap = await db.collection('babies').doc(token)
        .collection('days').doc(String(dayNum)).get();
      const data = snap.exists
        ? { wetDiapers: 0, dirtyDiapers: 0, feedings: [], ...snap.data() }
        : { wetDiapers: 0, dirtyDiapers: 0, feedings: [] };
      setCachedDayData(token, dayNum, data);
      return data;
    } catch { /* fall through */ }
  }
  return getCachedDayData(token, dayNum);
}

async function writeDayData(token, dayNum, data) {
  setCachedDayData(token, dayNum, data);
  if (USE_FIREBASE) {
    try {
      await db.collection('babies').doc(token)
        .collection('days').doc(String(dayNum)).set(data);
    } catch (e) { console.warn('Write queued offline:', e); }
  }
}

let _dayUnsub = null;

function subscribeDayData(token, dayNum, callback) {
  unsubscribeDayData();
  if (!USE_FIREBASE) return;
  _dayUnsub = db.collection('babies').doc(token)
    .collection('days').doc(String(dayNum))
    .onSnapshot(snap => {
      const data = snap.exists
        ? { wetDiapers: 0, dirtyDiapers: 0, feedings: [], ...snap.data() }
        : { wetDiapers: 0, dirtyDiapers: 0, feedings: [] };
      setCachedDayData(token, dayNum, data);
      callback(data);
    }, e => console.warn('Listener error:', e));
}

function unsubscribeDayData() {
  if (_dayUnsub) { _dayUnsub(); _dayUnsub = null; }
}

/* ════════════════════════════════════════
   V1 DATA MIGRATION
   ════════════════════════════════════════ */
async function migrateV1() {
  const oldBaby = lsGet('bt-baby');
  if (!oldBaby) return;
  const token   = await createBaby(oldBaby.name, oldBaby.birthDateTime);
  const oldDays = lsGet('bt-days') || {};
  for (const [dayNum, data] of Object.entries(oldDays)) {
    await writeDayData(token, dayNum, data);
  }
  setActiveToken(token);
  localStorage.removeItem('bt-baby');
  localStorage.removeItem('bt-days');
}
