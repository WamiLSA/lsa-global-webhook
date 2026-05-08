const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function nowIso() { return new Date().toISOString(); }

const FINAL_REVIEW_STATUSES = new Set([
  'approved',
  'confirmed',
  'dismissed',
  'kept_separate',
  'manual_ownership',
  'merged',
  'published',
  'rejected',
  'shortlisted'
]);


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPendingReviewStatus(status) {
  return !FINAL_REVIEW_STATUSES.has(status || 'pending_review');
}

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

const ARTIFACT_STATUS_LABELS = {
  pending_review: 'Pending review',
  shortlisted: 'Shortlisted',
  closed: 'Closed',
  confirmed: 'Confirmed',
  approved: 'Approved',
  rejected: 'Rejected',
  merged: 'Merged',
  dismissed: 'Dismissed',
  published: 'Published',
  returned_to_capture: 'Returned to capture',
  edit_requested: 'Edit requested',
  kept_separate: 'Kept separate',
  manual_ownership: 'Manual ownership',
  rerun_requested: 'Rerun requested'
};

const ARTIFACT_DECISION_ACTIONS = {
  provider_matching_results: [
    {
      id: 'shortlist_candidate',
      label: 'Shortlist candidate',
      nextStatus: 'shortlisted',
      targetModule: 'Provider Matching Engine',
      targetUrl: '/providers#matching-results',
      description: 'Move the provider candidate into an operator shortlist for staffing review.'
    },
    {
      id: 'confirm_candidate',
      label: 'Confirm candidate',
      nextStatus: 'confirmed',
      targetModule: 'Provider Management',
      targetUrl: '/providers#matching-results',
      description: 'Confirm the selected candidate as the intended provider match.'
    },
    {
      id: 'reject_candidate',
      label: 'Reject candidate',
      nextStatus: 'rejected',
      targetModule: 'Provider Matching Engine',
      targetUrl: '/providers#matching-results',
      description: 'Reject the current candidate from this matching result.'
    },
    {
      id: 'rerun_matching',
      label: 'Rerun matching',
      nextStatus: 'rerun_requested',
      targetModule: 'Provider Matching Engine',
      targetUrl: '/providers#matching-results',
      description: 'Request a new matching pass with refined service, language, location, or availability criteria.'
    }
  ],
  inbox_helper_panel: [
    {
      id: 'approve_suggestion',
      label: 'Approve suggestion',
      nextStatus: 'approved',
      targetModule: 'Inbox',
      targetUrl: '/#automation-inbox-helper',
      description: 'Approve the suggested service intent, routing, or reply support for use in the inbox thread.'
    },
    {
      id: 'edit_before_use',
      label: 'Edit before use',
      nextStatus: 'edit_requested',
      targetModule: 'Inbox',
      targetUrl: '/#automation-inbox-helper',
      description: 'Keep the suggestion active but mark it for staff editing before any client-facing use.'
    },
    {
      id: 'dismiss_suggestion',
      label: 'Dismiss suggestion',
      nextStatus: 'dismissed',
      targetModule: 'Inbox',
      targetUrl: '/#automation-inbox-helper',
      description: 'Dismiss the helper suggestion as not useful for this thread.'
    },
    {
      id: 'keep_manual_ownership',
      label: 'Keep manual ownership',
      nextStatus: 'manual_ownership',
      targetModule: 'Inbox',
      targetUrl: '/#automation-inbox-helper',
      description: 'Keep the conversation under direct staff ownership without automation assistance.'
    }
  ],
  kb_formatting_review: [
    {
      id: 'approve_to_kb',
      label: 'Approve to KB',
      nextStatus: 'published',
      targetModule: 'Knowledge Base Manager',
      targetUrl: '/kb#automation-publish',
      description: 'Approve the reviewed draft for official Knowledge Base publication.'
    },
    {
      id: 'return_to_capture',
      label: 'Return to capture',
      nextStatus: 'returned_to_capture',
      targetModule: 'Knowledge Capture',
      targetUrl: '/kb#quick-capture',
      description: 'Return the item to the capture layer for more source context or restructuring.'
    },
    {
      id: 'reject',
      label: 'Reject',
      nextStatus: 'rejected',
      targetModule: 'Knowledge Base Manager',
      targetUrl: '/kb#automation-artifact-latest',
      description: 'Reject the formatting draft so it does not move into the official Knowledge Base.'
    }
  ],
  provider_extraction_review: [
    {
      id: 'approve_into_provider_record',
      label: 'Approve into provider record',
      nextStatus: 'approved',
      targetModule: 'Provider Management',
      targetUrl: '/providers#provider-record',
      description: 'Approve the extraction for controlled entry into the official provider record.'
    },
    {
      id: 'edit_draft',
      label: 'Edit draft',
      nextStatus: 'edit_requested',
      targetModule: 'Provider Management',
      targetUrl: '/providers#automation-review-draft',
      description: 'Keep the draft in review and mark it for operator edits before approval.'
    },
    {
      id: 'reject',
      label: 'Reject',
      nextStatus: 'rejected',
      targetModule: 'Provider Management',
      targetUrl: '/providers#automation-review-draft',
      description: 'Reject the extraction draft so it does not update an official provider record.'
    }
  ],
  duplicate_review_queue: [
    {
      id: 'merge',
      label: 'Merge',
      nextStatus: 'merged',
      targetModule: 'Provider Management',
      targetUrl: '/providers#duplicate-review-latest',
      description: 'Merge the pending provider information into the existing provider record.'
    },
    {
      id: 'keep_separate',
      label: 'Keep separate',
      nextStatus: 'kept_separate',
      targetModule: 'Provider Management',
      targetUrl: '/providers#duplicate-review-latest',
      description: 'Confirm that the records should remain separate despite the duplicate signal.'
    },
    {
      id: 'dismiss_alert',
      label: 'Dismiss alert',
      nextStatus: 'dismissed',
      targetModule: 'Provider Management',
      targetUrl: '/providers#duplicate-review-latest',
      description: 'Dismiss the duplicate alert without merging or changing records.'
    }
  ]
};

const ARTIFACT_LIFECYCLE_POLICY = {
  provider_matching_results: {
    reopenStatuses: ['shortlisted', 'confirmed', 'rejected'],
    reviseStatuses: ['shortlisted', 'confirmed'],
    reviseStatus: 'rerun_requested',
    targetModule: 'Provider Matching Engine',
    targetUrl: '/providers#matching-results',
    reviseLabel: 'Revise matching criteria'
  },
  inbox_helper_panel: {
    reopenStatuses: ['approved', 'dismissed', 'manual_ownership'],
    reviseStatuses: ['approved'],
    reviseStatus: 'edit_requested',
    targetModule: 'Inbox',
    targetUrl: '/#automation-inbox-helper',
    reviseLabel: 'Revise inbox suggestion'
  },
  duplicate_review_queue: {
    reopenStatuses: ['kept_separate', 'dismissed'],
    reviseStatuses: ['kept_separate'],
    reviseStatus: 'pending_review',
    targetModule: 'Provider Management',
    targetUrl: '/providers#duplicate-review-latest',
    reviseLabel: 'Recheck duplicate decision'
  },
  kb_formatting_review: {
    reopenStatuses: ['rejected'],
    reviseStatuses: ['published'],
    reviseStatus: 'edit_requested',
    targetModule: 'Knowledge Base Manager',
    targetUrl: '/kb#automation-artifact-latest',
    reviseLabel: 'Revise published KB draft'
  },
  provider_extraction_review: {
    reopenStatuses: ['rejected'],
    reviseStatuses: ['approved'],
    reviseStatus: 'edit_requested',
    targetModule: 'Provider Management',
    targetUrl: '/providers#automation-review-draft',
    reviseLabel: 'Revise provider update'
  }
};


function loadPersistedState(persistencePath, fallback) {
  if (!persistencePath) return clone(fallback);
  try {
    if (!fs.existsSync(persistencePath)) return clone(fallback);
    const raw = fs.readFileSync(persistencePath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return { ...clone(fallback), ...parsed };
  } catch (error) {
    console.error('[automation] failed_to_load_persisted_state', { persistencePath, error: error.message || String(error) });
    return clone(fallback);
  }
}

function persistState(persistencePath, state) {
  if (!persistencePath) return;
  try {
    fs.mkdirSync(path.dirname(persistencePath), { recursive: true });
    const tmpPath = `${persistencePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ ...state, savedAt: nowIso() }, null, 2));
    fs.renameSync(tmpPath, persistencePath);
  } catch (error) {
    console.error('[automation] failed_to_persist_state', { persistencePath, error: error.message || String(error) });
  }
}

function hydrateWorkflowStatsFromHistory(workflows, history) {
  for (const wf of workflows) {
    const runs = safeArray(history).filter(entry => entry.workflowId === wf.id);
    if (!runs.length) continue;
    const latest = runs[0];
    wf.stats.runCount = runs.length;
    wf.stats.lastRunAt = latest.startedAt || null;
    wf.stats.lastState = latest.success ? 'success' : 'failed';
    wf.stats.lastResult = latest.result || (latest.success ? 'Workflow completed' : 'Workflow failed');
    wf.stats.lastError = latest.error || null;
    wf.stats.lastArtifactId = latest.artifactId || latest.artifact?.id || null;
    wf.stats.lastArtifactTitle = latest.artifact?.title || null;
  }
}

function getTargetRecordKey(artifact = {}) {
  const refs = artifact.refs || {};
  return [
    artifact.type || 'artifact',
    refs.providerId || refs.documentId || refs.captureId || refs.duplicateId || refs.threadId || artifact.id
  ].join(':');
}

function buildTargetSync(artifact = {}, action = null, extras = {}) {
  const status = action?.nextStatus || artifact.status || 'pending_review';
  const statusLabel = getStatusLabel(status);
  const pendingReview = extras.pendingReview ?? isPendingReviewStatus(status);
  const reviewState = extras.reviewState || (pendingReview ? 'pending' : 'closed');
  const syncState = extras.syncState || (reviewState === 'closed' ? 'synchronized' : 'awaiting_review');
  return {
    key: getTargetRecordKey(artifact),
    artifactId: artifact.id,
    artifactType: artifact.type,
    title: artifact.title,
    module: artifact.module,
    surface: artifact.surface,
    targetModule: action?.targetModule || artifact.module,
    targetUrl: action?.targetUrl || artifact.destinationUrl,
    status,
    statusLabel,
    pendingReview,
    reviewState,
    syncState,
    syncLabel: syncState === 'synchronized' ? 'Target module synchronized' : 'Awaiting target-module sync',
    syncConfirmation: syncState === 'synchronized'
      ? `${action?.targetModule || artifact.module} accepted ${statusLabel} from Automation Hub.`
      : `${action?.targetModule || artifact.module} is waiting for an operator decision before final sync.`,
    closedAt: reviewState === 'closed' ? (extras.decidedAt || nowIso()) : null,
    refs: artifact.refs || {},
    lastActionId: action?.id || null,
    lastActionLabel: action?.label || null,
    lastOperator: extras.decidedBy || null,
    sourceRunId: artifact.runId || null,
    workflowId: artifact.workflowId || null,
    syncedAt: extras.decidedAt || nowIso()
  };
}

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


function resolveDecisionTargetUrl(type, action, refs = {}) {
  if (type === 'provider_extraction_review') return `/providers#automation-artifact-${refs.documentId || refs.providerId || 'latest'}`;
  if (type === 'kb_formatting_review') {
    if (action.id === 'approve_to_kb') return `/kb#automation-publish-${refs.captureId || 'latest'}`;
    if (action.id === 'return_to_capture') return `/kb#quick-capture-${refs.captureId || 'latest'}`;
    return `/kb#automation-artifact-${refs.captureId || 'latest'}`;
  }
  if (type === 'duplicate_review_queue') return `/providers#duplicate-review-${refs.duplicateId || 'latest'}`;
  if (type === 'inbox_helper_panel') return refs.threadId ? `/#thread-${encodeURIComponent(refs.threadId)}` : action.targetUrl;
  if (type === 'provider_matching_results') return '/providers#matching-results';
  return action.targetUrl || '/automation';
}

function buildDecisionActions(type, refs) {
  return (ARTIFACT_DECISION_ACTIONS[type] || []).map(action => ({
    ...action,
    statusLabel: ARTIFACT_STATUS_LABELS[action.nextStatus] || action.nextStatus,
    targetUrl: resolveDecisionTargetUrl(type, action, refs)
  }));
}

function getLifecycleActions(artifact = {}) {
  const status = artifact.status || 'pending_review';
  const policy = ARTIFACT_LIFECYCLE_POLICY[artifact.type] || {};
  if (artifact.pendingReview || isPendingReviewStatus(status)) return [];

  const refs = artifact.refs || {};
  const targetModule = policy.targetModule || artifact.module;
  const targetUrl = resolveDecisionTargetUrl(artifact.type, { id: 'lifecycle', targetUrl: policy.targetUrl || artifact.destinationUrl }, refs);
  const actions = [];

  if (safeArray(policy.reopenStatuses).includes(status)) {
    actions.push({
      id: 'reopen_review',
      label: 'Reopen review',
      nextStatus: 'pending_review',
      statusLabel: getStatusLabel('pending_review'),
      targetModule,
      targetUrl,
      description: 'Return this item to the active review queue while preserving the decision audit trail.'
    });
  }

  if (safeArray(policy.reviseStatuses).includes(status)) {
    const nextStatus = policy.reviseStatus || 'edit_requested';
    actions.push({
      id: 'revise_item',
      label: policy.reviseLabel || 'Revise item',
      nextStatus,
      statusLabel: getStatusLabel(nextStatus),
      targetModule,
      targetUrl,
      description: 'Mark this closed item as operator-correctable and send it back for revision.'
    });
  }

  return actions;
}

function getArtifactLifecycle(artifact = {}) {
  const status = artifact.status || 'pending_review';
  const pendingReview = artifact.pendingReview ?? isPendingReviewStatus(status);
  return {
    status,
    statusLabel: getStatusLabel(status),
    reviewState: artifact.reviewState || (pendingReview ? 'pending' : 'closed'),
    pendingReview,
    closed: !pendingReview,
    synchronized: artifact.targetSync?.syncState === 'synchronized' || (!pendingReview && Boolean(artifact.targetSync?.syncedAt)),
    canReopenOrRevise: getLifecycleActions({ ...artifact, pendingReview }).length > 0
  };
}

function getStatusLabel(status) {
  return ARTIFACT_STATUS_LABELS[status] || status || 'Pending review';
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

function createAutomationHub({ getSystemMode, persistencePath } = {}) {
  const defaultState = { notifications: [], history: [], artifacts: [], auditLog: [], targetModuleState: [] };
  const persistedState = loadPersistedState(persistencePath, defaultState);
  const notifications = safeArray(persistedState.notifications);
  const history = safeArray(persistedState.history);
  const artifacts = safeArray(persistedState.artifacts);
  const auditLog = safeArray(persistedState.auditLog);
  const targetModuleState = safeArray(persistedState.targetModuleState);
  const workflows = WORKFLOW_DEFINITIONS.map(buildWorkflow);
  hydrateWorkflowStatsFromHistory(workflows, history);

  function persist() {
    persistState(persistencePath, { notifications, history, artifacts, auditLog, targetModuleState });
  }

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
    persist();
  }

  function addHistory(entry) {
    history.unshift(entry);
    if (history.length > 1000) history.length = 1000;
    persist();
  }

  function addArtifact(artifact) {
    artifacts.unshift(artifact);
    if (artifacts.length > 300) artifacts.length = 300;
    syncTargetModuleState(artifact, null);
    persist();
    return artifact;
  }


  function syncTargetModuleState(artifact, decisionEntry) {
    const record = decisionEntry?.targetSync || buildTargetSync(artifact, null);
    const index = targetModuleState.findIndex(item => item.key === record.key || item.artifactId === artifact.id);
    const nextRecord = {
      ...record,
      decisionId: decisionEntry?.id || null,
      actionTaken: decisionEntry?.actionTaken || null,
      operator: decisionEntry?.operator || null,
      updatedAt: decisionEntry?.decidedAt || artifact.updatedAt || nowIso()
    };
    if (index >= 0) targetModuleState[index] = nextRecord;
    else targetModuleState.unshift(nextRecord);
    if (targetModuleState.length > 500) targetModuleState.length = 500;
  }

  function syncHistoryDecision(artifact, decisionEntry) {
    const entry = history.find(item => item.runId === artifact.runId);
    if (!entry) return;
    entry.artifact = { ...serializeArtifact(artifact) };
    entry.artifactId = artifact.id;
    entry.result = `Decision recorded: ${artifact.title} — ${decisionEntry.actionTaken}. Status is now ${decisionEntry.statusLabel}.`;
    entry.decision = decisionEntry;
    entry.updatedAt = decisionEntry.decidedAt;
    entry.actionResults = safeArray(entry.actionResults).concat({
      action: 'record_decision',
      ok: true,
      note: `${decisionEntry.actionTaken} -> ${decisionEntry.statusLabel}`,
      artifactId: artifact.id,
      targetModule: decisionEntry.targetModule
    });
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
      statusLabel: getStatusLabel('pending_review'),
      actionLabel: copy.actionLabel,
      destinationUrl: buildArtifactDestination(type, refs),
      decision: copy.decision,
      checklist: buildArtifactChecklist(type, refs),
      decisionActions: buildDecisionActions(type, refs),
      decisionHistory: [],
      decisionRequired: true,
      reviewState: 'pending',
      pendingReview: true,
      targetSync: null,
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
    artifact.targetSync = buildTargetSync(artifact, null, { syncState: 'awaiting_review' });
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
  function listAuditLog(limit = 200) { return auditLog.slice(0, limit); }
  function listTargetModuleState(moduleName = '', limit = 50) {
    const normalized = String(moduleName || '').toLowerCase();
    return targetModuleState
      .filter(item => !normalized || String(item.targetModule || item.module || '').toLowerCase().includes(normalized))
      .slice(0, limit);
  }
  function serializeArtifact(artifact) {
    return {
      ...artifact,
      statusLabel: getStatusLabel(artifact.status),
      decisionActions: artifact.decisionActions || buildDecisionActions(artifact.type, artifact.refs),
      decisionHistory: artifact.decisionHistory || [],
      auditTrail: auditLog.filter(entry => entry.artifactId === artifact.id).slice(0, 25),
      targetSync: artifact.targetSync || buildTargetSync(artifact, null),
      lifecycle: getArtifactLifecycle(artifact),
      lifecycleActions: getLifecycleActions(artifact)
    };
  }

  function listArtifacts(limit = 100, filters = {}) {
    const statusFilter = String(filters.status || '').trim();
    const reviewStateFilter = String(filters.reviewState || '').trim();
    return artifacts
      .filter((artifact) => {
        const lifecycle = getArtifactLifecycle(artifact);
        if (statusFilter && statusFilter !== 'all') {
          if (statusFilter === 'closed' && lifecycle.reviewState !== 'closed') return false;
          if (statusFilter !== 'closed' && lifecycle.status !== statusFilter) return false;
        }
        if (reviewStateFilter && reviewStateFilter !== 'all' && lifecycle.reviewState !== reviewStateFilter) return false;
        return true;
      })
      .slice(0, limit)
      .map(serializeArtifact);
  }
  function getArtifact(id) {
    const artifact = artifacts.find(item => item.id === id);
    return artifact ? serializeArtifact(artifact) : null;
  }

  function applyArtifactDecision(id, actionId, meta = {}) {
    const artifact = artifacts.find(item => item.id === id);
    if (!artifact) return { ok: false, status: 404, error: 'Automation result not found' };
    const action = (artifact.decisionActions || buildDecisionActions(artifact.type, artifact.refs)).find(item => item.id === actionId);
    if (!action) return { ok: false, status: 400, error: 'Decision action is not available for this result surface' };

    const previousStatus = artifact.status || 'pending_review';
    const decidedAt = nowIso();
    const pendingReview = isPendingReviewStatus(action.nextStatus);
    const reviewState = pendingReview ? 'pending' : 'closed';
    const targetSync = buildTargetSync(artifact, action, { decidedAt, previousStatus, reviewState, pendingReview, decidedBy: meta.decidedBy || 'staff', syncState: pendingReview ? 'awaiting_review' : 'synchronized' });
    const decisionEntry = {
      id: crypto.randomUUID(),
      artifactId: artifact.id,
      workflowId: artifact.workflowId,
      workflowName: artifact.workflowName,
      runId: artifact.runId,
      artifactType: artifact.type,
      itemTitle: artifact.title,
      actionId: action.id,
      actionTaken: action.label,
      label: action.label,
      previousStatus,
      nextStatus: action.nextStatus,
      statusLabel: getStatusLabel(action.nextStatus),
      targetModule: action.targetModule,
      targetUrl: action.targetUrl,
      decidedBy: meta.decidedBy || 'staff',
      operator: meta.decidedBy || 'staff',
      decidedAt,
      time: decidedAt,
      targetSync
    };

    artifact.status = action.nextStatus;
    artifact.statusLabel = decisionEntry.statusLabel;
    artifact.lastDecision = decisionEntry;
    artifact.decisionRequired = pendingReview;
    artifact.pendingReview = pendingReview;
    artifact.reviewState = reviewState;
    artifact.updatedAt = decidedAt;
    artifact.targetSync = targetSync;
    artifact.decisionHistory = [decisionEntry, ...(artifact.decisionHistory || [])].slice(0, 50);

    auditLog.unshift(decisionEntry);
    if (auditLog.length > 1000) auditLog.length = 1000;
    syncTargetModuleState(artifact, decisionEntry);
    syncHistoryDecision(artifact, decisionEntry);

    addNotification(
      `Automation decision recorded: ${artifact.title} — ${action.label}. Status is now ${decisionEntry.statusLabel}.`,
      'success',
      {
        artifactId: artifact.id,
        artifactType: artifact.type,
        actionId: action.id,
        decisionLabel: action.label,
        previousStatus,
        nextStatus: action.nextStatus,
        statusLabel: decisionEntry.statusLabel,
        targetModule: action.targetModule,
        destinationUrl: action.targetUrl,
        surface: artifact.surface,
        runId: artifact.runId,
        workflowId: artifact.workflowId,
        reviewState,
        pendingReview,
        targetSync
      }
    );

    persist();
    return { ok: true, status: 200, artifact: serializeArtifact(artifact), decision: decisionEntry, targetSync };
  }

  function applyArtifactLifecycleAction(id, lifecycleActionId, meta = {}) {
    const artifact = artifacts.find(item => item.id === id);
    if (!artifact) return { ok: false, status: 404, error: 'Automation result not found' };
    const action = getLifecycleActions(artifact).find(item => item.id === lifecycleActionId);
    if (!action) return { ok: false, status: 400, error: 'Lifecycle action is not available for this result surface' };

    const previousStatus = artifact.status || 'pending_review';
    const decidedAt = nowIso();
    const pendingReview = isPendingReviewStatus(action.nextStatus);
    const reviewState = pendingReview ? 'pending' : 'closed';
    const targetSync = buildTargetSync(artifact, action, {
      decidedAt,
      previousStatus,
      reviewState,
      pendingReview,
      decidedBy: meta.decidedBy || 'staff',
      syncState: pendingReview ? 'awaiting_review' : 'synchronized'
    });
    const decisionEntry = {
      id: crypto.randomUUID(),
      artifactId: artifact.id,
      workflowId: artifact.workflowId,
      workflowName: artifact.workflowName,
      runId: artifact.runId,
      artifactType: artifact.type,
      itemTitle: artifact.title,
      actionId: action.id,
      actionTaken: action.label,
      label: action.label,
      actionCategory: 'lifecycle',
      previousStatus,
      nextStatus: action.nextStatus,
      statusLabel: getStatusLabel(action.nextStatus),
      targetModule: action.targetModule,
      targetUrl: action.targetUrl,
      decidedBy: meta.decidedBy || 'staff',
      operator: meta.decidedBy || 'staff',
      decidedAt,
      time: decidedAt,
      targetSync
    };

    artifact.status = action.nextStatus;
    artifact.statusLabel = decisionEntry.statusLabel;
    artifact.lastDecision = decisionEntry;
    artifact.decisionRequired = pendingReview;
    artifact.pendingReview = pendingReview;
    artifact.reviewState = reviewState;
    artifact.updatedAt = decidedAt;
    artifact.targetSync = targetSync;
    artifact.decisionHistory = [decisionEntry, ...(artifact.decisionHistory || [])].slice(0, 50);

    auditLog.unshift(decisionEntry);
    if (auditLog.length > 1000) auditLog.length = 1000;
    syncTargetModuleState(artifact, decisionEntry);
    syncHistoryDecision(artifact, decisionEntry);

    addNotification(
      `Automation lifecycle updated: ${artifact.title} — ${action.label}. Status is now ${decisionEntry.statusLabel}.`,
      'success',
      {
        artifactId: artifact.id,
        artifactType: artifact.type,
        actionId: action.id,
        decisionLabel: action.label,
        actionCategory: 'lifecycle',
        previousStatus,
        nextStatus: action.nextStatus,
        statusLabel: decisionEntry.statusLabel,
        targetModule: action.targetModule,
        destinationUrl: action.targetUrl,
        surface: artifact.surface,
        runId: artifact.runId,
        workflowId: artifact.workflowId,
        reviewState,
        pendingReview,
        targetSync
      }
    );

    persist();
    return { ok: true, status: 200, artifact: serializeArtifact(artifact), decision: decisionEntry, targetSync };
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
    listAuditLog,
    listTargetModuleState,
    applyArtifactDecision,
    applyArtifactLifecycleAction,
    setWorkflowState,
    addNotification
  };
}

module.exports = { createAutomationHub };
