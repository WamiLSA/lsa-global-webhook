'use strict';

/**
 * Repository Layer Phase 1 skeleton: attachments repository.
 *
 * Future role:
 * - Centralize attachment metadata persistence/retrieval operations.
 * - Keep storage-sensitive DB interactions isolated and auditable.
 * - Prepare for staged adapter migration after lower-risk modules stabilize.
 *
 * Safety for this phase:
 * - Placeholder only.
 * - Not wired into runtime yet.
 * - No behavior changes.
 */

function getAttachmentsRepositoryInfo() {
  return {
    name: 'attachments',
    phase: 'repository-layer-phase-1-skeleton',
    runtimeWired: false,
  };
}

module.exports = {
  getAttachmentsRepositoryInfo,
};
