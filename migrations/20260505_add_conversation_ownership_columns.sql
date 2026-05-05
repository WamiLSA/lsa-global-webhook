-- Conversation ownership / human takeover schema support for LSA GLOBAL Internal Communications Hub.
-- Safe to run more than once in Supabase SQL Editor because all columns and indexes use IF NOT EXISTS.

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
