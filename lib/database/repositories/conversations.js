'use strict';

/**
 * Repository Layer Phase 1 skeleton: conversations repository.
 *
 * Future role:
 * - Centralize conversation/thread/message database reads and writes.
 * - Provide a stable contract independent of the underlying DB bridge.
 * - Allow gradual migration from Supabase bridge to private PostgreSQL backend.
 *
 * Safety for this phase:
 * - Placeholder only.
 * - Not wired into runtime yet.
 * - No behavior changes.
 */

function getConversationsRepositoryInfo() {
  return {
    name: 'conversations',
    phase: 'repository-layer-phase-1-skeleton',
    runtimeWired: false,
  };
}

module.exports = {
  getConversationsRepositoryInfo,
};
