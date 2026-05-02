const crypto = require('crypto');

function nowIso() { return new Date().toISOString(); }

function createAutomationHub({ getSystemMode }) {
  const notifications = [];
  const history = [];

  const workflows = [
    {
      id: 'wf-provider-doc-extractor',
      name: 'Provider document uploaded -> run provider extractor',
      active: true,
      trigger: { type: 'document_uploaded' },
      conditions: [{ field: 'module', operator: 'eq', value: 'providers' }],
      actions: [{ type: 'run_extractor' }, { type: 'send_notification' }],
      stats: { runCount: 0, lastRunAt: null, lastState: 'never' }
    },
    {
      id: 'wf-kb-capture-formatting',
      name: 'New captured knowledge -> prepare KB formatting suggestion',
      active: true,
      trigger: { type: 'new_captured_knowledge' },
      conditions: [],
      actions: [{ type: 'run_matching_suggestion' }, { type: 'send_notification' }],
      stats: { runCount: 0, lastRunAt: null, lastState: 'never' }
    },
    {
      id: 'wf-duplicate-alert',
      name: 'Duplicate detected -> notify before official save',
      active: true,
      trigger: { type: 'duplicate_detected' },
      conditions: [{ field: 'duplicateScore', operator: 'gt', value: 0.75 }],
      actions: [{ type: 'send_notification' }],
      stats: { runCount: 0, lastRunAt: null, lastState: 'never' }
    },
    {
      id: 'wf-inbox-service-helper',
      name: 'New inbox message matching known service intent -> helper suggestion',
      active: true,
      trigger: { type: 'new_inbox_message' },
      conditions: [{ field: 'serviceIntent', operator: 'exists' }],
      actions: [{ type: 'run_matching_suggestion' }, { type: 'send_notification' }],
      stats: { runCount: 0, lastRunAt: null, lastState: 'never' }
    },
    {
      id: 'wf-manual-provider-rematch',
      name: 'Manual re-run provider matching',
      active: true,
      trigger: { type: 'manual_trigger' },
      conditions: [{ field: 'manualAction', operator: 'eq', value: 'rerun_provider_matching' }],
      actions: [{ type: 'run_matching_suggestion' }, { type: 'send_notification' }],
      stats: { runCount: 0, lastRunAt: null, lastState: 'never' }
    }
  ];

  function evaluateCondition(condition, payload) {
    const currentValue = payload?.[condition.field];
    if (condition.operator === 'eq') return currentValue === condition.value;
    if (condition.operator === 'gt') return Number(currentValue || 0) > Number(condition.value || 0);
    if (condition.operator === 'exists') return currentValue !== undefined && currentValue !== null && currentValue !== '';
    return false;
  }

  function addNotification(message, level = 'info') {
    notifications.unshift({ id: crypto.randomUUID(), level, message, createdAt: nowIso() });
    if (notifications.length > 120) notifications.length = 120;
  }

  function addHistory(entry) {
    history.unshift(entry);
    if (history.length > 1000) history.length = 1000;
  }

  async function executeAction(action, context) {
    const mode = getSystemMode?.() || 'live';
    switch (action.type) {
      case 'run_extractor':
        return { ok: true, note: `Extractor queued (${mode} mode)` };
      case 'run_matching_suggestion':
        return { ok: true, note: 'Suggestion prepared' };
      case 'send_notification':
        addNotification(`[${context.workflow.id}] ${context.triggerType} processed`, 'info');
        return { ok: true, note: 'Notification posted' };
      case 'create_kb_draft':
      case 'create_provider_draft':
      case 'update_item_status':
      case 'archive_thread':
      case 'run_duplicate_check':
        return { ok: true, note: `${action.type} acknowledged` };
      default:
        return { ok: false, note: `Unknown action ${action.type}` };
    }
  }

  async function trigger(triggerType, payload = {}, meta = {}) {
    const candidates = workflows.filter(wf => wf.active && wf.trigger.type === triggerType);
    for (const wf of candidates) {
      const conditionsPassed = wf.conditions.every(c => evaluateCondition(c, payload));
      if (!conditionsPassed) continue;

      const runId = crypto.randomUUID();
      const startedAt = nowIso();
      let ok = true;
      let error = null;
      const actionResults = [];
      for (const action of wf.actions) {
        const result = await executeAction(action, { workflow: wf, triggerType, payload, meta });
        actionResults.push({ action: action.type, ...result });
        if (!result.ok) {
          ok = false;
          error = result.note;
          break;
        }
      }

      wf.stats.runCount += 1;
      wf.stats.lastRunAt = startedAt;
      wf.stats.lastState = ok ? 'success' : 'failed';

      addHistory({ runId, workflowId: wf.id, workflowName: wf.name, triggerType, startedAt, success: ok, error, actionResults });
    }
  }

  function listWorkflows() {
    return workflows.map(wf => ({ ...wf }));
  }

  function listHistory(limit = 100) { return history.slice(0, limit); }
  function listNotifications(limit = 30) { return notifications.slice(0, limit); }
  function setWorkflowState(id, active) {
    const wf = workflows.find(w => w.id === id);
    if (!wf) return null;
    wf.active = Boolean(active);
    return wf;
  }

  return { trigger, listWorkflows, listHistory, listNotifications, setWorkflowState, addNotification };
}

module.exports = { createAutomationHub };
