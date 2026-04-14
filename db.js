'use strict';

/* ════════════════════════════════════════
   FIREBASE INITIALISATION
   ════════════════════════════════════════ */
let USE_FIREBASE = false;
let db = null;

function initFirebase() {
  try {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.projectId || cfg.projectId === '') return;
    if (typeof firebase === 'undefined') return;
    firebase.initializeApp(cfg);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    USE_FIREBASE = true;
  } catch (e) {
    console.warn('Firebase init failed:', e);
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
  const token = generateToken();
  const info  = { name, birthDateTime, token, createdAt: new Date().toISOString() };
  if (USE_FIREBASE) await db.collection('babies').doc(token).set(info);
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
 * and from local storage. Only call this when baby.shared is falsy.
 */
async function deleteBabyPermanently(token) {
  removeBabyLocally(token);
  if (!USE_FIREBASE) return;
  try {
    // Delete all day documents first (Firestore doesn't cascade-delete subcollections)
    const daysSnap = await db.collection('babies').doc(token).collection('days').get();
    if (!daysSnap.empty) {
      const batch = db.batch();
      daysSnap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    await db.collection('babies').doc(token).delete();
  } catch (e) {
    console.warn('Firestore delete failed:', e);
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
