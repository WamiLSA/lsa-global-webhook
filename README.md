# lsa-global-webhook

## Production-safe AI mode & feature flags

Use these environment variables to control AI experiments safely:

```bash
APP_ENV=production
AI_EXPERIMENTS_ENABLED=false
AI_AUTOREPLY_ENABLED=false
```

- `APP_ENV`:
  - `production` (default): always safe controlled mode (no AI experiments).
  - `staging` / `test` / `development`: eligible for experiment mode.
- `AI_EXPERIMENTS_ENABLED`:
  - `true`: enables retrieval + AI experiment endpoints, but only when `APP_ENV` is test-like.
  - `false`: forces safe controlled mode.
- `AI_AUTOREPLY_ENABLED`:
  - `true`: allows autonomous WhatsApp AI answers, but only when experiment mode is enabled.
  - `false`: keeps greeting/menu and safe human-handoff behavior.

### Example: production (safe controlled)

```bash
APP_ENV=production
AI_EXPERIMENTS_ENABLED=false
AI_AUTOREPLY_ENABLED=false
```

### Example: staging/test (AI experiments enabled)

```bash
APP_ENV=staging
AI_EXPERIMENTS_ENABLED=true
AI_AUTOREPLY_ENABLED=true
```

## Manual SQL migration (required for Archive Thread)

Run this in Supabase SQL editor before using Archive Thread:

```sql
alter table public.conversations
add column if not exists is_archived boolean not null default false;

create index if not exists conversations_wa_id_is_archived_idx
on public.conversations (wa_id, is_archived, created_at desc);
```
