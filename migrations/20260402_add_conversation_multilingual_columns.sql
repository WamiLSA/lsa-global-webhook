-- Adds multilingual mediation columns to keep conversation inserts compatible across environments.
alter table public.conversations
add column if not exists original_language text,
add column if not exists translated_text text,
add column if not exists translated_language text,
add column if not exists staff_reply_text text,
add column if not exists staff_reply_language text,
add column if not exists sent_reply_text text,
add column if not exists sent_reply_language text;
