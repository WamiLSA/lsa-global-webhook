const assert = require('assert');
const { createAutomationHub } = require('../lib/automation-hub');


const STABLE_OPERATOR_OPEN_LABELS = new Set([
  'Open review draft',
  'Open provider review panel',
  'Open published KB item',
  'Open KB draft',
  'Open inbox helper panel',
  'Open thread panel',
  'Open duplicate review item',
  'Open matching results',
  'Open provider record',
  'Open confirmed provider target'
]);

function assertStableOperatorLabel(label, context) {
  assert.ok(STABLE_OPERATOR_OPEN_LABELS.has(label), `${context} should use a stable operator destination label; received "${label}"`);
}

function assertStableOperatorLabelsForArtifact(artifact, context) {
  assertNoForbiddenOperatorLabels([artifact.actionLabel, artifact.targetSync.openTargetLabel, artifact.targetSync.openTargetPayload.openTargetLabel], context);
  assertStableOperatorLabel(artifact.actionLabel, `${context} artifact action`);
  assertStableOperatorLabel(artifact.targetSync.openTargetLabel, `${context} target sync action`);
  assertStableOperatorLabel(artifact.targetSync.openTargetPayload.openTargetLabel, `${context} target payload action`);
}

const FORBIDDEN_GENERIC_OPERATOR_LABELS = [
  'Open result',
  'Open results',
  'Open queue',
  'Open review surface'
];

function assertNoForbiddenOperatorLabels(labels, context) {
  for (const label of labels.filter(Boolean)) {
    assert.ok(!FORBIDDEN_GENERIC_OPERATOR_LABELS.includes(label), `${context} must not expose generic operator label "${label}"`);
  }
}

const REQUIRED_TARGET_FIELDS = [
  'targetModule',
  'destinationRecordId',
  'destinationObjectType',
  'panelLocation',
  'syncState'
];

function assertStableTargetPayload(sync, label) {
  assert.ok(sync, `${label} should include target sync evidence`);
  const payload = sync.openTargetPayload;
  assert.ok(payload, `${label} should include a stable openTargetPayload`);
  for (const field of REQUIRED_TARGET_FIELDS) {
    assert.ok(payload[field], `${label} openTargetPayload.${field} should be present`);
  }
  assert.strictEqual(payload.targetModule, sync.targetModule, `${label} payload target module should match target sync`);
  assert.strictEqual(payload.destinationRecordId, sync.destinationRecordId, `${label} payload destination record should match target sync`);
  assert.strictEqual(payload.destinationObjectType, sync.destinationObjectType, `${label} payload object type should match target sync`);
  assert.strictEqual(payload.panelLocation, sync.destinationPanel, `${label} payload panel/location should match target sync`);
  assert.strictEqual(payload.syncState, sync.syncState, `${label} payload sync state should match target sync`);
  assert.strictEqual(payload.reviewState, sync.reviewState, `${label} payload review state should match target sync`);
  assert.strictEqual(payload.destinationUrl, sync.targetUrl, `${label} payload destination URL should match the click-through URL`);
  assert.ok(sync.targetUrl || payload.destinationUrl, `${label} should include a destination URL`);
}

function assertExactClickThrough(sync, expected, label) {
  assertStableTargetPayload(sync, label);
  assert.strictEqual(sync.targetModule, expected.targetModule, `${label} should open the exact target module`);
  assert.strictEqual(sync.destinationRecordId, expected.destinationRecordId, `${label} should open the exact destination record id`);
  assert.strictEqual(sync.destinationObjectType, expected.destinationObjectType, `${label} should open the exact object type`);
  assert.strictEqual(sync.destinationPanel, expected.destinationPanel, `${label} should open the exact panel/location`);
  assert.strictEqual(sync.syncState, expected.syncState, `${label} should preserve the exact sync state`);
  assert.strictEqual(sync.openTargetPayload.openTargetLabel, sync.openTargetLabel, `${label} visible action label should match target sync metadata`);
  assertNoForbiddenOperatorLabels([sync.openTargetLabel, sync.openTargetPayload.openTargetLabel], label);
  assertStableOperatorLabel(sync.openTargetLabel, `${label} visible target action`);
}

function assertLiveArtifact(artifact, expected) {
  assert.strictEqual(artifact.type, expected.type, `${expected.triggerType} should create the expected review artifact`);
  assert.strictEqual(artifact.automationOrigin, expected.origin, `${expected.triggerType} should preserve execution source`);
  assert.strictEqual(artifact.triggerOwnership, expected.triggerOwnership, `${expected.triggerType} should preserve trigger ownership`);
  assert.strictEqual(artifact.automationReadiness, expected.automationReadiness, `${expected.triggerType} should preserve automation readiness`);
  assert.strictEqual(artifact.reviewRequirement, expected.reviewRequirement, `${expected.triggerType} should preserve staff review requirement`);
  assert.strictEqual(artifact.handoffDepth, expected.handoffDepth, `${expected.triggerType} should preserve handoff intent`);
  assert.strictEqual(artifact.staffReviewState, 'pending_staff_review', `${expected.triggerType} should require staff review`);
  assert.strictEqual(artifact.targetSync.syncState, 'awaiting_review', `${expected.triggerType} should wait for staff review before sync`);
  assertExactClickThrough(artifact.targetSync, expected.clickTarget, expected.triggerType);
}

async function main() {
  const hub = createAutomationHub({ getSystemMode: () => 'test' });

  const providerRuns = await hub.trigger('document_uploaded', {
    module: 'providers',
    providerId: 'provider-1',
    documentId: 'document-1'
  }, { source: 'provider-document-upload' });

  assert.strictEqual(providerRuns.length, 1, 'provider document upload should fire one automatic workflow');
  assert.strictEqual(providerRuns[0].automationOrigin, 'automatic_trigger');
  assert.strictEqual(providerRuns[0].automationExecutionState, 'automatic_event_fired');
  assert.strictEqual(providerRuns[0].staffReviewState, 'pending_staff_review');

  const automaticArtifact = hub.listArtifacts()[0];
  assert.strictEqual(automaticArtifact.reviewState, 'pending');
  assert.strictEqual(automaticArtifact.targetSync.syncState, 'awaiting_review');
  assertExactClickThrough(automaticArtifact.targetSync, { targetModule: 'Provider Management', destinationRecordId: 'provider-1', destinationObjectType: 'Provider Management record', destinationPanel: 'Provider review and official provider records', syncState: 'awaiting_review' }, 'provider document upload artifact');
  assert.strictEqual(hub.listTargetModuleState('Provider Management').length, 0, 'pending review items must not appear as closed synchronized module decisions');
  assert.strictEqual(hub.listTargetModuleState('Provider Management', 50, { includeActive: true }).length, 1, 'diagnostic module state can include active pending items when explicitly requested');

  const manualRun = await hub.runWorkflowById('wf-provider-doc-extractor', { initiatedBy: 'reviewer' });
  assert.strictEqual(manualRun.ok, true);
  assert.strictEqual(manualRun.run.automationOrigin, 'operator_triggered');
  assert.strictEqual(manualRun.run.automationExecutionState, 'manual_staff_event_fired');
  assert.strictEqual(manualRun.run.artifact.automationOrigin, 'operator_triggered');
  assert.strictEqual(manualRun.run.artifact.automationExecutionState, 'manual_staff_event_fired');
  const providerWorkflowAfterManualRun = hub.listWorkflows().find((wf) => wf.id === 'wf-provider-doc-extractor');
  assert.strictEqual(providerWorkflowAfterManualRun.stats.lastArtifactActionLabel, 'Open review draft', 'top workflow card should use the latest artifact precise review-draft label');
  assert.strictEqual(providerWorkflowAfterManualRun.stats.lastArtifactTargetSync.openTargetLabel, 'Open provider review panel', 'top workflow card payload should preserve the precise provider-review-panel target label');
  assertStableTargetPayload(providerWorkflowAfterManualRun.stats.lastArtifactTargetSync, 'top workflow provider latest output');

  const decision = hub.applyArtifactDecision(automaticArtifact.id, 'approve_into_provider_record', { decidedBy: 'qa' });
  assert.strictEqual(decision.ok, true);
  assert.strictEqual(decision.artifact.lifecycle.reviewState, 'closed');
  assert.strictEqual(decision.artifact.lifecycle.synchronized, true);
  assertExactClickThrough(decision.artifact.targetSync, { targetModule: 'Provider Management', destinationRecordId: 'provider-1', destinationObjectType: 'Provider Management record', destinationPanel: 'Provider review and official provider records', syncState: 'synchronized' }, 'closed provider decision');
  const closedProviderState = hub.listTargetModuleState('Provider Management');
  assert.strictEqual(closedProviderState.length, 1, 'closed decision should synchronize back to target module');
  assert.strictEqual(closedProviderState[0].artifactId, automaticArtifact.id, 'closed synchronized target row should point to the approved artifact');
  assertStableTargetPayload(closedProviderState[0], 'closed provider target state');
  assert.strictEqual(hub.listAuditLog().length, 1, 'decision audit trail should be preserved');
  assert.ok(hub.listNotifications().some((item) => /Automation decision recorded/.test(item.message) && item.details?.notificationType === 'decision_recorded'), 'decision should create a typed internal notification');

  const sameTargetRuns = await hub.trigger('document_uploaded', {
    module: 'providers',
    providerId: 'provider-1',
    documentId: 'document-1'
  }, { source: 'provider-document-upload' });
  assert.strictEqual(sameTargetRuns.length, 1, 'same target document upload should create a new active review artifact');
  const sameTargetArtifact = sameTargetRuns[0].artifact;
  assert.notStrictEqual(sameTargetArtifact.id, automaticArtifact.id, 'same-key active artifact should be a new review item');

  const defaultProviderStateAfterSameKeyActive = hub.listTargetModuleState('Provider Management');
  assert.strictEqual(defaultProviderStateAfterSameKeyActive.length, 1, 'same-key active review item must not erase the closed synchronized target view');
  assert.strictEqual(defaultProviderStateAfterSameKeyActive[0].artifactId, automaticArtifact.id, 'default target view should preserve the prior closed synchronized decision');
  assert.strictEqual(defaultProviderStateAfterSameKeyActive[0].reviewState, 'closed');
  assert.strictEqual(defaultProviderStateAfterSameKeyActive[0].syncState, 'synchronized');

  const providerStateIncludingActive = hub.listTargetModuleState('Provider Management', 50, { includeActive: true });
  assert.ok(providerStateIncludingActive.some((item) => item.artifactId === automaticArtifact.id && item.reviewState === 'closed'), 'include-active diagnostics should retain the closed same-key target record');
  assert.ok(providerStateIncludingActive.some((item) => item.artifactId === sameTargetArtifact.id && item.reviewState === 'pending' && item.syncState === 'awaiting_review'), 'include-active diagnostics should show the new same-key pending target record');
  assert.ok(hub.listArtifacts(100, { reviewState: 'pending' }).some((item) => item.id === sameTargetArtifact.id), 'new same-key artifact should remain visible in active review queues');
  assert.strictEqual(hub.listArtifacts(100, { reviewState: 'pending' }).some((item) => item.id === automaticArtifact.id), false, 'closed items must not appear in active review by default');
  assert.strictEqual(hub.listAuditLog().length, 1, 'creating same-key pending review artifacts should not alter the decision audit trail');

  const lifecycle = hub.applyArtifactLifecycleAction(automaticArtifact.id, 'revise_item', { decidedBy: 'qa' });
  assert.strictEqual(lifecycle.ok, true);
  assert.strictEqual(lifecycle.artifact.lifecycle.reviewState, 'pending');
  assert.strictEqual(lifecycle.artifact.targetSync.syncState, 'awaiting_review');
  assertExactClickThrough(lifecycle.artifact.targetSync, { targetModule: 'Provider Management', destinationRecordId: 'provider-1', destinationObjectType: 'Provider Management record', destinationPanel: 'Provider review and official provider records', syncState: 'awaiting_review' }, 'lifecycle correction');
  assert.strictEqual(hub.listAuditLog().length, 2, 'lifecycle correction should add audit evidence without removing the original decision');
  const defaultProviderStateAfterLifecycle = hub.listTargetModuleState('Provider Management');
  assert.strictEqual(defaultProviderStateAfterLifecycle.length, 1, 'lifecycle correction must not erase the prior closed synchronized target view');
  assert.strictEqual(defaultProviderStateAfterLifecycle[0].artifactId, automaticArtifact.id, 'default target view should keep the corrected artifact previous closed decision');
  assert.strictEqual(defaultProviderStateAfterLifecycle[0].reviewState, 'closed');
  assert.strictEqual(defaultProviderStateAfterLifecycle[0].syncState, 'synchronized');
  assert.strictEqual(defaultProviderStateAfterLifecycle[0].actionTaken, 'Approve into provider record', 'default target view should preserve the closed decision action label');
  const providerStateIncludingLifecycle = hub.listTargetModuleState('Provider Management', 50, { includeActive: true });
  assert.ok(providerStateIncludingLifecycle.some((item) => item.artifactId === automaticArtifact.id && item.reviewState === 'closed' && item.syncState === 'synchronized'), 'include-active diagnostics should retain same-artifact closed lifecycle evidence');
  assert.ok(providerStateIncludingLifecycle.some((item) => item.artifactId === automaticArtifact.id && item.reviewState === 'pending' && item.syncState === 'awaiting_review'), 'include-active diagnostics should show same-artifact lifecycle correction as active review evidence');
  const lifecycleCorrectionRow = providerStateIncludingLifecycle.find((item) => item.artifactId === automaticArtifact.id && item.reviewState === 'pending' && item.syncState === 'awaiting_review');
  assert.strictEqual(lifecycleCorrectionRow.openTargetLabel, 'Open provider review panel', 'lifecycle correction should keep a precise open-review action label');
  assert.strictEqual(defaultProviderStateAfterLifecycle[0].openTargetLabel, 'Open provider record', 'preserved synchronized evidence should keep the precise open-target action label');

  const originalRunHistory = hub.listHistory(20).find((item) => item.runId === automaticArtifact.runId);
  assert.ok(originalRunHistory, 'original automation run history should remain available after lifecycle correction');
  assert.strictEqual(originalRunHistory.decision.actionTaken, 'Approve into provider record', 'lifecycle correction must not replace the original run decision evidence');
  assert.strictEqual(originalRunHistory.decision.targetSync.syncState, 'synchronized', 'original run history should keep the synchronized target evidence');
  assert.strictEqual(originalRunHistory.decision.targetSync.reviewState, 'closed', 'original run history should keep the closed review evidence');
  assert.ok(/Approve into provider record/.test(originalRunHistory.result), 'original run result should remain stable after lifecycle correction');
  assert.ok(!/Revise provider update/.test(originalRunHistory.result), 'lifecycle correction should not rewrite the original run result');
  assert.ok((originalRunHistory.lifecycleCorrections || []).some((item) => item.actionTaken === 'Revise provider update' && item.targetSync.syncState === 'awaiting_review'), 'run history should append lifecycle correction evidence separately');
  assert.ok((originalRunHistory.actionResults || []).some((item) => item.action === 'record_lifecycle_correction' && item.destinationRecordId === 'provider-1'), 'run history action results should record the lifecycle correction without downgrading the decision');
  const lifecycleNotice = hub.listNotifications(100).find((item) => item.details?.notificationType === 'lifecycle_updated' && item.details?.artifactId === automaticArtifact.id);
  assert.ok(lifecycleNotice, 'lifecycle correction should create a separate typed internal notification');
  assert.strictEqual(lifecycleNotice.details.targetSync.syncState, 'awaiting_review', 'lifecycle notification should truthfully point to the active correction state');
  const decisionNotice = hub.listNotifications(100).find((item) => item.details?.notificationType === 'decision_recorded' && item.details?.artifactId === automaticArtifact.id);
  assert.ok(decisionNotice, 'original decision notification should remain available separately');
  assert.strictEqual(decisionNotice.details.targetSync.syncState, 'synchronized', 'decision notification should keep synchronized closed evidence');

  const eventMatrix = [
    {
      triggerType: 'new_captured_knowledge',
      payload: { captureId: 'capture-1' },
      origin: 'automatic_trigger',
      type: 'kb_formatting_review',
      triggerOwnership: 'automatic_knowledge_workflow',
      automationReadiness: 'automatic_trigger_staff_review',
      reviewRequirement: 'staff_required_before_kb_publication',
      handoffDepth: 'capture_to_kb_suggestion_panel',
      openTargetLabel: 'Open KB draft',
      clickTarget: { targetModule: 'Knowledge Base Manager', destinationRecordId: 'kb-capture:capture-1', destinationObjectType: 'Knowledge capture item', destinationPanel: 'Quick Capture and KB suggestion panel', syncState: 'awaiting_review' }
    },
    {
      triggerType: 'duplicate_detected',
      payload: { duplicateScore: 0.98, duplicateId: 'duplicate-1' },
      origin: 'automatic_trigger',
      type: 'duplicate_review_queue',
      triggerOwnership: 'automatic_provider_workflow',
      automationReadiness: 'automatic_trigger_staff_review',
      reviewRequirement: 'staff_required_before_merge_or_separate_decision',
      handoffDepth: 'duplicate_signal_to_provider_queue',
      openTargetLabel: 'Open duplicate review item',
      clickTarget: { targetModule: 'Provider Management', destinationRecordId: 'duplicate-1', destinationObjectType: 'Provider Management duplicate state', destinationPanel: 'Duplicate Review Queue and Provider Capture Assistant', syncState: 'awaiting_review' }
    },
    {
      triggerType: 'new_inbox_message',
      payload: { serviceIntent: 'certified_translation', threadId: 'thread-1', messageId: 'message-1' },
      origin: 'automatic_trigger',
      type: 'inbox_helper_panel',
      triggerOwnership: 'automatic_inbox_workflow',
      automationReadiness: 'automatic_trigger_staff_review',
      reviewRequirement: 'staff_required_before_client_facing_use',
      handoffDepth: 'inbox_message_to_thread_suggestion_panel',
      openTargetLabel: 'Open thread panel',
      clickTarget: { targetModule: 'Inbox', destinationRecordId: 'thread-1', destinationObjectType: 'Inbox thread/panel state', destinationPanel: 'Thread Suggestion / Routing Panel', syncState: 'awaiting_review' }
    },
    {
      triggerType: 'new_quick_capture',
      payload: { captureId: 'quick-1' },
      origin: 'automatic_trigger',
      type: 'kb_formatting_review',
      triggerOwnership: 'automatic_knowledge_workflow',
      automationReadiness: 'automatic_trigger_staff_review',
      reviewRequirement: 'staff_required_before_kb_publication',
      handoffDepth: 'quick_capture_to_kb_suggestion_panel',
      openTargetLabel: 'Open KB draft',
      clickTarget: { targetModule: 'Knowledge Base Manager', destinationRecordId: 'kb-capture:quick-1', destinationObjectType: 'Knowledge capture item', destinationPanel: 'Quick Capture and KB suggestion panel', syncState: 'awaiting_review' }
    },
    {
      triggerType: 'provider_matching_completed',
      payload: { matchingResultId: 'match-1' },
      meta: { manual: true, initiatedBy: 'staff' },
      origin: 'operator_triggered',
      type: 'provider_matching_results',
      triggerOwnership: 'operator_triggered',
      automationReadiness: 'manual_staff_trigger_live',
      reviewRequirement: 'staff_required_for_matching_decision',
      handoffDepth: 'matching_request_to_results_panel',
      openTargetLabel: 'Open matching results',
      clickTarget: { targetModule: 'Provider Matching Engine', destinationRecordId: 'match-1', destinationObjectType: 'Provider matching/provider target state', destinationPanel: 'Provider Matching Engine results', syncState: 'awaiting_review' }
    }
  ];

  const scenarioArtifacts = [];
  for (const expected of eventMatrix) {
    const runs = await hub.trigger(expected.triggerType, expected.payload, expected.meta || {});
    assert.strictEqual(runs.length, 1, `${expected.triggerType} should fire exactly one workflow`);
    assertLiveArtifact(runs[0].artifact, expected);
    assertStableOperatorLabelsForArtifact(runs[0].artifact, expected.triggerType);
    assert.strictEqual(runs[0].artifact.targetSync.openTargetLabel, expected.openTargetLabel, `${expected.triggerType} should expose the exact visible target label for its destination`);
    scenarioArtifacts.push({ triggerType: expected.triggerType, artifact: runs[0].artifact });
  }

  const kbScenario = scenarioArtifacts.find((item) => item.triggerType === 'new_captured_knowledge').artifact;
  const kbDecision = hub.applyArtifactDecision(kbScenario.id, 'approve_to_kb', { decidedBy: 'qa' });
  assert.strictEqual(kbDecision.ok, true);
  assert.strictEqual(kbDecision.artifact.targetSync.openTargetLabel, 'Open published KB item', 'published KB decisions should use the precise published-item label');
  assert.ok(kbDecision.artifact.lifecycleActions.some((action) => action.label === 'Revise published KB draft'), 'published KB lifecycle correction should remain distinct from normal closed-decision actions');

  const duplicateScenario = scenarioArtifacts.find((item) => item.triggerType === 'duplicate_detected').artifact;
  assert.strictEqual(duplicateScenario.actionLabel, 'Open duplicate review item', 'duplicate active card action should use the stable duplicate-review item label');
  const duplicateDecision = hub.applyArtifactDecision(duplicateScenario.id, 'keep_separate', { decidedBy: 'qa' });
  assert.strictEqual(duplicateDecision.ok, true);
  assert.strictEqual(duplicateDecision.artifact.targetSync.openTargetLabel, 'Open duplicate review item', 'closed duplicate state should retain the stable duplicate-review item label');
  assert.ok(duplicateDecision.artifact.lifecycleActions.some((action) => action.label === 'Recheck duplicate decision'), 'duplicate lifecycle correction should remain distinct from normal duplicate actions');

  const matchingScenario = scenarioArtifacts.find((item) => item.triggerType === 'provider_matching_completed').artifact;
  const matchingDecision = hub.applyArtifactDecision(matchingScenario.id, 'confirm_candidate', { decidedBy: 'qa' });
  assert.strictEqual(matchingDecision.ok, true);
  assert.strictEqual(matchingDecision.artifact.targetSync.openTargetLabel, 'Open confirmed provider target', 'confirmed provider match should use the precise confirmed-provider-target label');
  assert.ok(matchingDecision.artifact.lifecycleActions.some((action) => action.label === 'Revise matching criteria'), 'matching lifecycle correction should remain distinct from normal matching-result actions');

  const activeItems = hub.listArtifacts(100, { reviewState: 'pending' });
  assert.ok(activeItems.every((item) => ['pending_review', 'edit_requested', 'rerun_requested'].includes(item.status)), 'active review items should only use pending/edit/rerun states');
  assert.ok(activeItems.every((item) => item.lifecycle.reviewState === 'pending'), 'active review items should not include closed lifecycle state');

  const workflows = hub.listWorkflows();
  assert.strictEqual(workflows.filter((wf) => wf.trigger.automatic && wf.eventHookStatus === 'live').length, 5, 'automatic trigger paths should remain automatic and live');
  assert.strictEqual(workflows.filter((wf) => !wf.trigger.automatic && wf.eventHookStatus === 'live_manual_staff_trigger').length, 1, 'manual staff path should remain manual');
  assert.ok(workflows.filter((wf) => wf.trigger.automatic).every((wf) => wf.executionMode === 'assisted'), 'automatic paths should stay assisted staff-review paths');
  assert.ok(workflows.filter((wf) => !wf.trigger.automatic).every((wf) => wf.executionMode === 'manual'), 'manual staff paths should stay manual');
  workflows.filter((wf) => wf.stats.lastArtifactId).forEach((wf) => {
    assertStableOperatorLabel(wf.stats.lastArtifactActionLabel, `${wf.id} top workflow card latest-output action`);
    assertNoForbiddenOperatorLabels([wf.stats.lastArtifactActionLabel, wf.stats.lastArtifactTargetSync?.openTargetLabel], `${wf.id} top workflow card`);
    assertStableTargetPayload(wf.stats.lastArtifactTargetSync, `${wf.id} top workflow card target`);
  });

  const allArtifacts = hub.listArtifacts(100);
  assert.ok(allArtifacts.every((item) => item.targetSync && item.targetSync.openTargetPayload), 'all visible workflow cards should have stable target payloads');
  allArtifacts.forEach((item) => {
    assertStableTargetPayload(item.targetSync, `artifact ${item.id}`);
    assertStableOperatorLabelsForArtifact(item, `artifact ${item.id}`);
  });
  const lifecycleLabels = new Set(allArtifacts.flatMap((item) => (item.lifecycleActions || []).map((action) => action.label)));
  ['Reopen staff review', 'Revise provider update', 'Revise published KB draft', 'Revise matching criteria', 'Recheck duplicate decision'].forEach((label) => {
    if (lifecycleLabels.has(label)) assert.ok(!FORBIDDEN_GENERIC_OPERATOR_LABELS.includes(label), `${label} should remain a distinct lifecycle correction label`);
  });
  const closed = allArtifacts.filter((item) => item.lifecycle.closed);
  assert.ok(closed.every((item) => item.targetSync.syncState === 'synchronized'), 'closed cards should have synchronized target references');

  const notices = hub.listNotifications(100);
  assert.ok(notices.every((item) => item.details?.notificationType), 'notifications should expose clear notification types');
  notices.forEach((item) => assertNoForbiddenOperatorLabels([item.details?.actionLabel, item.details?.targetSync?.openTargetLabel, item.details?.openTargetPayload?.openTargetLabel], `notification ${item.id || item.message}`));
  assert.ok(notices.every((item) => !item.details?.actionLabel || STABLE_OPERATOR_OPEN_LABELS.has(item.details.actionLabel)), 'notification review-surface actions should use stable operator labels');
  assert.ok(notices.every((item) => !item.details?.targetSync?.openTargetLabel || STABLE_OPERATOR_OPEN_LABELS.has(item.details.targetSync.openTargetLabel)), 'notification target actions should use stable operator labels');
  assert.ok(notices.every((item) => !item.details?.artifactId || item.details?.targetSync || item.details?.destinationRecordId || item.details?.openTargetPayload), 'artifact notifications should reference the correct artifact review-surface target');

  const automationHtml = require('fs').readFileSync(require('path').join(__dirname, '../public/automation.html'), 'utf8');
  assert.ok(automationHtml.includes('function renderActionButtons'), 'UI should centralize visible action deduplication');
  assert.ok(automationHtml.includes('buildTargetOpenAction(targetSync'), 'notifications should prefer the precise target-module action over duplicate review-surface buttons');
  assert.ok(!automationHtml.includes("renderTargetLink(targetUrl, 'open'"), 'visible target links should use precise operator-facing labels, not generic open/result wording');
  FORBIDDEN_GENERIC_OPERATOR_LABELS.forEach((label) => {
    assert.ok(!automationHtml.includes(`'${label}'`) && !automationHtml.includes(`>${label}<`), `Automation Hub UI must not hard-code generic visible label ${label}`);
  });

  const phase = hub.getPhaseState();
  assert.strictEqual(phase.phase3.status, 'operational_hardening');
  assert.strictEqual(phase.workflowReadiness.filter((item) => item.automaticEventLive).length, 5);
  assert.strictEqual(phase.workflowReadiness.filter((item) => item.manualStaffTriggerLive).length, 1);
  assert.strictEqual(phase.workflowReadiness.filter((item) => item.scaffoldOnly).length, 0);
}

main()
  .then(() => console.log('Automation Hub Phase 3 operational validation passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
