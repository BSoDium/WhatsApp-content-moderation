const cardContainer = document.getElementById('card-container');
const searchInput = document.getElementById('contact-search');
const resultsEl = document.getElementById('contact-results');
const tabsEl = document.getElementById('tabs');
const panelsEl = document.getElementById('panels');

const PICKER_RESULT_LIMIT = 20;
const ROSTER_POLL_MS = 5000;

const state = { contacts: [], roster: [], activeId: null };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// The control token itself never lives in this file's source — it's read
// from sessionStorage at runtime, populated by index.html's inline
// bootstrap script. Safe even though this file is served unauthenticated:
// an unauthenticated *file* only means anyone can read this code, not that
// it can read another visitor's session state.
function getToken() {
  try {
    return sessionStorage.getItem('controlToken');
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

function panelTemplate(entry) {
  return `
    <div class="panel" data-contact-id="${escapeHtml(entry.id)}" role="tabpanel">
      <dl class="status">
        <dt>Strikes</dt><dd>${entry.strikeCount}</dd>
        <dt>Block</dt><dd>${entry.block ? `until ${new Date(entry.block.unblockAt).toLocaleString()}` : 'not blocked'}</dd>
      </dl>
      <div class="row">
        <input type="checkbox" role="switch" class="switch" data-action="pause-toggle" ${entry.paused ? 'checked' : ''} />
        <label>Paused</label>
      </div>
      <div class="row">
        <input type="checkbox" role="switch" class="switch" data-action="escalation-toggle" ${entry.escalationEnabled ? 'checked' : ''} />
        <label>Escalation (auto-block)</label>
      </div>
      <div class="actions">
        <button data-action="unblock">Unblock now</button>
        <button data-action="stop-monitoring" class="button--danger">Stop monitoring</button>
      </div>
      <p class="inline-message" data-role="message"></p>
    </div>
  `;
}

function renderTabs() {
  tabsEl.hidden = state.roster.length === 0;
  tabsEl.innerHTML = state.roster
    .map(
      (r) => `
      <button role="tab" class="tab${r.id === state.activeId ? ' tab--active' : ''}"
        data-contact-id="${escapeHtml(r.id)}" aria-selected="${r.id === state.activeId}">${escapeHtml(r.name)}</button>
    `,
    )
    .join('');
}

function renderPanel() {
  const entry = state.roster.find((r) => r.id === state.activeId);
  panelsEl.innerHTML = entry ? panelTemplate(entry) : '<p class="empty-state">Add a contact above to get started.</p>';
}

function renderPicker() {
  const query = searchInput.value.trim().toLowerCase();
  const candidates = state.contacts.filter((c) => !c.monitored);
  const results = query
    ? candidates.filter((c) => c.name.toLowerCase().includes(query) || c.id.toLowerCase().includes(query))
    : candidates;

  resultsEl.hidden = results.length === 0;
  resultsEl.innerHTML = results
    .slice(0, PICKER_RESULT_LIMIT)
    .map((c) => `<li role="option" data-contact-id="${escapeHtml(c.id)}">${escapeHtml(c.name)}</li>`)
    .join('');
}

async function refreshRoster() {
  try {
    state.roster = await apiFetch('/api/roster');
    if (!state.roster.some((r) => r.id === state.activeId)) {
      state.activeId = state.roster[0]?.id ?? null;
    }
    renderTabs();
    renderPanel();
    hideCard();
  } catch (err) {
    showCard({ title: "Couldn't reach the server", description: err.message, actionLabel: 'Retry', onAction: refreshRoster });
  }
}

async function refreshContacts() {
  try {
    state.contacts = await apiFetch('/api/contacts');
    renderPicker();
  } catch (err) {
    showCard({ title: 'Could not load contacts', description: err.message, actionLabel: 'Retry', onAction: refreshContacts });
  }
}

async function addContact(contactId) {
  try {
    await apiFetch('/api/roster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId }),
    });
    searchInput.value = '';
    resultsEl.hidden = true;
    await Promise.all([refreshRoster(), refreshContacts()]);
  } catch (err) {
    showCard({ title: 'Could not add contact', description: err.message, actionLabel: 'Retry', onAction: () => addContact(contactId) });
  }
}

async function stopMonitoring(contactId) {
  try {
    await apiFetch(`/api/roster/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
    if (state.activeId === contactId) state.activeId = null;
    await refreshRoster();
  } catch (err) {
    showCard({ title: 'Could not stop monitoring', description: err.message, actionLabel: 'Retry', onAction: () => stopMonitoring(contactId) });
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
    const messageEl = panelsEl.querySelector('[data-role="message"]');
    if (messageEl) messageEl.textContent = result.message ?? '';
  } catch (err) {
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
    showCard({
      title: 'Could not update escalation',
      description: err.message,
      actionLabel: 'Retry',
      onAction: () => setEscalation(contactId, enabled),
    });
  }
}

resultsEl.addEventListener('click', (event) => {
  const item = event.target.closest('[data-contact-id]');
  if (item) addContact(item.dataset.contactId);
});

searchInput.addEventListener('input', renderPicker);
searchInput.addEventListener('focus', () => {
  if (state.contacts.length === 0) refreshContacts();
});

tabsEl.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-contact-id]');
  if (!tab) return;
  state.activeId = tab.dataset.contactId;
  renderTabs();
  renderPanel();
});

panelsEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const contactId = button.closest('[data-contact-id]').dataset.contactId;
  if (button.dataset.action === 'unblock') runCommand(contactId, 'unblock');
  if (button.dataset.action === 'stop-monitoring') stopMonitoring(contactId);
});

panelsEl.addEventListener('change', (event) => {
  const input = event.target.closest('[data-action]');
  if (!input) return;
  const contactId = input.closest('[data-contact-id]').dataset.contactId;
  if (input.dataset.action === 'pause-toggle') runCommand(contactId, input.checked ? 'pause' : 'resume');
  if (input.dataset.action === 'escalation-toggle') setEscalation(contactId, input.checked);
});

if (!getToken()) {
  showCard({ title: 'No control token', description: 'Reload using the full link with ?token=... in the URL.' });
} else {
  refreshRoster();
  setInterval(refreshRoster, ROSTER_POLL_MS);
}
