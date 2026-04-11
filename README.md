# lsa-global-webhook

## Production-safe AI mode & feature flags

Use these environment variables to control AI experiments safely:

```bash
APP_ENV=production
AI_EXPERIMENTS_ENABLED=false
AI_AUTOREPLY_ENABLED=false
```

## Required environment variables (startup)

The server requires these variables at startup:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
APP_ENV=live
```

`SUPABASE_SERVICE_ROLE_KEY` is recommended. Backward-compatible fallbacks are also supported: `SUPABASE_SECRET_KEY`, then `SUPABASE_ANON_KEY`.

### Render quick setup

Set these in Render Environment:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
APP_ENV=live
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

## Manual SQL migration (required for multilingual mediation phase 1)

Run this in Supabase SQL editor to store original + translated message variants:

```sql
alter table public.conversations
add column if not exists original_language text,
add column if not exists translated_text text,
add column if not exists translated_language text,
add column if not exists staff_reply_text text,
add column if not exists staff_reply_language text,
add column if not exists sent_reply_text text,
add column if not exists sent_reply_language text;
```

Optional environment variable:

```bash
INTERNAL_WORKING_LANGUAGE=en
```

If omitted, the internal working language defaults to English (`en`).
