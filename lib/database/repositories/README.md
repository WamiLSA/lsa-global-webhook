# Repository Layer (Phase 1 Skeleton)

This folder introduces the first repository-layer skeleton for database migration-readiness.

## Purpose
- Repositories will progressively centralize database access in small, reviewable steps.
- This staged design supports long-term migration from the current Supabase bridge to LSA GLOBAL's private backend stack.

## Current runtime state
- Runtime behavior is unchanged.
- Existing application flows still use current Supabase logic and existing query paths.
- These repository files are placeholders and are not wired into runtime yet.

## Planned migration approach
Future pull requests can move one small module at a time into repositories with parity checks, for example:
1. settings reads
2. Knowledge Base reads
3. provider reads
4. conversation reads
5. attachment logic later (more storage/file-sensitive)

This allows safe, incremental hardening while Supabase remains the active bridge.
