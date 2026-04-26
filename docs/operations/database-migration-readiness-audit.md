# Database Migration-Readiness Audit (Supabase → Future Private PostgreSQL)

Date: 2026-04-25 (UTC)
Stage: Non-destructive audit only

## Scope and safety confirmation
- This audit is read-only analysis of repository code.
- No database writes were executed from this audit task.
- No schema migrations were run.
- No Supabase removal was attempted.
- No production runtime behavior was changed.

## 1) Files that directly import, initialize, or call Supabase

### Runtime code (application path)
1. `server.js`
   - Imports Supabase SDK (`@supabase/supabase-js`).
   - Reads Supabase environment variables.
   - Initializes Supabase client.
   - Performs all direct table operations (`.from(...)`) for inbox, knowledge, providers, settings/mode state, and webhook persistence.
2. `lib/internal-retrieval.js`
   - Receives `supabase` client by dependency injection (`createInternalRetriever({ supabase, ... })`).
   - Executes query builder operations against tables used by test-mode/internal retrieval.

### Non-runtime operational files (tooling/docs/dependency)
3. `package.json` (declares `@supabase/supabase-js`).
4. `scripts/supabase-manual-backup.sh` (Supabase CLI backup script, not app runtime).
5. `README.md` (Supabase env configuration docs).
6. `docs/operations/supabase-manual-backup-plan.md` (backup runbook).
7. `docs/operations/automated-supabase-backup-readiness.md` (workflow documentation).
8. `docs/operations/first-real-backup-checklist.md` (backup checklist).

## 2) Runtime modules that currently depend on Supabase

> Note: In current architecture, most modules are route blocks inside `server.js` (monolithic runtime module), plus internal retrieval logic in `lib/internal-retrieval.js`.

### Inbox / conversations / messages
- `GET /api/conversations`
- `GET /api/conversations/archived`
- `GET /api/conversations/:wa_id`
- `POST /api/conversations/:wa_id/clear`
- `POST /api/conversations/:wa_id/delete`
- `POST /api/conversations/:wa_id/archive`
- `POST /api/conversations/:wa_id/unarchive`
- `POST /api/send`
- `POST /api/send-attachment`
- `POST /api/label`
- `POST /webhook` (WhatsApp inbound persistence)

Primary table: `conversations`.

### Knowledge Base (official)
- `GET /api/kb/categories`
- `POST /api/kb/categories`
- `GET /api/kb/articles`
- `POST /api/kb/articles`
- `PUT /api/kb/articles/:id`
- `DELETE /api/kb/articles/:id`

Primary tables: `kb_categories`, `kb_articles`.

### Quick Capture
- `GET /api/kb/quick-capture`
- `POST /api/kb/quick-capture`
- `DELETE /api/kb/quick-capture/:id`

Primary table: `kb_quick_capture`.

### Knowledge Capture Assistant
- `GET /api/kb-capture`
- `POST /api/kb-capture`
- `PUT /api/kb-capture/:id`
- `DELETE /api/kb-capture/:id`
- `POST /api/kb-capture/generate`
- `POST /api/kb-capture/check-duplicates`
- `POST /api/kb-capture/convert-to-kb`

Primary tables: `kb_capture_assistant`, `kb_categories`, `kb_articles`.

### Providers
- `GET /api/providers`
- `POST /api/providers`
- `PUT /api/providers/:id`
- `DELETE /api/providers/:id`
- `POST /api/providers/duplicate-check`
- `POST /api/providers/match`

Primary table: `providers`.

### Provider documents
- `GET /api/providers/:providerId/documents`
- `POST /api/providers/:providerId/documents`

Primary tables: `provider_documents` (+ provider existence check on `providers`).

### Attachments / thumbnails
- Attachment files are stored via local filesystem upload paths (`/uploads/...`) in current runtime.
- Supabase role here is metadata persistence and message/thread state linkage (mainly through `conversations`, `provider_documents`), not Supabase Storage.

### Settings / runtime mode
- `GET /api/system/mode`
- `POST /api/system/mode`

Primary table: `app_config`.

### Reports
- No dedicated reporting table or report persistence module found.
- Reporting-like behavior currently uses existing operational tables and runtime logs.

### WhatsApp webhook storage
- `POST /webhook` persists inbound WhatsApp events/message state into `conversations`.

### Live/Test mode data
- Mode control reads/writes `app_config`.
- Test retrieval path reads from KB/provider sources via `lib/internal-retrieval.js` using Supabase query builder.

## 3) Tables currently used by the application

Observed direct usage via `.from(...)` in runtime code:
1. `app_config`
2. `conversations`
3. `kb_articles`
4. `kb_capture_assistant`
5. `kb_categories`
6. `kb_quick_capture`
7. `provider_documents`
8. `providers`
9. `information_schema.columns` (schema introspection fallback logic; not business table)

## 4) Centralized vs scattered database access

Current state: **partially centralized, mostly scattered**.

- Good: single Supabase client is initialized once in `server.js` and injected into internal retriever.
- Risk: data access logic is spread across many route handlers and helper functions in a large monolithic file (`server.js`), with additional query logic in `lib/internal-retrieval.js`.
- Result: high coupling between HTTP controllers, business logic, and persistence details.

## 5) Supabase-specific features currently used

### Used
- Supabase JavaScript client (`@supabase/supabase-js`) and PostgREST query builder (`from/select/insert/update/delete/eq/or/ilike/...`).
- Supabase-specific env vars in runtime:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - fallback support: `SUPABASE_SECRET_KEY`, `SUPABASE_ANON_KEY`
- Service-role style server-side access pattern (admin-level key in backend runtime), implying RLS bypass is likely/possible depending on project configuration.

### Not observed in runtime usage
- Supabase Auth client flows (`supabase.auth.*`): **not observed**.
- Supabase Storage client flows (`supabase.storage.*`): **not observed**.
- Supabase Realtime (`channel`, subscriptions): **not observed**.
- Supabase Edge Functions invocation (`supabase.functions.*`): **not observed**.

### Operational (non-runtime)
- Supabase CLI backup tooling via `supabase db dump` in `scripts/supabase-manual-backup.sh`.

## 6) Recommended migration-ready target structure (future)

Proposed incremental structure:

```text
lib/
  database/
    client.js
    adapters/
      supabase.js
      postgres.js
    repositories/
      conversations.js
      kb.js
      providers.js
      settings.js
      attachments.js
      provider-documents.js
```

Recommended responsibilities:
- `client.js`: runtime DB interface factory and adapter selection (feature flag / env-driven).
- `adapters/supabase.js`: wraps current Supabase query semantics.
- `adapters/postgres.js`: future node-postgres/SQL implementation with same repository contracts.
- `repositories/*`: operation contracts by domain (no HTTP concerns).
- Route handlers call repositories only (not `.from(...)` directly).

## 7) Refactor status for this PR

- No runtime refactor performed in this stage.
- Kept strictly audit-only to preserve live app safety.

## 8) Migration risks identified

1. **Monolithic coupling risk**
   - `server.js` embeds persistence and route/business logic together; abstraction extraction needs careful slicing.
2. **Query-behavior compatibility risk**
   - Supabase query helpers (`or`, `ilike`, `maybeSingle`, etc.) must be behavior-matched in PostgreSQL adapter.
3. **Schema-introspection dependency risk**
   - `information_schema.columns` fallback logic for `provider_documents` must be preserved or replaced with explicit versioned compatibility logic.
4. **Service-role/RLS assumption risk**
   - Current backend likely relies on high-privilege key semantics; migration must define equivalent server trust and row-authorization policy.
5. **Live/Test mode safety risk**
   - `app_config`-based mode reads/writes are safety-critical for production behavior; abstraction errors here can impact routing behavior.
6. **Retrieval quality sensitivity risk**
   - Internal retrieval currently queries multiple tables/sources with ranking heuristics; even small query changes can alter Test Mode answer quality.
7. **Provider documents dual-path risk**
   - Filesystem storage + DB metadata linkage requires transactional consistency guarantees during migration.

## 9) Smallest safe next PR proposal (first abstraction layer)

**Objective:** create abstraction scaffolding with no behavior change.

### Minimal safe PR contents
1. Add `lib/database/client.js`:
   - Move only Supabase client initialization + env validation from `server.js`.
   - Export `{ db, supabase }` (or equivalent) preserving existing object shape.
2. Add `lib/database/adapters/supabase.js`:
   - Thin wrapper around existing Supabase instance.
3. Update `server.js` imports to consume the shared DB client module.
4. No route logic changes; no SQL/migration changes; no table contract changes.
5. Add `docs/operations/database-abstraction-phase-1.md` with invariants and rollback note.

### Explicit non-goals for that PR
- No schema migration.
- No endpoint behavior changes.
- No replacement of existing query logic.
- No Postgres adapter activation yet.

## 10) Final confirmation for this audit stage

Confirmed for this PR/audit activity:
- ✅ No production data changed.
- ✅ No database schema changed.
- ✅ No real backup run executed.
- ✅ No secret value touched or exposed.
- ✅ App runtime behavior unchanged.

