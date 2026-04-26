'use strict';

/**
 * Repository Layer Phase 1 skeleton: providers repository.
 *
 * Future role:
 * - Centralize provider data reads/writes for staffing and matching workflows.
 * - Create a stable access layer that can be reused across adapters.
 * - Reduce direct DB coupling in route/business modules over time.
 *
 * Safety for this phase:
 * - Placeholder only.
 * - Not wired into runtime yet.
 * - No behavior changes.
 */

function getProvidersRepositoryInfo() {
  return {
    name: 'providers',
    phase: 'repository-layer-phase-1-skeleton',
    runtimeWired: false,
  };
}

module.exports = {
  getProvidersRepositoryInfo,
};
