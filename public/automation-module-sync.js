(function () {
  const moduleName = document.currentScript?.dataset?.module || '';
  const mountId = document.currentScript?.dataset?.mount || 'automationModuleSync';
  const mount = document.getElementById(mountId);
  if (!mount || !moduleName) return;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function formatTime(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function getToken() {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      if (!storage) continue;
      for (const key of ['lsa_internal_token', 'lsaInternalToken', 'authToken']) {
        const token = storage.getItem(key);
        if (token) return token;
      }
    }
    return '';
  }

  async function loadModuleSync() {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`/api/automation/module-state?module=${encodeURIComponent(moduleName)}&limit=5`, {
      credentials: 'include',
      headers
    });
    if (!response.ok) return;
    const payload = await response.json();
    const items = payload.moduleState || [];
    if (!items.length) {
      mount.innerHTML = '<div class="automation-sync-empty">No Automation Hub decisions are currently synchronized with this module.</div>';
      return;
    }
    mount.innerHTML = `<div class="automation-sync-card">
      <div class="automation-sync-title">Automation Hub synchronized decisions</div>
      ${items.map((item) => `<div class="automation-sync-row">
        <span class="automation-sync-status ${item.pendingReview ? 'pending' : 'closed'}">${escapeHtml(item.statusLabel || item.status || '')}</span>
        <span>${escapeHtml(item.title || item.surface || '')}</span>
        <span class="automation-sync-muted">${escapeHtml(item.actionTaken || item.lastActionLabel || 'Pending review')} • ${escapeHtml(formatTime(item.updatedAt || item.syncedAt))}</span>
        ${item.targetUrl ? `<a href="${escapeHtml(item.targetUrl)}">Open</a>` : ''}
      </div>`).join('')}
    </div>`;
  }

  loadModuleSync().catch(() => {
    mount.innerHTML = '<div class="automation-sync-empty">Automation Hub sync could not be loaded.</div>';
  });
}());
