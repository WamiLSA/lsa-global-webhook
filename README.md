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

## Manual SQL migration (required for conversation ownership / human takeover)

Run `migrations/20260505_add_conversation_ownership_columns.sql` in the Supabase SQL editor to persist durable conversation ownership and follow-up policy state. The migration is idempotent and safe to run on a live schema because every column and index uses `if not exists`:

```sql
alter table public.conversations
add column if not exists conversation_owner text not null default 'bot',
add column if not exists human_takeover boolean not null default false,
add column if not exists last_human_reply_at timestamptz,
add column if not exists last_customer_message_at timestamptz,
add column if not exists conversation_type text not null default 'other_business_contact',
add column if not exists followup_eligible boolean not null default false,
add column if not exists automation_policy text,
add column if not exists bot_suppressed_reason text,
add column if not exists ownership_event text;

create index if not exists conversations_wa_id_owner_idx
on public.conversations (wa_id, conversation_owner, human_takeover, created_at desc);

create index if not exists conversations_followup_idx
on public.conversations (followup_eligible, conversation_type, last_customer_message_at desc);
```

Supported `conversation_type` values are `prospect`, `client`, `support`, `provider`, `freelancer`, `job_seeker`, and `other_business_contact`. Human-owned conversations default to bot silence until manually reset through the ownership reset API.


## Android APK pipeline (LSA GLOBAL Internal Mobile)

This repository now includes a GitHub Actions pipeline to produce an installable Android debug APK from `mobile-app/`.

### Pipeline

- Workflow file: `.github/workflows/android-apk.yml`
- Trigger: manual (`workflow_dispatch`) or push changes under `mobile-app/**`
- Artifact name: `lsa-global-internal-debug-apk`

### Local APK build (manual)

From repository root:

```bash
cd mobile-app
npm ci
npx expo prebuild --platform android --non-interactive
cd android
chmod +x gradlew
./gradlew assembleDebug
```

Expected APK output:

```text
mobile-app/android/app/build/outputs/apk/debug/app-debug.apk
```

### Optional cloud build (EAS)

`mobile-app/eas.json` provides an internal `preview` profile that builds an Android APK:

```bash
cd mobile-app
npx eas build -p android --profile preview
```

