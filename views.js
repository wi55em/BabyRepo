'use strict';

/* ════════════════════════════════════════
   DAYS LIST
   ════════════════════════════════════════ */
function renderDaysList(token, baby) {
  const currentDay = getCurrentDayNumber(baby.birthDateTime);
  const allDays    = getAllCachedDays()[token] || {};
  const list       = document.getElementById('days-list');
  list.innerHTML   = '';

  for (let d = currentDay; d >= 1; d--) {
    const data = Object.assign(
      { wetDiapers: 0, dirtyDiapers: 0, feedings: [] },
      allDays[String(d)] || {}
    );
    list.appendChild(buildDayCard(baby, d, data, d === currentDay));
  }
}

function buildDayCard(baby, dayNum, data, isToday) {
  const feeds = (data.feedings || []).length;
  const el    = document.createElement('div');
  el.className = `day-card${isToday ? ' today' : ''}`;
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `Day ${dayNum}, ${formatDayRange(baby.birthDateTime, dayNum)}`);

  el.innerHTML = `
    <div class="day-card-top">
      <div class="day-card-label">
        <div class="day-number">
          Day ${dayNum}${isToday ? ' <span class="today-pill">Today</span>' : ''}
        </div>
        <div class="day-date">${formatDayRange(baby.birthDateTime, dayNum)}</div>
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
          <div class="day-stat-count">${feeds}</div>
          <div class="day-stat-label">Feeds</div>
        </div>
      </div>
    </div>`;

  const open = () => openDayDetail(dayNum);
  el.addEventListener('click', open);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  return el;
}

/* ════════════════════════════════════════
   DAY DETAIL — APPLY DATA
   ════════════════════════════════════════ */
function applyDayData(data) {
  document.getElementById('wet-count').textContent   = data.wetDiapers;
  document.getElementById('dirty-count').textContent = data.dirtyDiapers;
  renderFeedingsList(data.feedings || []);
}

/* ════════════════════════════════════════
   FEEDINGS LIST
   ════════════════════════════════════════ */
function renderFeedingsList(feedings) {
  const container = document.getElementById('feedings-list');
  container.innerHTML = '';

  if (!feedings.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-emoji">🤱</div>
        <p class="empty-state-title">No sessions yet</p>
        <p class="empty-state-hint">Tap "Add Session" to log a feeding</p>
      </div>`;
    return;
  }

  // ST and feedingSortKey come from app.js / utils.js — available at call time
  const sorted = [...feedings].sort((a, b) =>
    feedingSortKey(ST.baby.birthDateTime, a.time) -
    feedingSortKey(ST.baby.birthDateTime, b.time)
  );

  sorted.forEach((f, idx) => {
    const item = document.createElement('div');
    item.className = 'feeding-item';
    item.style.animationDelay = `${idx * 35}ms`;
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
          : `<p class="feeding-no-note">No note</p>`}
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
      </div>`;

    item.querySelector('[data-action="edit"]')
        .addEventListener('click', () => openEditFeedingModal(f.id));
    item.querySelector('[data-action="delete"]')
        .addEventListener('click', () => promptDeleteFeeding(f.id));
    container.appendChild(item);
  });
}

/* ════════════════════════════════════════
   BABY PICKER LIST
   ════════════════════════════════════════ */
function renderBabyPicker() {
  const list   = document.getElementById('picker-list');
  const tokens = getKnownTokens();
  const babies = getCachedBabies();
  list.innerHTML = '';

  if (!tokens.length) {
    list.innerHTML = '<p class="picker-empty">No babies added yet.</p>';
    return;
  }

  tokens.forEach(tok => {
    const baby = babies[tok];
    if (!baby) return;
    const isActive = tok === ST.token;

    // Use a <div> (not <button>) as the outer element — the inner delete
    // <button> would otherwise be invalid HTML (nested interactive), which
    // browsers silently drop, making the delete icon unclickable.
    const row = document.createElement('div');
    row.className = `picker-item${isActive ? ' active' : ''}`;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `Switch to ${baby.name}`);
    row.innerHTML = `
      <div class="picker-item-avatar">
        ${isActive
          ? `<span class="picker-item-check">✓</span>`
          : `<span>👶</span>`}
      </div>
      <div class="picker-item-info">
        <div class="picker-item-name">${esc(baby.name)}</div>
        <div class="picker-item-sub">
          Day ${getCurrentDayNumber(baby.birthDateTime)} ·
          Born ${new Date(baby.birthDateTime).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          })}
        </div>
      </div>
      <button type="button" class="picker-item-delete" data-tok="${tok}"
              aria-label="Delete ${esc(baby.name)}" title="Delete baby">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3,6 5,6 21,6"/>
          <path d="M19,6l-1,14H6L5,6"/>
          <path d="M10,11v6"/><path d="M14,11v6"/>
          <path d="M9,6V4h6v2"/>
        </svg>
      </button>`;

    const activate = () => { closeModal('modal-baby-picker'); switchBaby(tok); };
    row.addEventListener('click', e => {
      if (e.target.closest('.picker-item-delete')) return;
      activate();
    });
    row.addEventListener('keydown', e => {
      if (e.target.closest('.picker-item-delete')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    row.querySelector('.picker-item-delete').addEventListener('click', e => {
      e.stopPropagation();
      promptDeleteBaby(tok);
    });
    list.appendChild(row);
  });
}
