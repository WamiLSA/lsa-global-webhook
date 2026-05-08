const crypto = require('crypto');

function nowIso() { return new Date().toISOString(); }

const WORKFLOW_DEFINITIONS = [
  {
    id: 'wf-provider-doc-extractor',
    name: 'Provider document uploaded -> run provider extractor',
    active: true,
    trigger: { type: 'document_uploaded' },
    executionMode: 'assisted',
    manualPayload: { module: 'providers', documentId: 'manual-provider-document-check' },
    conditions: [{ field: 'module', operator: 'eq', value: 'providers' }],
    actions: [{ type: 'run_extractor' }, { type: 'send_notification' }]
  },
  {
    id: 'wf-kb-capture-formatting',
    name: 'New captured knowledge -> prepare KB formatting suggestion',
    active: true,
    trigger: { type: 'new_captured_knowledge' },
    executionMode: 'assisted',
    manualPayload: { captureId: 'manual-kb-formatting-check' },
    conditions: [],
    actions: [{ type: 'run_matching_suggestion' }, { type: 'send_notification' }]
  },
  {
    id: 'wf-duplicate-alert',
    name: 'Duplicate detected -> notify before official save',
    active: true,
    trigger: { type: 'duplicate_detected' },
    executionMode: 'assisted',
    manualPayload: { duplicateScore: 0.98, duplicateId: 'manual-duplicate-check' },
    conditions: [{ field: 'duplicateScore', operator: 'gt', value: 0.75 }],
    actions: [{ type: 'send_notification' }]
  },
  {
    id: 'wf-inbox-service-helper',
    name: 'New inbox message matching known service intent -> helper suggestion',
    active: true,
    trigger: { type: 'new_inbox_message' },
    executionMode: 'assisted',
    manualPayload: { serviceIntent: 'manual_service_intent_check', messageId: 'manual-inbox-helper-check' },
    conditions: [{ field: 'serviceIntent', operator: 'exists' }],
    actions: [{ type: 'run_matching_suggestion' }, { type: 'send_notification' }]
  },
  {
    id: 'wf-manual-provider-rematch',
    name: 'Manual re-run provider matching',
    active: true,
    trigger: { type: 'manual_trigger' },
    executionMode: 'manual',
    manualPayload: { manualAction: 'rerun_provider_matching' },
    conditions: [{ field: 'manualAction', operator: 'eq', value: 'rerun_provider_matching' }],
    actions: [{ type: 'run_matching_suggestion' }, { type: 'send_notification' }]
  }
];

function buildWorkflow(definition) {
  return {
    ...definition,
    stats: {
      runCount: 0,
      lastRunAt: null,
      lastState: 'never',
      lastResult: 'Never run',
      lastError: null
    }
  };
}

function createAutomationHub({ getSystemMode }) {
  const notifications = [];
  const history = [];
  const workflows = WORKFLOW_DEFINITIONS.map(buildWorkflow);

  function evaluateCondition(condition, payload) {
    const currentValue = payload?.[condition.field];
    if (condition.operator === 'eq') return currentValue === condition.value;
    if (condition.operator === 'gt') return Number(currentValue || 0) > Number(condition.value || 0);
    if (condition.operator === 'exists') return currentValue !== undefined && currentValue !== null && currentValue !== '';
    return false;
  }

  function addNotification(message, level = 'info', details = {}) {
    notifications.unshift({ id: crypto.randomUUID(), level, message, details, createdAt: nowIso() });
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
        return { ok: true, note: `Suggestion prepared (${mode} mode)` };
      case 'send_notification':
        return { ok: true, note: 'Notification prepared' };
      case 'create_kb_draft':
      case 'create_provider_draft':
      case 'update_item_status':
      case 'archive_thread':
      case 'run_duplicate_check':
        return { ok: true, note: `${action.type} acknowledged (${mode} mode)` };
      default:
        return { ok: false, note: `Unknown action ${action.type}` };
    }
  }

  async function executeWorkflow(wf, triggerType, payload = {}, meta = {}) {
    const runId = crypto.randomUUID();
    const startedAt = nowIso();
    const conditionsPassed = wf.conditions.every(c => evaluateCondition(c, payload));
    let ok = true;
    let error = null;
    const actionResults = [];

    if (!conditionsPassed) {
      ok = false;
      error = 'Workflow conditions were not met for this trigger payload.';
    } else {
      for (const action of wf.actions) {
        const result = await executeAction(action, { workflow: wf, triggerType, payload, meta });
        actionResults.push({ action: action.type, ...result });
        if (!result.ok) {
          ok = false;
          error = result.note;
          break;
        }
      }
    }

    const completedAt = nowIso();
    const resultText = ok
      ? actionResults.map(item => item.note).filter(Boolean).join(' • ') || 'Workflow completed'
      : error;

    wf.stats.runCount += 1;
    wf.stats.lastRunAt = startedAt;
    wf.stats.lastState = ok ? 'success' : 'failed';
    wf.stats.lastResult = resultText;
    wf.stats.lastError = ok ? null : error;

    const entry = {
      runId,
      workflowId: wf.id,
      workflowName: wf.name,
      triggerType,
      executionMode: meta.manual ? 'manual' : wf.executionMode,
      initiatedBy: meta.initiatedBy || 'system',
      startedAt,
      completedAt,
      success: ok,
      error,
      result: resultText,
      actionResults,
      payloadSummary: Object.keys(payload || {}).slice(0, 8)
    };
    addHistory(entry);

    addNotification(
      `${ok ? 'Automation completed' : 'Automation failed'}: ${wf.name} (${triggerType})${error ? ` — ${error}` : ''}`,
      ok ? 'success' : 'error',
      { runId, workflowId: wf.id, triggerType, executionMode: entry.executionMode, initiatedBy: entry.initiatedBy }
    );

    return entry;
  }

  async function trigger(triggerType, payload = {}, meta = {}) {
    const candidates = workflows.filter(wf => wf.active && wf.trigger.type === triggerType);
    const runs = [];
    for (const wf of candidates) {
      const conditionsPassed = wf.conditions.every(c => evaluateCondition(c, payload));
      if (!conditionsPassed) continue;
      runs.push(await executeWorkflow(wf, triggerType, payload, meta));
    }
    return runs;
  }

  async function runWorkflowById(id, meta = {}) {
    const wf = workflows.find(w => w.id === id);
    if (!wf) return { ok: false, status: 404, error: 'Workflow not found' };
    if (!wf.active) return { ok: false, status: 409, error: 'Workflow is inactive. Activate it before running manually.' };
    const payload = { ...(wf.manualPayload || {}) };
    const run = await executeWorkflow(wf, wf.trigger.type, payload, { ...meta, manual: true });
    return { ok: run.success, status: run.success ? 200 : 500, run, error: run.error };
  }

  function listWorkflows() {
    return workflows.map(wf => ({
      id: wf.id,
      name: wf.name,
      active: wf.active,
      trigger: { ...wf.trigger },
      executionMode: wf.executionMode,
      conditions: wf.conditions.map(item => ({ ...item })),
      actions: wf.actions.map(item => ({ ...item })),
      stats: { ...wf.stats }
    }));
  }

  function listHistory(limit = 100) { return history.slice(0, limit); }
  function listNotifications(limit = 30) { return notifications.slice(0, limit); }
  function setWorkflowState(id, active) {
    const wf = workflows.find(w => w.id === id);
    if (!wf) return null;
    wf.active = Boolean(active);
    return { ...wf, stats: { ...wf.stats } };
  }

  return { trigger, runWorkflowById, listWorkflows, listHistory, listNotifications, setWorkflowState, addNotification };
}

module.exports = { createAutomationHub };
