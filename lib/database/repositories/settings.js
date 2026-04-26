'use strict';

/**
 * Repository Layer Phase 1 skeleton: settings repository.
 *
 * Future role:
 * - Centralize runtime settings/config reads (including mode controls).
 * - Preserve production-safe behavior while reducing direct query spread.
 * - Serve as an early low-risk candidate for staged repository adoption.
 *
 * Safety for this phase:
 * - Placeholder only.
 * - Not wired into runtime yet.
 * - No behavior changes.
 */

function getSettingsRepositoryInfo() {
  return {
    name: 'settings',
    phase: 'repository-layer-phase-1-skeleton',
    runtimeWired: false,
  };
}

module.exports = {
  getSettingsRepositoryInfo,
};
