const appEl = document.getElementById('app');
const cardContainer = document.getElementById('card-container');
const searchInput = document.getElementById('contact-search');
const listEl = document.getElementById('contact-list');
const detailEl = document.getElementById('detail-pane');

const ROSTER_POLL_MS = 5000;
const AVATAR_COLORS = ['#1d7874', '#c65102', '#5b3a9e', '#0f6e94', '#a8325e', '#2f7a3f', '#8a5a00', '#3f51b5'];

const state = { contacts: [], roster: [], selectedId: null };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Read at runtime from localStorage (populated by index.html's inline bootstrap script) — safe to serve this file unauthenticated since its source never contains the token itself.
function getToken() {
  try {
    return localStorage.getItem('controlToken');
  } catch {
    return null;
  }
}

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { 'X-Control-Token': token, ...extra } : extra;
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, { ...options, headers: authHeaders(options.headers) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

function showCard({ title, description, actionLabel, onAction }) {
  cardContainer.innerHTML = `
    <div class="card card--error">
      <p class="card__title">${escapeHtml(title)}</p>
      <p class="card__desc">${escapeHtml(description)}</p>
      ${actionLabel ? `<button class="card__action" id="card-action">${escapeHtml(actionLabel)}</button>` : ''}
    </div>
  `;
  if (actionLabel && onAction) {
    document.getElementById('card-action').addEventListener('click', () => {
      hideCard();
      onAction();
    });
  }
}

function hideCard() {
  cardContainer.innerHTML = '';
}

// A small fixed palette rather than a full HSL wheel, so colors stay
// legible against both light and dark surfaces without per-theme tuning.
function colorFor(contactId) {
  let hash = 0;
  for (let i = 0; i < contactId.length; i++) hash = (hash * 31 + contactId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initialsFor(name) {
  if (name.startsWith('+')) return name.slice(1, 3);
  const words = name.trim().split(/\s+/);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

// Its own function so a later real-photo feature only has to swap this
// one function's internals (render an <img> when a photo URL exists)
// without touching row/panel markup or CSS elsewhere.
function renderAvatar(contact) {
  return `<span class="avatar" style="background:${colorFor(contact.id)}">${escapeHtml(initialsFor(contact.name))}</span>`;
}

const RELATIVE_UNITS = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

function relativeTime(ms) {
  if (!ms) return 'Never contacted';
  const diff = Date.now() - ms;
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    const count = Math.floor(diff / unitMs);
    if (count >= 1) return `Last contacted ${count} ${unit}${count > 1 ? 's' : ''} ago`;
  }
  return 'Last contacted just now';
}

function digitsOnly(value) {
  return value.replace(/\D/g, '');
}

function matchesQuery(contact, query) {
  if (!query) return true;
  if (contact.name.toLowerCase().includes(query)) return true;
  const digits = digitsOnly(query);
  return digits.length > 0 && contact.id.split('@')[0].includes(digits);
}

function rosterEntryFor(contactId) {
  return state.roster.find((r) => r.id === contactId);
}

function sortedFilteredContacts() {
  const query = searchInput.value.trim().toLowerCase();
  return state.contacts
    .filter((c) => matchesQuery(c, query))
    .slice()
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.name.localeCompare(b.name));
}

function contactRowTemplate(contact) {
  const monitored = Boolean(rosterEntryFor(contact.id));
  return `
    <li class="contact-row${contact.id === state.selectedId ? ' contact-row--selected' : ''}" data-contact-id="${escapeHtml(contact.id)}">
      ${renderAvatar(contact)}
      <span class="contact-row__text">
        <span class="contact-row__name">${escapeHtml(contact.name)}</span>
        <span class="contact-row__subtitle">${escapeHtml(relativeTime(contact.lastMessageAt))}</span>
      </span>
      <input type="checkbox" role="switch" class="switch" data-action="monitor-toggle" ${monitored ? 'checked' : ''} aria-label="Moderate ${escapeHtml(contact.name)}" />
    </li>
  `;
}

function renderList() {
  const contacts = sortedFilteredContacts();
  listEl.innerHTML = contacts.length
    ? contacts.map(contactRowTemplate).join('')
    : '<li class="empty-state">No contacts match your search.</li>';
}

function panelHeaderTemplate(contact, monitored) {
  return `
    <div class="detail-pane__header">
      <button class="detail-pane__back" data-action="close-panel" aria-label="Back to contact list">←</button>
      ${renderAvatar(contact)}
      <span class="contact-row__name">${escapeHtml(contact.name)}</span>
    </div>
    <div class="row">
      <input type="checkbox" role="switch" class="switch" data-action="monitor-toggle" ${monitored ? 'checked' : ''} />
      <label>Moderate this contact</label>
    </div>
  `;
}

// Always renders the full control set, monitored or not — dimmed and
// disabled rather than hidden when moderation is off, so the panel never
// looks broken/empty, and flipping the switch just re-enables in place
// rather than replacing the whole panel's markup.
//
// Wrapped in .detail-pane__inner, which CSS gives a fixed viewport-relative
// width — decoupled from .detail-pane's own width, which is what actually
// animates open/closed. Without that split, this content would reflow live
// while its container was still mid-animation (narrow), which is what read
// as text "resizing"/jumping during the slide-in; with it, the animation is
// a pure reveal (.detail-pane's overflow:hidden clips fully-laid-out
// content) instead of a live reflow.
function panelTemplate(contact) {
  const entry = rosterEntryFor(contact.id);
  const monitored = Boolean(entry);
  const disabledAttr = monitored ? '' : 'disabled';

  return `
    <div class="detail-pane__inner">
      ${panelHeaderTemplate(contact, monitored)}
      ${monitored ? '' : '<p class="page__subtext">Turn on moderation above to start tracking strikes and enable auto-blocking for this contact.</p>'}
      <dl class="status">
        <dt>Strikes</dt><dd>${entry?.strikeCount ?? 0}</dd>
        <dt>Block</dt><dd>${entry?.block ? `until ${new Date(entry.block.unblockAt).toLocaleString()}` : 'not blocked'}</dd>
      </dl>
      <div class="row">
        <input type="checkbox" role="switch" class="switch" data-action="pause-toggle" ${entry?.paused ? 'checked' : ''} ${disabledAttr} />
        <label>Paused</label>
      </div>
      <div class="row">
        <input type="checkbox" role="switch" class="switch" data-action="escalation-toggle" ${entry?.escalationEnabled ?? true ? 'checked' : ''} ${disabledAttr} />
        <label>Escalation (auto-block)</label>
      </div>
      <div class="actions">
        <button data-action="unblock" ${disabledAttr}>Unblock now</button>
      </div>
      <p class="inline-message" data-role="message"></p>
    </div>
  `;
}

function renderPanel() {
  appEl.classList.toggle('panel-open', Boolean(state.selectedId));
  if (!state.selectedId) {
    detailEl.innerHTML = '';
    return;
  }
  const contact = state.contacts.find((c) => c.id === state.selectedId);
  if (!contact) {
    state.selectedId = null;
    appEl.classList.remove('panel-open');
    detailEl.innerHTML = '';
    return;
  }
  detailEl.innerHTML = panelTemplate(contact);
}

function render() {
  renderList();
  renderPanel();
}

async function refreshRoster() {
  try {
    state.roster = await apiFetch('/api/roster');
    render();
    hideCard();
  } catch (err) {
    showCard({ title: "Couldn't reach the server", description: err.message, actionLabel: 'Retry', onAction: refreshRoster });
  }
}

async function refreshContacts() {
  try {
    state.contacts = await apiFetch('/api/contacts');
    render();
  } catch (err) {
    showCard({ title: 'Could not load contacts', description: err.message, actionLabel: 'Retry', onAction: refreshContacts });
  }
}

async function setMonitored(contactId, monitored) {
  try {
    if (monitored) {
      await apiFetch('/api/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      });
    } else {
      await apiFetch(`/api/roster/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
    }
    await Promise.all([refreshRoster(), refreshContacts()]);
  } catch (err) {
    render(); // revert a switch the browser already flipped optimistically before this request failed
    showCard({ title: 'Could not update moderation', description: err.message, actionLabel: 'Retry', onAction: () => setMonitored(contactId, monitored) });
  }
}

async function runCommand(contactId, action) {
  try {
    const result = await apiFetch(`/api/roster/${encodeURIComponent(contactId)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    await refreshRoster();
    const messageEl = detailEl.querySelector('[data-role="message"]');
    if (messageEl) messageEl.textContent = result.message ?? '';
  } catch (err) {
    renderPanel(); // revert a switch the browser already flipped optimistically before this request failed
    showCard({ title: 'Command failed', description: err.message, actionLabel: 'Retry', onAction: () => runCommand(contactId, action) });
  }
}

async function setEscalation(contactId, enabled) {
  try {
    await apiFetch(`/api/roster/${encodeURIComponent(contactId)}/escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    await refreshRoster();
  } catch (err) {
    renderPanel(); // revert a switch the browser already flipped optimistically before this request failed
    showCard({
      title: 'Could not update escalation',
      description: err.message,
      actionLabel: 'Retry',
      onAction: () => setEscalation(contactId, enabled),
    });
  }
}

searchInput.addEventListener('input', renderList);

listEl.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="monitor-toggle"]')) return;
  const row = event.target.closest('[data-contact-id]');
  if (!row) return;
  state.selectedId = row.dataset.contactId;
  render();
});

listEl.addEventListener('change', async (event) => {
  const input = event.target.closest('[data-action="monitor-toggle"]');
  if (!input) return;
  const contactId = input.closest('[data-contact-id]').dataset.contactId;
  input.disabled = true;
  try {
    await setMonitored(contactId, input.checked);
  } finally {
    input.disabled = false;
  }
});

detailEl.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (button?.dataset.action === 'close-panel') {
    state.selectedId = null;
    render();
    return;
  }
  if (button?.dataset.action === 'unblock') {
    button.disabled = true;
    try {
      await runCommand(state.selectedId, 'unblock');
    } finally {
      button.disabled = false;
    }
  }
});

detailEl.addEventListener('change', async (event) => {
  const input = event.target.closest('[data-action]');
  if (!input) return;
  const contactId = state.selectedId;
  input.disabled = true;
  try {
    if (input.dataset.action === 'monitor-toggle') await setMonitored(contactId, input.checked);
    if (input.dataset.action === 'pause-toggle') await runCommand(contactId, input.checked ? 'pause' : 'resume');
    if (input.dataset.action === 'escalation-toggle') await setEscalation(contactId, input.checked);
  } finally {
    input.disabled = false;
  }
});

if (!getToken()) {
  showCard({ title: 'No control token', description: 'Reload using the full link with ?token=... in the URL.' });
} else {
  refreshContacts();
  refreshRoster();
  setInterval(() => {
    refreshContacts();
    refreshRoster();
  }, ROSTER_POLL_MS);
}
