'use strict';

/**
 * Repository Layer Phase 1 skeleton: knowledge base repository.
 *
 * Future role:
 * - Centralize KB article/capture data access in one module.
 * - Keep query logic consistent and auditable during staged migration.
 * - Support bridge swap readiness without changing business behavior.
 *
 * Safety for this phase:
 * - Placeholder only.
 * - Not wired into runtime yet.
 * - No behavior changes.
 */

function getKbRepositoryInfo() {
  return {
    name: 'kb',
    phase: 'repository-layer-phase-1-skeleton',
    runtimeWired: false,
  };
}

module.exports = {
  getKbRepositoryInfo,
};
