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
  'returned_to_capture',
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

const PHASE_2_STABILITY = {
  phase: 'Automation Hub Phase 2',
  status: 'stable',
  closedAt: '2026-05-16',
  summary: 'Lifecycle queues, closed decision separation, target sync, audit evidence, internal notifications, and controlled reopening/revision are validated as stable.',
  protectedBehaviors: [
    'Active queue membership is derived from durable review status.',
    'Closed and synchronized decisions remain outside active staff work.',
    'Audit trail entries are preserved for decisions and lifecycle corrections.',
    'Target-module synchronization state is recalculated without deleting evidence.',
    'Closed decisions can only be reopened or revised through explicit lifecycle actions.'
  ]
};

const PHASE_3_GROUNDWORK = {
  phase: 'Automation Hub Phase 3',
  status: 'live_event_validation',
  objective: 'Move from mostly staff-triggered review surfaces toward real operational automations that still separate automatic work from staff review.',
  implementedScope: [
    'Workflow definitions now expose trigger ownership, automatic-readiness, review requirements, and deeper handoff intent.',
    'Inbox, knowledge capture, and provider workflows can be classified as automatic operational triggers while preserving assisted staff review.',
    'Knowledge quick-capture and capture-assistant saves emit live Automation Hub triggers for formatting and triage review.',
    'Inbox webhook, provider document upload, provider duplicate check, knowledge capture, quick capture, and provider matching completion are mapped to explicit live event sources.',
    'Automation Hub API exposes phase-state and workflow readiness evidence for Phase 2 stability and Phase 3 rollout visibility.'
  ],
  rolloutGuardrails: [
    'No customer-facing autonomous send is enabled by this scaffold.',
    'Generated automation outputs still land as review artifacts unless a workflow is explicitly promoted later.',
    'Automatic event execution creates review artifacts; staff decision state remains separate and is never treated as automatic approval.',
    'Live Mode remains conservative; Phase 3 automation is limited to internal extraction, routing, matching, notification, and target handoff preparation.'
  ]
};

const WORKFLOW_DEFINITIONS = [
  {
    id: 'wf-provider-doc-extractor',
    name: 'Provider document uploaded → prepare provider extraction review',
    active: true,
    phase: 3,
    trigger: { type: 'document_uploaded', source: 'provider_document_vault', automatic: true },
    liveEventSource: 'POST /api/providers/:providerId/documents',
    eventHookStatus: 'live',
    staffReviewSurface: 'Provider Review Draft',
    executionMode: 'assisted',
    triggerOwnership: 'automatic_provider_workflow',
    automationReadiness: 'automatic_trigger_staff_review',
    reviewRequirement: 'staff_required_before_provider_record_update',
    handoffDepth: 'provider_document_to_review_draft',
    manualPayload: { module: 'providers', documentId: 'manual-provider-document-check' },
    conditions: [{ field: 'module', operator: 'eq', value: 'providers' }],
    actions: [{ type: 'run_extractor' }, { type: 'send_notification' }]
  },
  {
    id: 'wf-kb-capture-formatting',
    name: 'New captured knowledge → prepare KB formatting review',
    active: true,
    phase: 3,
    trigger: { type: 'new_captured_knowledge', source: 'knowledge_capture', automatic: true },
    liveEventSource: 'POST /api/kb-capture',
    eventHookStatus: 'live',
    staffReviewSurface: 'KB Suggestion Panel',
    executionMode: 'assisted',
    triggerOwnership: 'automatic_knowledge_workflow',
    automationReadiness: 'automatic_trigger_staff_review',
    reviewRequirement: 'staff_required_before_kb_publication',
    handoffDepth: 'capture_to_kb_suggestion_panel',
    manualPayload: { captureId: 'manual-kb-formatting-check' },
    conditions: [],
    actions: [{ type: 'run_matching_suggestion' }, { type: 'send_notification' }]
  },
  {
    id: 'wf-duplicate-alert',
    name: 'Duplicate detected → notify before official save',
    active: true,
    phase: 3,
    trigger: { type: 'duplicate_detected', source: 'provider_duplicate_check', automatic: true },
    liveEventSource: 'POST /api/providers/duplicate-check',
    eventHookStatus: 'live',
    staffReviewSurface: 'Duplicate Review Queue',
    executionMode: 'assisted',
    triggerOwnership: 'automatic_provider_workflow',
    automationReadiness: 'automatic_trigger_staff_review',
    reviewRequirement: 'staff_required_before_merge_or_separate_decision',
    handoffDepth: 'duplicate_signal_to_provider_queue',
    manualPayload: { duplicateScore: 0.98, duplicateId: 'manual-duplicate-check' },
    conditions: [{ field: 'duplicateScore', operator: 'gt', value: 0.75 }],
    actions: [{ type: 'send_notification' }]
  },
  {
    id: 'wf-inbox-service-helper',
    name: 'New inbox message with known service intent → prepare helper suggestion',
    active: true,
    phase: 3,
    trigger: { type: 'new_inbox_message', source: 'inbox_webhook', automatic: true },
    liveEventSource: 'POST /webhook (WhatsApp inbound message)',
    eventHookStatus: 'live',
    staffReviewSurface: 'Thread Suggestion / Routing Panel',
    executionMode: 'assisted',
    triggerOwnership: 'automatic_inbox_workflow',
    automationReadiness: 'automatic_trigger_staff_review',
    reviewRequirement: 'staff_required_before_client_facing_use',
    handoffDepth: 'inbox_message_to_thread_suggestion_panel',
    manualPayload: { serviceIntent: 'manual_service_intent_check', messageId: 'manual-inbox-helper-check' },
    conditions: [{ field: 'serviceIntent', operator: 'exists' }],
    actions: [{ type: 'run_matching_suggestion' }, { type: 'send_notification' }]
  },
  {
    id: 'wf-kb-quick-capture-intake',
    name: 'New quick capture → prepare KB triage review',
    active: true,
    phase: 3,
    trigger: { type: 'new_quick_capture', source: 'kb_quick_capture', automatic: true },
    liveEventSource: 'POST /api/kb/quick-capture',
    eventHookStatus: 'live',
    staffReviewSurface: 'KB Suggestion Panel',
    executionMode: 'assisted',
    triggerOwnership: 'automatic_knowledge_workflow',
    automationReadiness: 'automatic_trigger_staff_review',
    reviewRequirement: 'staff_required_before_kb_publication',
    handoffDepth: 'quick_capture_to_kb_suggestion_panel',
    manualPayload: { captureId: 'manual-kb-formatting-check', sourceType: 'manual' },
    conditions: [{ field: 'captureId', operator: 'exists' }],
    actions: [{ type: 'run_matching_suggestion' }, { type: 'send_notification' }]
  },
  {
    id: 'wf-manual-provider-rematch',
    name: 'Staff provider matching run → prepare results review',
    active: true,
    phase: 3,
    trigger: { type: 'provider_matching_completed', source: 'provider_matching_engine', automatic: false },
    liveEventSource: 'POST /api/providers/match',
    eventHookStatus: 'live_manual_staff_trigger',
    staffReviewSurface: 'Matching Results List',
    executionMode: 'manual',
    triggerOwnership: 'operator_triggered',
    automationReadiness: 'manual_staff_trigger_live',
    reviewRequirement: 'staff_required_for_matching_decision',
    handoffDepth: 'matching_request_to_results_panel',
    manualPayload: { matchingResultId: 'rerun_provider_matching', manualAction: 'rerun_provider_matching' },
    conditions: [{ field: 'matchingResultId', operator: 'exists' }],
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
    title: 'Knowledge formatting / triage review draft',
    module: 'Knowledge Base Manager',
    surface: 'KB Suggestion Panel',
    actionLabel: 'Review KB draft',
    decision: 'Review the formatting or triage suggestion, confirm official wording/category, then publish or keep it as a capture.'
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
  dismissed: 'Dismissed / no action needed',
  published: 'Published',
  returned_to_capture: 'Returned to capture',
  edit_requested: 'Staff edit needed',
  kept_separate: 'Kept separate',
  manual_ownership: 'Manual staff ownership',
  rerun_requested: 'Automation rerun needed'
};

const ARTIFACT_DECISION_ACTIONS = {
  provider_matching_results: [
    {
      id: 'shortlist_candidate',
      label: 'Shortlist candidate',
      nextStatus: 'shortlisted',
      targetModule: 'Provider Matching Engine',
      targetUrl: '/providers#matching-results',
      description: 'Move the provider candidate into an staff shortlist for staffing review.'
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
      label: 'Request matching rerun',
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
      label: 'Dismiss suggestion — no action needed',
      nextStatus: 'dismissed',
      targetModule: 'Inbox',
      targetUrl: '/#automation-inbox-helper',
      description: 'Dismiss the helper suggestion as not useful for this thread.'
    },
    {
      id: 'keep_manual_ownership',
      label: 'Keep manual staff ownership',
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
      description: 'Keep the draft in review and mark it for staff edits before approval.'
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
      label: 'Dismiss alert — no action needed',
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
    refs.providerId || refs.documentId || refs.captureId || refs.duplicateId || refs.threadId || refs.matchingResultId || artifact.id
  ].join(':');
}


const OPERATOR_REFERENCE_LABELS = {
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

function toOperatorReferenceLabel(value, fallback = '') {
  const text = compactRef(value, fallback);
  if (!text) return '';
  if (OPERATOR_REFERENCE_LABELS[text]) return OPERATOR_REFERENCE_LABELS[text];
  return text
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


function compactRef(value, fallback = '') {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || fallback;
}

function buildTargetReference(artifact = {}, action = null) {
  const refs = artifact.refs || {};
  const type = artifact.type || '';
  const status = action?.nextStatus || artifact.status || 'pending_review';
  const targetUrl = action?.targetUrl || artifact.destinationUrl || buildArtifactDestination(type, refs);
  const moduleName = action?.targetModule || artifact.module || 'Automation Hub';
  const pending = isPendingReviewStatus(status);
  const fallbackArtifact = compactRef(artifact.id, 'latest');

  if (type === 'provider_extraction_review') {
    const recordId = compactRef(refs.providerId, 'pending-provider-record');
    const recordLabel = refs.providerId ? `Provider record ${toOperatorReferenceLabel(refs.providerId)}` : 'Provider record pending final ID';
    const documentId = compactRef(refs.documentId, 'uploaded-provider-document');
    const documentLabel = toOperatorReferenceLabel(refs.documentId, 'Uploaded provider document');
    return {
      destinationRecordId: recordId,
      destinationDisplayLabel: recordLabel,
      destinationObjectType: 'Provider Management record',
      destinationObjectName: recordLabel,
      destinationPanel: 'Provider review and official provider records',
      destinationUrl: targetUrl,
      openTargetLabel: refs.providerId ? `Open ${recordLabel}` : 'Open provider review panel',
      sourceObjectId: documentId,
      sourceDisplayLabel: documentLabel,
      sourceObjectType: 'Provider document/extraction draft',
      traceLabel: `Provider extraction ${documentLabel} → ${recordLabel}`,
      verificationHint: pending
        ? 'Verify the reviewed extraction in Provider Management before it updates the official provider record.'
        : 'Provider Management shows this synchronized Automation Hub decision beside provider records and review drafts.'
    };
  }

  if (type === 'kb_formatting_review') {
    const captureId = compactRef(refs.captureId, fallbackArtifact);
    const captureLabel = toOperatorReferenceLabel(refs.captureId, 'Current knowledge capture');
    const recordId = status === 'published' ? `kb-record:${captureId}` : `kb-capture:${captureId}`;
    const destinationName = status === 'published' ? `Published KB item from ${captureLabel}` : `Knowledge capture item: ${captureLabel}`;
    return {
      destinationRecordId: recordId,
      destinationDisplayLabel: destinationName,
      destinationObjectType: status === 'published' ? 'Knowledge Base record' : 'Knowledge capture item',
      destinationObjectName: destinationName,
      destinationPanel: status === 'published' ? 'Knowledge Base publication panel' : 'Quick Capture and KB suggestion panel',
      destinationUrl: targetUrl,
      openTargetLabel: status === 'published' ? 'Open published KB item' : 'Open KB synchronized item',
      sourceObjectId: captureId,
      sourceDisplayLabel: captureLabel,
      sourceObjectType: 'Knowledge formatting draft',
      traceLabel: `KB formatting draft ${captureLabel} → ${destinationName}`,
      verificationHint: pending
        ? 'Verify title, category, source context, and duplicate risk in Knowledge Base before publication.'
        : 'Knowledge Base shows the synchronized decision in its Automation Hub decision panel.'
    };
  }

  if (type === 'inbox_helper_panel') {
    const threadId = compactRef(refs.threadId, compactRef(refs.messageId, 'current-inbox-thread'));
    const threadLabel = refs.threadId ? `Inbox thread ${toOperatorReferenceLabel(refs.threadId)}` : 'Current inbox helper suggestion';
    return {
      destinationRecordId: threadId,
      destinationDisplayLabel: threadLabel,
      destinationObjectType: 'Inbox thread/panel state',
      destinationObjectName: threadLabel,
      destinationPanel: 'Thread Suggestion / Routing Panel',
      destinationUrl: targetUrl,
      openTargetLabel: refs.threadId ? 'Open inbox thread' : 'Open inbox helper panel',
      sourceObjectId: compactRef(refs.messageId, 'latest-message'),
      sourceDisplayLabel: toOperatorReferenceLabel(refs.messageId, 'Latest inbox message'),
      sourceObjectType: 'Inbox helper suggestion',
      traceLabel: `Inbox helper suggestion → ${threadLabel}`,
      verificationHint: pending
        ? 'Verify the service-intent suggestion inside the related inbox thread before any client-facing use.'
        : 'Inbox shows this synchronized Automation Hub decision near the Communications Hub thread work area.'
    };
  }

  if (type === 'duplicate_review_queue') {
    const duplicateId = compactRef(refs.duplicateId, 'latest-duplicate-candidate');
    const duplicateLabel = toOperatorReferenceLabel(refs.duplicateId, 'Latest duplicate candidate');
    const stateName = status === 'kept_separate' ? 'kept separate' : status === 'merged' ? 'merged' : status === 'dismissed' ? 'dismissed' : 'awaiting review';
    const destinationName = `Duplicate review ${stateName}: ${duplicateLabel}`;
    return {
      destinationRecordId: duplicateId,
      destinationDisplayLabel: destinationName,
      destinationObjectType: 'Provider Management duplicate state',
      destinationObjectName: destinationName,
      destinationPanel: 'Duplicate Review Queue and Provider Capture Assistant',
      destinationUrl: targetUrl,
      openTargetLabel: status === 'kept_separate' ? 'View kept-separate state' : 'Open duplicate review item',
      sourceObjectId: duplicateId,
      sourceDisplayLabel: duplicateLabel,
      sourceObjectType: 'Duplicate review queue item',
      traceLabel: `Duplicate review ${duplicateLabel} → ${stateName}`,
      verificationHint: pending
        ? 'Verify the duplicate candidate in Provider Management before creating or updating the official provider record.'
        : 'Provider Management shows whether the duplicate signal was merged, dismissed, or kept separate.'
    };
  }

  if (type === 'provider_matching_results') {
    const providerId = compactRef(refs.providerId || refs.matchingResultId || refs.duplicateId, 'matching-result-set');
    const providerLabel = toOperatorReferenceLabel(refs.providerId || refs.matchingResultId || refs.duplicateId, 'Provider matching result set');
    const objectName = status === 'confirmed' ? `Confirmed provider match: ${providerLabel}` : status === 'shortlisted' ? `Provider shortlist: ${providerLabel}` : providerLabel;
    return {
      destinationRecordId: providerId,
      destinationDisplayLabel: objectName,
      destinationObjectType: 'Provider matching/provider target state',
      destinationObjectName: objectName,
      destinationPanel: 'Provider Matching Engine results',
      destinationUrl: targetUrl,
      openTargetLabel: status === 'confirmed' ? 'Open confirmed provider target' : 'Open matching results',
      sourceObjectId: compactRef(artifact.runId, fallbackArtifact),
      sourceDisplayLabel: 'Provider matching run',
      sourceObjectType: 'Provider matching run',
      traceLabel: `Provider matching run → ${objectName}`,
      verificationHint: pending
        ? 'Verify ranked candidates and matching criteria in the Provider Matching Engine before confirming or shortlisting.'
        : 'Provider Management shows the synchronized matching decision beside the matching results panel.'
    };
  }

  return {
    destinationRecordId: fallbackArtifact,
    destinationDisplayLabel: artifact.title || toOperatorReferenceLabel(fallbackArtifact, 'Automation result'),
    destinationObjectType: moduleName,
    destinationObjectName: artifact.title || 'Automation result',
    destinationPanel: artifact.surface || moduleName,
    destinationUrl: targetUrl,
    openTargetLabel: 'Open synchronized item',
    sourceObjectId: fallbackArtifact,
    sourceDisplayLabel: toOperatorReferenceLabel(fallbackArtifact, 'Automation result'),
    sourceObjectType: artifact.type || 'automation artifact',
    traceLabel: `${artifact.title || 'Automation result'} → ${moduleName}`,
    verificationHint: pending ? 'Verify the pending automation result in its target module.' : 'Target module shows the synchronized automation decision.'
  };
}

function buildTargetSync(artifact = {}, action = null, extras = {}) {
  const status = action?.nextStatus || artifact.status || 'pending_review';
  const statusLabel = getStatusLabel(status);
  const pendingReview = extras.pendingReview ?? isPendingReviewStatus(status);
  const reviewState = extras.reviewState || (pendingReview ? 'pending' : 'closed');
  const syncState = extras.syncState || (reviewState === 'closed' ? 'synchronized' : 'awaiting_review');
  const targetReference = buildTargetReference(artifact, action);
  return {
    key: getTargetRecordKey(artifact),
    artifactId: artifact.id,
    artifactType: artifact.type,
    title: artifact.title,
    module: artifact.module,
    surface: artifact.surface,
    targetModule: action?.targetModule || artifact.module,
    targetUrl: targetReference.destinationUrl || action?.targetUrl || artifact.destinationUrl,
    targetReference,
    destinationRecordId: targetReference.destinationRecordId,
    destinationDisplayLabel: targetReference.destinationDisplayLabel || targetReference.destinationObjectName || targetReference.destinationRecordId,
    sourceDisplayLabel: targetReference.sourceDisplayLabel || targetReference.sourceObjectId,
    destinationObjectType: targetReference.destinationObjectType,
    destinationObjectName: targetReference.destinationObjectName,
    destinationPanel: targetReference.destinationPanel,
    openTargetLabel: targetReference.openTargetLabel,
    verificationHint: targetReference.verificationHint,
    status,
    statusLabel,
    pendingReview,
    reviewState,
    syncState,
    syncLabel: syncState === 'synchronized' ? 'Synchronized to target module' : 'Pending staff review',
    syncConfirmation: syncState === 'synchronized'
      ? `${action?.targetModule || artifact.module} accepted ${statusLabel} from Automation Hub for ${targetReference.destinationDisplayLabel || targetReference.destinationObjectName}.`
      : `${action?.targetModule || artifact.module} is waiting for a staff decision before final sync to ${targetReference.destinationPanel}.`,
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
  if (workflowId === 'wf-kb-quick-capture-intake') return 'kb_formatting_review';
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
    matchingResultId: payload.matchingResultId || payload.matchRunId || null,
    requestType: payload.requestType || payload.request_type || null,
    module: payload.module || null
  };
}


function resolveDecisionTargetUrl(type, action, refs = {}) {
  if (type === 'provider_extraction_review') return refs.providerId ? `/providers#provider-record-${encodeURIComponent(refs.providerId)}` : `/providers#automation-artifact-${refs.documentId || 'latest'}`;
  if (type === 'kb_formatting_review') {
    if (action.id === 'approve_to_kb') return `/kb#automation-publish-${refs.captureId || 'latest'}`;
    if (action.id === 'return_to_capture') return `/kb#quick-capture-${refs.captureId || 'latest'}`;
    return `/kb#automation-artifact-${refs.captureId || 'latest'}`;
  }
  if (type === 'duplicate_review_queue') return `/providers#duplicate-review-${refs.duplicateId || 'latest'}`;
  if (type === 'inbox_helper_panel') return refs.threadId ? `/#thread-${encodeURIComponent(refs.threadId)}` : action.targetUrl;
  if (type === 'provider_matching_results') return refs.providerId ? `/providers#provider-record-${encodeURIComponent(refs.providerId)}` : '/providers#matching-results';
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
      label: 'Reopen staff review',
      nextStatus: 'pending_review',
      statusLabel: getStatusLabel('pending_review'),
      targetModule,
      targetUrl,
      description: 'Move this closed card back to pending review while preserving every audit entry.'
    });
  }

  if (safeArray(policy.reviseStatuses).includes(status)) {
    const nextStatus = policy.reviseStatus || 'edit_requested';
    actions.push({
      id: 'revise_item',
      label: policy.reviseLabel || (nextStatus === 'rerun_requested' ? 'Request new automation run' : 'Send back for staff edits'),
      nextStatus,
      statusLabel: getStatusLabel(nextStatus),
      targetModule,
      targetUrl,
      description: nextStatus === 'rerun_requested' ? 'Mark the closed decision as needing a new matching run while preserving the audit trail.' : 'Mark the closed decision as needing staff edits while preserving the audit trail.'
    });
  }

  return actions;
}

function getArtifactLifecycle(artifact = {}) {
  const status = artifact.status || 'pending_review';
  // Treat the durable status as the source of truth. Older persisted artifacts can
  // carry stale pendingReview/reviewState booleans after Phase 2 decisions, so
  // recompute queue membership from the status every time artifacts are listed.
  const pendingReview = isPendingReviewStatus(status);
  const reviewState = pendingReview ? 'pending' : 'closed';
  return {
    status,
    statusLabel: getStatusLabel(status),
    reviewState,
    pendingReview,
    closed: !pendingReview,
    synchronized: artifact.targetSync?.syncState === 'synchronized' || (!pendingReview && Boolean(artifact.targetSync?.syncedAt)),
    canReopenOrRevise: getLifecycleActions({ ...artifact, pendingReview, reviewState }).length > 0
  };
}

function normalizeTargetSyncForLifecycle(artifact = {}) {
  const lifecycle = getArtifactLifecycle(artifact);
  const current = artifact.targetSync || {};
  const currentStatusMatches = current.status === lifecycle.status
    && current.reviewState === lifecycle.reviewState
    && current.pendingReview === lifecycle.pendingReview
    && current.syncState === (lifecycle.pendingReview ? 'awaiting_review' : 'synchronized');

  if (currentStatusMatches) return current;

  const lastDecision = artifact.lastDecision || {};
  const action = lastDecision.actionId ? {
    id: lastDecision.actionId,
    label: lastDecision.actionTaken || lastDecision.label,
    nextStatus: lifecycle.status,
    targetModule: lastDecision.targetModule,
    targetUrl: lastDecision.targetUrl
  } : null;

  return buildTargetSync(artifact, action, {
    reviewState: lifecycle.reviewState,
    pendingReview: lifecycle.pendingReview,
    syncState: lifecycle.pendingReview ? 'awaiting_review' : 'synchronized',
    decidedAt: artifact.updatedAt || artifact.createdAt || nowIso(),
    decidedBy: lastDecision.decidedBy || lastDecision.operator || null
  });
}

function getStatusLabel(status) {
  return ARTIFACT_STATUS_LABELS[status] || status || 'Pending review';
}

function buildArtifactDestination(type, refs) {
  if (type === 'provider_extraction_review') return refs.providerId ? `/providers#provider-record-${encodeURIComponent(refs.providerId)}` : `/providers#automation-artifact-${refs.documentId || 'latest'}`;
  if (type === 'kb_formatting_review') return `/kb#automation-artifact-${refs.captureId || 'latest'}`;
  if (type === 'duplicate_review_queue') return `/providers#duplicate-review-${refs.duplicateId || 'latest'}`;
  if (type === 'inbox_helper_panel') return refs.threadId ? `/#thread-${encodeURIComponent(refs.threadId)}` : '/#automation-inbox-helper';
  if (type === 'provider_matching_results') return refs.providerId ? `/providers#provider-record-${encodeURIComponent(refs.providerId)}` : '/providers#matching-results';
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


function getExecutionClassification(wf = {}, meta = {}) {
  if (meta.manual) {
    return {
      executionMode: 'manual',
      automationOrigin: 'operator_triggered',
      automationExecutionState: 'manual_staff_event_fired',
      isAutomaticEvent: false
    };
  }
  if (wf.trigger?.automatic) {
    return {
      executionMode: wf.executionMode || 'assisted',
      automationOrigin: 'automatic_trigger',
      automationExecutionState: 'automatic_event_fired',
      isAutomaticEvent: true
    };
  }
  return {
    executionMode: wf.executionMode || 'manual',
    automationOrigin: 'system_trigger',
    automationExecutionState: 'system_event_fired',
    isAutomaticEvent: false
  };
}

function createAutomationHub({ getSystemMode, persistencePath } = {}) {
  const defaultState = { notifications: [], history: [], artifacts: [], auditLog: [], targetModuleState: [], workflowStates: {} };
  const persistedState = loadPersistedState(persistencePath, defaultState);
  const notifications = safeArray(persistedState.notifications);
  const history = safeArray(persistedState.history);
  const artifacts = safeArray(persistedState.artifacts);
  const auditLog = safeArray(persistedState.auditLog);
  const targetModuleState = safeArray(persistedState.targetModuleState);
  const workflowStates = persistedState.workflowStates && typeof persistedState.workflowStates === 'object' ? persistedState.workflowStates : {};
  const workflows = WORKFLOW_DEFINITIONS.map((definition) => {
    const wf = buildWorkflow(definition);
    if (Object.prototype.hasOwnProperty.call(workflowStates, wf.id)) wf.active = Boolean(workflowStates[wf.id]);
    return wf;
  });
  hydrateWorkflowStatsFromHistory(workflows, history);

  function persist() {
    persistState(persistencePath, { notifications, history, artifacts, auditLog, targetModuleState, workflowStates });
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
    const nextRecord = {
      ...record,
      decisionId: decisionEntry?.id || null,
      actionTaken: decisionEntry?.actionTaken || null,
      operator: decisionEntry?.operator || null,
      updatedAt: decisionEntry?.decidedAt || artifact.updatedAt || nowIso()
    };
    const sameArtifactIndex = targetModuleState.findIndex(item => item.artifactId === artifact.id);
    const sameKeyIndex = targetModuleState.findIndex(item => item.key === record.key);
    const sameKeyRecord = sameKeyIndex >= 0 ? targetModuleState[sameKeyIndex] : null;
    const nextIsClosedSync = nextRecord.reviewState === 'closed' && nextRecord.syncState === 'synchronized' && !nextRecord.pendingReview;
    const nextIsActiveReview = nextRecord.reviewState !== 'closed' || nextRecord.pendingReview || nextRecord.syncState !== 'synchronized';
    const existingSameKeyIsClosedSync = sameKeyRecord
      && sameKeyRecord.reviewState === 'closed'
      && sameKeyRecord.syncState === 'synchronized'
      && !sameKeyRecord.pendingReview;

    if (nextIsClosedSync) {
      const replaceIndex = sameKeyIndex >= 0 ? sameKeyIndex : sameArtifactIndex;
      if (replaceIndex >= 0) targetModuleState[replaceIndex] = nextRecord;
      else targetModuleState.unshift(nextRecord);

      for (let index = targetModuleState.length - 1; index >= 0; index -= 1) {
        if (targetModuleState[index] !== nextRecord && (targetModuleState[index].key === record.key || targetModuleState[index].artifactId === artifact.id)) {
          targetModuleState.splice(index, 1);
        }
      }
    } else if (sameArtifactIndex >= 0) {
      targetModuleState[sameArtifactIndex] = nextRecord;
    } else if (nextIsActiveReview && existingSameKeyIsClosedSync) {
      targetModuleState.unshift(nextRecord);
    } else if (sameKeyIndex >= 0) {
      targetModuleState[sameKeyIndex] = nextRecord;
    } else {
      targetModuleState.unshift(nextRecord);
    }

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
      targetModule: decisionEntry.targetModule,
      targetReference: decisionEntry.targetSync?.targetReference || null,
      destinationRecordId: decisionEntry.targetSync?.destinationRecordId || null,
      targetUrl: decisionEntry.targetUrl
    });
  }

  function createRunArtifact({ wf, runId, triggerType, payload, meta, startedAt }) {
    const execution = getExecutionClassification(wf, meta);
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
      executionMode: execution.executionMode,
      initiatedBy: meta.initiatedBy || 'system',
      source: meta.source || wf.trigger?.source || null,
      liveEventSource: wf.liveEventSource || null,
      eventHookStatus: wf.eventHookStatus || null,
      staffReviewSurface: wf.staffReviewSurface || copy.surface,
      automationExecutionState: execution.automationExecutionState,
      staffReviewState: 'pending_staff_review',
      automationOrigin: execution.automationOrigin,
      automationReadiness: wf.automationReadiness || null,
      reviewRequirement: wf.reviewRequirement || null,
      handoffDepth: wf.handoffDepth || null,
      phase: wf.phase || 2,
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
    const execution = getExecutionClassification(wf, meta);
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
      executionMode: execution.executionMode,
      initiatedBy: meta.initiatedBy || 'system',
      automationOrigin: execution.automationOrigin,
      liveEventSource: wf.liveEventSource || null,
      eventHookStatus: wf.eventHookStatus || null,
      staffReviewSurface: wf.staffReviewSurface || artifact?.surface || null,
      automationExecutionState: execution.automationExecutionState,
      staffReviewState: artifact ? 'pending_staff_review' : null,
      automationReadiness: wf.automationReadiness || null,
      reviewRequirement: wf.reviewRequirement || null,
      handoffDepth: wf.handoffDepth || null,
      phase: wf.phase || 2,
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
        automationOrigin: entry.automationOrigin,
        automationReadiness: entry.automationReadiness,
        reviewRequirement: entry.reviewRequirement,
        handoffDepth: entry.handoffDepth,
        liveEventSource: entry.liveEventSource,
        eventHookStatus: entry.eventHookStatus,
        staffReviewSurface: entry.staffReviewSurface,
        automationExecutionState: entry.automationExecutionState,
        staffReviewState: entry.staffReviewState,
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

  function getPhaseState() {
    return {
      phase2: PHASE_2_STABILITY,
      phase3: PHASE_3_GROUNDWORK,
      workflowReadiness: workflows.map(wf => ({
        id: wf.id,
        name: wf.name,
        phase: wf.phase || 2,
        active: wf.active,
        triggerType: wf.trigger?.type || null,
        triggerSource: wf.trigger?.source || null,
        automaticTrigger: Boolean(wf.trigger?.automatic),
        automaticEventLive: Boolean(wf.trigger?.automatic && wf.eventHookStatus === 'live'),
        manualStaffTriggerLive: Boolean(!wf.trigger?.automatic && wf.eventHookStatus === 'live_manual_staff_trigger'),
        executionMode: wf.executionMode,
        automationReadiness: wf.automationReadiness || null,
        reviewRequirement: wf.reviewRequirement || null,
        handoffDepth: wf.handoffDepth || null,
        liveEventSource: wf.liveEventSource || null,
        eventHookStatus: wf.eventHookStatus || null,
        staffReviewSurface: wf.staffReviewSurface || null,
        trulyLive: wf.eventHookStatus === 'live' || wf.eventHookStatus === 'live_manual_staff_trigger',
        scaffoldOnly: wf.eventHookStatus !== 'live' && wf.eventHookStatus !== 'live_manual_staff_trigger'
      }))
    };
  }

  function listWorkflows() {
    return workflows.map(wf => ({
      id: wf.id,
      name: wf.name,
      active: wf.active,
      trigger: { ...wf.trigger },
      executionMode: wf.executionMode,
      phase: wf.phase || 2,
      triggerOwnership: wf.triggerOwnership || null,
      automationReadiness: wf.automationReadiness || null,
      reviewRequirement: wf.reviewRequirement || null,
      handoffDepth: wf.handoffDepth || null,
      liveEventSource: wf.liveEventSource || null,
      eventHookStatus: wf.eventHookStatus || null,
      staffReviewSurface: wf.staffReviewSurface || null,
      conditions: wf.conditions.map(item => ({ ...item })),
      actions: wf.actions.map(item => ({ ...item })),
      stats: { ...wf.stats }
    }));
  }

  function listHistory(limit = 100) { return history.slice(0, limit); }
  function listNotifications(limit = 30) { return notifications.slice(0, limit); }
  function listAuditLog(limit = 200) { return auditLog.slice(0, limit); }
  function listTargetModuleState(moduleName = '', limit = 50, options = {}) {
    const normalized = String(moduleName || '').toLowerCase();
    const includeActive = Boolean(options.includeActive);
    const currentByArtifactId = new Map(artifacts.map((artifact) => [artifact.id, serializeArtifact(artifact).targetSync]));
    return targetModuleState
      .map((item) => {
        const current = currentByArtifactId.get(item.artifactId);
        if (!current) return item;
        return {
          ...item,
          ...current,
          decisionId: item.decisionId || null,
          actionTaken: item.actionTaken || current.lastActionLabel || null,
          operator: item.operator || current.lastOperator || null
        };
      })
      .filter((item) => {
        if (normalized && !String(item.targetModule || item.module || '').toLowerCase().includes(normalized)) return false;
        if (includeActive) return true;
        return item.reviewState === 'closed' && item.syncState === 'synchronized' && !item.pendingReview;
      })
      .slice(0, limit);
  }
  function serializeArtifact(artifact) {
    return {
      ...artifact,
      statusLabel: getStatusLabel(artifact.status),
      decisionActions: artifact.decisionActions || buildDecisionActions(artifact.type, artifact.refs),
      decisionHistory: artifact.decisionHistory || [],
      auditTrail: auditLog.filter(entry => entry.artifactId === artifact.id).slice(0, 25),
      targetSync: normalizeTargetSyncForLifecycle(artifact),
      lifecycle: getArtifactLifecycle(artifact),
      lifecycleActions: getLifecycleActions(artifact)
    };
  }

  function listArtifacts(limit = 100, filters = {}) {
    const statusFilter = String(filters.status || '').trim();
    const rawReviewStateFilter = String(filters.reviewState || '').trim();
    const reviewStateFilter = rawReviewStateFilter === 'active' ? 'pending' : rawReviewStateFilter;
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
    const lifecycle = getArtifactLifecycle(artifact);
    if (lifecycle.closed) {
      return { ok: false, status: 409, error: 'This Automation Hub item is closed. Use lifecycle correction to reopen or revise it before recording another decision.' };
    }
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
      targetUrl: targetSync.targetUrl || action.targetUrl,
      targetReference: targetSync.targetReference,
      destinationRecordId: targetSync.destinationRecordId,
      destinationDisplayLabel: targetSync.destinationDisplayLabel,
      destinationObjectName: targetSync.destinationObjectName,
      destinationPanel: targetSync.destinationPanel,
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
        destinationUrl: targetSync.targetUrl || action.targetUrl,
        destinationRecordId: targetSync.destinationRecordId,
        destinationObjectName: targetSync.destinationObjectName,
        destinationPanel: targetSync.destinationPanel,
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
      targetUrl: targetSync.targetUrl || action.targetUrl,
      targetReference: targetSync.targetReference,
      destinationRecordId: targetSync.destinationRecordId,
      destinationDisplayLabel: targetSync.destinationDisplayLabel,
      destinationObjectName: targetSync.destinationObjectName,
      destinationPanel: targetSync.destinationPanel,
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
        destinationUrl: targetSync.targetUrl || action.targetUrl,
        destinationRecordId: targetSync.destinationRecordId,
        destinationObjectName: targetSync.destinationObjectName,
        destinationPanel: targetSync.destinationPanel,
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
    workflowStates[id] = wf.active;
    persist();
    return { ...wf, stats: { ...wf.stats } };
  }

  return {
    trigger,
    runWorkflowById,
    getPhaseState,
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
