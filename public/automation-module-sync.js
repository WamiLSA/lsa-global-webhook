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

  function titleCaseOperationalRef(value) {
    return String(value || '')
      .replace(/^(kb-record|kb-capture|provider-record|thread|duplicate):/i, '')
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => {
        const lower = part.toLowerCase();
        if (['kb', 'id', 'cefr', 'lsa'].includes(lower)) return lower.toUpperCase();
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
  }

  function cleanDisplayLabel(value) {
    const text = String(value || '').trim();
    const known = {
      'manual-provider-document-check': 'Manual provider document check',
      'manual-kb-formatting-check': 'Manual KB formatting check',
      'manual-duplicate-check': 'Latest duplicate review candidate',
      'manual-inbox-helper-check': 'Current inbox helper suggestion',
      manual_service_intent_check: 'Manual service-intent review',
      rerun_provider_matching: 'Manual provider matching rerun',
      'pending-provider-record': 'Provider record pending final ID',
      'uploaded-provider-document': 'Uploaded provider document',
      'latest-duplicate-candidate': 'Latest duplicate candidate',
      'current-inbox-thread': 'Current inbox thread',
      'latest-message': 'Latest inbox message',
      'matching-result-set': 'Provider matching result set'
    };
    if (!text) return '';
    if (known[text]) return known[text];
    return titleCaseOperationalRef(text);
  }

  function formatSyncState(value) {
    const labels = { awaiting_review: 'Awaiting review', synchronized: 'Synchronized' };
    return labels[value] || cleanDisplayLabel(value);
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
    window.__automationModuleSyncItems = items;
    window.dispatchEvent(new CustomEvent('automation-module-sync:loaded', { detail: { moduleName, items } }));
    if (!items.length) {
      mount.innerHTML = '<div class="automation-sync-empty">No Automation Hub decisions are currently synchronized with this module.</div>';
      return;
    }
    mount.innerHTML = `<div class="automation-sync-card">
      <div class="automation-sync-title">Automation Hub synchronized decisions</div>
      ${items.map((item) => {
        const syncState = item.syncState || (item.pendingReview ? 'awaiting_review' : 'synchronized');
        const stateClass = item.pendingReview ? 'pending' : 'closed';
        const target = item.targetReference || {};
        const rawRecordId = item.destinationRecordId || target.destinationRecordId || '';
        const destinationRecord = item.destinationDisplayLabel || target.destinationDisplayLabel || cleanDisplayLabel(rawRecordId) || 'Not assigned yet';
        const destinationObject = item.destinationObjectName || target.destinationObjectName || destinationRecord || item.surface || '';
        const destinationPanel = item.destinationPanel || target.destinationPanel || item.surface || '';
        const targetUrl = item.targetUrl || target.destinationUrl || '';
        const openLabel = item.openTargetLabel || target.openTargetLabel || 'Open target record';
        return `<div class="automation-sync-row">
          <span class="automation-sync-status ${stateClass}">${escapeHtml(item.statusLabel || item.status || '')}</span>
          <span><strong>${escapeHtml(item.title || item.surface || '')}</strong></span>
          <span class="automation-sync-muted">${escapeHtml(item.actionTaken || item.lastActionLabel || 'Pending review')} • ${escapeHtml(formatSyncState(syncState))} • ${escapeHtml(formatTime(item.updatedAt || item.syncedAt))}</span>
          <span class="automation-sync-muted"><strong>Record:</strong> ${escapeHtml(destinationRecord)}${rawRecordId ? `<span class="automation-sync-muted"> (ID: ${escapeHtml(rawRecordId)})</span>` : ''} • <strong>Object:</strong> ${escapeHtml(destinationObject)} • <strong>Panel:</strong> ${escapeHtml(destinationPanel)}</span>
          ${item.syncConfirmation ? `<span class="automation-sync-muted">${escapeHtml(item.syncConfirmation)}</span>` : ''}
          ${item.verificationHint || target.verificationHint ? `<span class="automation-sync-muted">Verify here: ${escapeHtml(item.verificationHint || target.verificationHint)}</span>` : ''}
          ${targetUrl ? `<a href="${escapeHtml(targetUrl)}">${escapeHtml(openLabel)}</a>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  loadModuleSync().catch(() => {
    mount.innerHTML = '<div class="automation-sync-empty">Automation Hub sync could not be loaded.</div>';
  });
}());
