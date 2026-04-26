# Database Abstraction Foundation

## Current state (active bridge)
Supabase remains the **current active database bridge** for LSA GLOBAL Internal.
All runtime reads/writes continue to use the existing Supabase-backed flow.

## Strategic destination
LSA GLOBAL's long-term destination is a private backend stack
(PostgreSQL on controlled VPS/infrastructure), introduced progressively and safely.

## Purpose of this folder
This `lib/database/` folder is the foundation for progressive database abstraction.
It will centralize database access contracts in small, reviewable steps so the app can
migrate from Supabase to private infrastructure with lower risk.

## Safety invariant for this stage
This stage is non-invasive scaffolding only:
- no runtime data-access behavior changes
- no production data changes
- no schema changes
- no migrations
- no backup execution
- no Supabase removal

Supabase stays active while this foundation is prepared for future migration stages.
