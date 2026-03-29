# lsa-global-webhook

## Manual SQL migration (required for Archive Thread)

Run this in Supabase SQL editor before using Archive Thread:

```sql
alter table public.conversations
add column if not exists is_archived boolean not null default false;

create index if not exists conversations_wa_id_is_archived_idx
on public.conversations (wa_id, is_archived, created_at desc);
```
