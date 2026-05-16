const assert = require('assert');
const { createAutomationHub } = require('../lib/automation-hub');

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
  assert.strictEqual(hub.listTargetModuleState('Provider Management').length, 0, 'pending review items must not appear as closed synchronized module decisions');
  assert.strictEqual(hub.listTargetModuleState('Provider Management', 50, { includeActive: true }).length, 1, 'diagnostic module state can include active pending items when explicitly requested');

  const manualRun = await hub.runWorkflowById('wf-provider-doc-extractor', { initiatedBy: 'reviewer' });
  assert.strictEqual(manualRun.ok, true);
  assert.strictEqual(manualRun.run.automationOrigin, 'operator_triggered');
  assert.strictEqual(manualRun.run.automationExecutionState, 'manual_staff_event_fired');
  assert.strictEqual(manualRun.run.artifact.automationOrigin, 'operator_triggered');
  assert.strictEqual(manualRun.run.artifact.automationExecutionState, 'manual_staff_event_fired');

  const decision = hub.applyArtifactDecision(automaticArtifact.id, 'approve_into_provider_record', { decidedBy: 'qa' });
  assert.strictEqual(decision.ok, true);
  assert.strictEqual(decision.artifact.lifecycle.reviewState, 'closed');
  assert.strictEqual(decision.artifact.lifecycle.synchronized, true);
  const closedProviderState = hub.listTargetModuleState('Provider Management');
  assert.strictEqual(closedProviderState.length, 1, 'closed decision should synchronize back to target module');
  assert.strictEqual(closedProviderState[0].artifactId, automaticArtifact.id, 'closed synchronized target row should point to the approved artifact');
  assert.strictEqual(hub.listAuditLog().length, 1, 'decision audit trail should be preserved');
  assert.ok(hub.listNotifications().some((item) => /Automation decision recorded/.test(item.message)), 'decision should create an internal notification');

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
  assert.strictEqual(hub.listAuditLog().length, 1, 'creating same-key pending review artifacts should not alter the decision audit trail');

  const lifecycle = hub.applyArtifactLifecycleAction(automaticArtifact.id, 'revise_item', { decidedBy: 'qa' });
  assert.strictEqual(lifecycle.ok, true);
  assert.strictEqual(lifecycle.artifact.lifecycle.reviewState, 'pending');
  assert.strictEqual(lifecycle.artifact.targetSync.syncState, 'awaiting_review');
  assert.strictEqual(hub.listAuditLog().length, 2, 'lifecycle correction should add audit evidence without removing the original decision');

  const eventMatrix = [
    ['new_captured_knowledge', { captureId: 'capture-1' }, 'automatic_trigger'],
    ['duplicate_detected', { duplicateScore: 0.98, duplicateId: 'duplicate-1' }, 'automatic_trigger'],
    ['new_inbox_message', { serviceIntent: 'certified_translation', threadId: 'thread-1', messageId: 'message-1' }, 'automatic_trigger'],
    ['new_quick_capture', { captureId: 'quick-1' }, 'automatic_trigger'],
    ['provider_matching_completed', { matchingResultId: 'match-1' }, 'operator_triggered', { manual: true, initiatedBy: 'staff' }]
  ];

  for (const [triggerType, payload, expectedOrigin, meta = {}] of eventMatrix) {
    const runs = await hub.trigger(triggerType, payload, meta);
    assert.strictEqual(runs.length, 1, `${triggerType} should fire exactly one workflow`);
    assert.strictEqual(runs[0].automationOrigin, expectedOrigin, `${triggerType} should report the correct execution origin`);
  }

  const phase = hub.getPhaseState();
  assert.strictEqual(phase.workflowReadiness.filter((item) => item.automaticEventLive).length, 5);
  assert.strictEqual(phase.workflowReadiness.filter((item) => item.manualStaffTriggerLive).length, 1);
  assert.strictEqual(phase.workflowReadiness.filter((item) => item.scaffoldOnly).length, 0);
}

main()
  .then(() => console.log('Automation Hub validation passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
