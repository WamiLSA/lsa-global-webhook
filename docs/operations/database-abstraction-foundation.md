# Database Abstraction Foundation (Safe Stage)

Date: 2026-04-26 (UTC)
Stage: Foundation-only (non-invasive)

## Objective
Establish the first database abstraction foundation without changing runtime behavior.

## Current invariant
- Supabase remains the active database bridge.
- Existing reads/writes stay in current paths.
- No route behavior changes.
- No migrations and no schema changes.

## Planned future structure

```text
lib/database/
  adapters/
    supabase.js
    postgres.js
  repositories/
    conversations.js
    kb.js
    providers.js
    settings.js
    attachments.js
```

## Intent of each future module
- `lib/database/adapters/supabase.js`
  - Wrap current Supabase access behind stable adapter methods.
  - Preserve existing query behavior while reducing direct coupling in route handlers.

- `lib/database/adapters/postgres.js`
  - Implement the same contracts for private PostgreSQL backend (future activation).
  - Remain inactive until parity, testing, and rollout gates are approved.

- `lib/database/repositories/conversations.js`
  - Consolidate inbox conversation/message persistence operations.

- `lib/database/repositories/kb.js`
  - Consolidate Knowledge Base and capture-related DB access operations.

- `lib/database/repositories/providers.js`
  - Consolidate provider records, matching-related reads, and update flows.

- `lib/database/repositories/settings.js`
  - Consolidate runtime config/mode operations (production safety-critical).

- `lib/database/repositories/attachments.js`
  - Consolidate attachment metadata persistence interactions.

## Rollout discipline (next stages)
1. Add adapters/repositories as wrappers first.
2. Route-by-route adoption with strict parity checks.
3. Keep Supabase active as default bridge during transition.
4. Introduce private PostgreSQL adapter behind controlled flag only after parity.
5. Validate rollback path before any bridge switch.

## Explicit non-goals for this stage
- No data or schema modifications.
- No backup execution.
- No secret changes.
- No Supabase removal.
- No production behavior changes.
