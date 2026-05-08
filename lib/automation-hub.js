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

const ARTIFACT_COPY = {
  provider_extraction_review: {
    title: 'Provider extraction review draft',
    module: 'Provider Management',
    surface: 'Provider Review Draft',
    actionLabel: 'Review draft',
    decision: 'Review the uploaded provider document, verify extracted provider details, then decide whether to update/create the official provider record.'
  },
  kb_formatting_review: {
    title: 'Knowledge formatting review draft',
    module: 'Knowledge Base Manager',
    surface: 'KB Suggestion Panel',
    actionLabel: 'Review draft',
    decision: 'Review the formatting suggestion, confirm the official wording/category, then publish or keep it as a capture.'
  },
  duplicate_review_queue: {
    title: 'Duplicate review queue item',
    module: 'Provider Management',
    surface: 'Duplicate Review Queue',
    actionLabel: 'Open queue',
    decision: 'Compare the possible duplicate against the pending save, then merge, discard, or continue with a separate official record.'
  },
  inbox_helper_panel: {
    title: 'Inbox helper suggestion panel',
    module: 'Inbox',
    surface: 'Thread Suggestion / Routing Panel',
    actionLabel: 'Open thread panel',
    decision: 'Review the service intent and suggested next step, then draft a reply, route internally, or keep human ownership.'
  },
  provider_matching_results: {
    title: 'Provider matching results panel',
    module: 'Provider Matching Engine',
    surface: 'Matching Results List',
    actionLabel: 'Open results',
    decision: 'Review ranked matching criteria/results, then shortlist providers or rerun matching with refined criteria.'
  }
};

function buildWorkflow(definition) {
  return {
    ...definition,
    stats: {
      runCount: 0,
      lastRunAt: null,
      lastState: 'never',
      lastResult: 'Never run',
      lastError: null,
      lastArtifactId: null,
      lastArtifactTitle: null
    }
  };
}

function getArtifactType(workflowId) {
  if (workflowId === 'wf-provider-doc-extractor') return 'provider_extraction_review';
  if (workflowId === 'wf-kb-capture-formatting') return 'kb_formatting_review';
  if (workflowId === 'wf-duplicate-alert') return 'duplicate_review_queue';
  if (workflowId === 'wf-inbox-service-helper') return 'inbox_helper_panel';
  if (workflowId === 'wf-manual-provider-rematch') return 'provider_matching_results';
  return null;
}

function pickPayloadRefs(payload = {}) {
  return {
    providerId: payload.providerId || null,
    documentId: payload.documentId || null,
    captureId: payload.captureId || null,
    duplicateId: payload.duplicateId || payload.candidateProviderId || null,
    duplicateScore: payload.duplicateScore ?? null,
    messageId: payload.messageId || null,
    threadId: payload.threadId || payload.wa_id || payload.waId || null,
    serviceIntent: payload.serviceIntent || null,
    manualAction: payload.manualAction || null,
    module: payload.module || null
  };
}

function buildArtifactDestination(type, refs) {
  if (type === 'provider_extraction_review') return `/providers#automation-artifact-${refs.documentId || refs.providerId || 'latest'}`;
  if (type === 'kb_formatting_review') return `/kb#automation-artifact-${refs.captureId || 'latest'}`;
  if (type === 'duplicate_review_queue') return `/providers#duplicate-review-${refs.duplicateId || 'latest'}`;
  if (type === 'inbox_helper_panel') return refs.threadId ? `/#thread-${encodeURIComponent(refs.threadId)}` : '/#automation-inbox-helper';
  if (type === 'provider_matching_results') return '/providers#matching-results';
  return '/automation';
}

function buildArtifactChecklist(type, refs) {
  if (type === 'provider_extraction_review') {
    return [
      'Open the provider review draft.',
      'Verify identity, languages, services, rates/availability, and document source before any official provider update.',
      refs.providerId ? `Continue from provider record ${refs.providerId}.` : 'Attach the reviewed extraction to the correct provider record.'
    ];
  }
  if (type === 'kb_formatting_review') {
    return [
      'Open the KB suggestion panel.',
      'Check formatting, title, category, source context, and duplication risk.',
      'Approve for official KB publishing only after staff review.'
    ];
  }
  if (type === 'duplicate_review_queue') {
    return [
      'Open the duplicate review queue item before official save.',
      refs.duplicateScore !== null ? `Review the duplicate confidence score (${Math.round(Number(refs.duplicateScore || 0) * 100)}%).` : 'Review the duplicate confidence signals.',
      'Choose merge/update existing, cancel save, or proceed as separate record.'
    ];
  }
  if (type === 'inbox_helper_panel') {
    return [
      'Open the related inbox thread suggestion panel.',
      refs.serviceIntent ? `Review detected service intent: ${refs.serviceIntent}.` : 'Review detected service intent and routing signals.',
      'Decide whether to draft a reply, route the thread, or keep manual staff control.'
    ];
  }
  if (type === 'provider_matching_results') {
    return [
      'Open the provider matching results list.',
      'Review ranked candidates and matching criteria.',
      'Shortlist providers or rerun matching with narrower service/language/location criteria.'
    ];
  }
  return ['Open the generated workflow result and decide the next staff action.'];
}

function createAutomationHub({ getSystemMode }) {
  const notifications = [];
  const history = [];
  const artifacts = [];
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

  function addArtifact(artifact) {
    artifacts.unshift(artifact);
    if (artifacts.length > 300) artifacts.length = 300;
    return artifact;
  }

  function createRunArtifact({ wf, runId, triggerType, payload, meta, startedAt }) {
    const type = getArtifactType(wf.id);
    if (!type) return null;
    const copy = ARTIFACT_COPY[type];
    const refs = pickPayloadRefs(payload);
    const mode = getSystemMode?.() || 'live';
    const artifact = {
      id: crypto.randomUUID(),
      type,
      title: copy.title,
      module: copy.module,
      surface: copy.surface,
      status: 'pending_review',
      actionLabel: copy.actionLabel,
      destinationUrl: buildArtifactDestination(type, refs),
      decision: copy.decision,
      checklist: buildArtifactChecklist(type, refs),
      refs,
      runId,
      workflowId: wf.id,
      workflowName: wf.name,
      triggerType,
      executionMode: meta.manual ? 'manual' : wf.executionMode,
      initiatedBy: meta.initiatedBy || 'system',
      source: meta.source || null,
      mode,
      createdAt: startedAt || nowIso(),
      updatedAt: nowIso()
    };
    return addArtifact(artifact);
  }

  async function executeAction(action, context) {
    const mode = getSystemMode?.() || 'live';
    const artifact = context.artifact;
    const artifactPhrase = artifact ? `${artifact.title} created: ${artifact.actionLabel}` : null;
    switch (action.type) {
      case 'run_extractor':
        return { ok: true, note: artifactPhrase || `Extractor queued (${mode} mode)`, artifactId: artifact?.id || null };
      case 'run_matching_suggestion':
        return { ok: true, note: artifactPhrase || `Suggestion prepared (${mode} mode)`, artifactId: artifact?.id || null };
      case 'send_notification':
        return { ok: true, note: artifact ? `Notification points to ${artifact.surface}` : 'Notification prepared', artifactId: artifact?.id || null };
      case 'create_kb_draft':
      case 'create_provider_draft':
      case 'update_item_status':
      case 'archive_thread':
      case 'run_duplicate_check':
        return { ok: true, note: `${action.type} acknowledged (${mode} mode)`, artifactId: artifact?.id || null };
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
    const artifact = conditionsPassed ? createRunArtifact({ wf, runId, triggerType, payload, meta, startedAt }) : null;

    if (!conditionsPassed) {
      ok = false;
      error = 'Workflow conditions were not met for this trigger payload.';
    } else {
      for (const action of wf.actions) {
        const result = await executeAction(action, { workflow: wf, triggerType, payload, meta, artifact });
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
    wf.stats.lastArtifactId = ok ? artifact?.id || null : null;
    wf.stats.lastArtifactTitle = ok ? artifact?.title || null : null;

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
      artifact: artifact ? { ...artifact } : null,
      artifactId: artifact?.id || null,
      payloadSummary: Object.keys(payload || {}).slice(0, 8)
    };
    addHistory(entry);

    const notificationMessage = ok && artifact
      ? `Automation completed: ${wf.name} — ${artifact.title} is ready. ${artifact.actionLabel}: ${artifact.surface}.`
      : `${ok ? 'Automation completed' : 'Automation failed'}: ${wf.name} (${triggerType})${error ? ` — ${error}` : ''}`;

    addNotification(
      notificationMessage,
      ok ? 'success' : 'error',
      {
        runId,
        workflowId: wf.id,
        triggerType,
        executionMode: entry.executionMode,
        initiatedBy: entry.initiatedBy,
        artifactId: artifact?.id || null,
        artifactType: artifact?.type || null,
        actionLabel: artifact?.actionLabel || null,
        destinationUrl: artifact?.destinationUrl || null,
        surface: artifact?.surface || null
      }
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
  function listArtifacts(limit = 100) { return artifacts.slice(0, limit).map(item => ({ ...item })); }
  function getArtifact(id) {
    const artifact = artifacts.find(item => item.id === id);
    return artifact ? { ...artifact } : null;
  }
  function setWorkflowState(id, active) {
    const wf = workflows.find(w => w.id === id);
    if (!wf) return null;
    wf.active = Boolean(active);
    return { ...wf, stats: { ...wf.stats } };
  }

  return {
    trigger,
    runWorkflowById,
    listWorkflows,
    listHistory,
    listNotifications,
    listArtifacts,
    getArtifact,
    setWorkflowState,
    addNotification
  };
}

module.exports = { createAutomationHub };
