# lsa-global-webhook

## Production-safe AI switch

Set this environment variable to control autonomous AI replies in WhatsApp:

```bash
AI_AUTOREPLY_ENABLED=false
```

- `false` (recommended for production): keeps greeting/menu and fixed option replies active, and sends a safe human-handoff message for free-text messages.
- `true` (staging/testing): re-enables the existing autonomous retrieval/AI reply flow.

## Manual SQL migration (required for Archive Thread)

Run this in Supabase SQL editor before using Archive Thread:

```sql
alter table public.conversations
add column if not exists is_archived boolean not null default false;

create index if not exists conversations_wa_id_is_archived_idx
on public.conversations (wa_id, is_archived, created_at desc);
```
