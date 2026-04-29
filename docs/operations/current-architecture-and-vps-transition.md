# Current Architecture and Hostinger VPS Transition (Non-Invasive Synchronization)

## Purpose

This document synchronizes the **existing production architecture** of `WamilSA/lsa-global-webhook` with the current **Hostinger VPS staging/foundation plan**.

It is intentionally **documentation-only** and defines operational guardrails so that architecture alignment can progress safely without disrupting live services.

---

## Current Production Chain (Authoritative)

The current live operational chain remains:

1. **GitHub repository** (`WamilSA/lsa-global-webhook`) as source control and deployment trigger origin.
2. **Render web service runtime** as the live application execution environment.
3. **Supabase production database** as the active production data and state backbone.
4. **WhatsApp/Meta webhook integration** as an external communication channel bridge.
5. **LSA GLOBAL Internal OS modules** as the internal operational surface used by staff.

### Current Internal OS module surface (visible)

- Inbox
- Knowledge Base
- Capture Assistant
- Providers
- Archived Threads
- Quick Capture
- Settings
- AI Tools
- Reports
- Live Mode / Test Mode

---

## Hostinger VPS Role (Current Scope)

The Hostinger VPS is currently defined as:

- A **staging/private infrastructure foundation**.
- **Not production** at this stage.
- **Not a Supabase replacement** at this stage.
- **Not a mail server** at this stage.

This means the VPS is a controlled preparation layer for future internalization and independence work, while existing production traffic continues through the current live chain.

---

## Non-Invasive Safety Baseline (Must Remain True)

At this phase, the following are mandatory:

- **Render remains live**.
- **Supabase remains production**.
- **VPS remains staging/foundation only**.
- **No runtime behavior changes** are introduced by this alignment step.
- **No environment variables are changed**.
- **No secrets are committed**.
- **No database schema or data changes** are performed.
- **No deployment target changes** are made.

---

## Safe Migration Doctrine

Any transition from current external runtime dependencies toward stronger LSA GLOBAL private infrastructure must follow this doctrine:

1. **Gradual**  
   Progress in controlled phases, not big-bang cutovers.

2. **Reversible**  
   Every stage must have a rollback path to the current known-stable production posture.

3. **Tested**  
   Validate behavior in supervised staging/test contexts before any production-impacting change.

4. **Non-destructive**  
   Avoid destructive operations against production infrastructure, data, or integrations.

5. **Supabase as bridge**  
   Supabase remains the continuity bridge during transition phases.

6. **LSA GLOBAL private backend as destination**  
   The strategic destination is a stronger private backend posture under LSA GLOBAL control.

---

## Explicit Out-of-Scope for This Step

This synchronization step does **not** include:

- Editing runtime logic for production behavior.
- Modifying Render service configuration.
- Altering Supabase code, schema, or production data.
- Rotating or exposing production credentials.
- Changing operational webhook routing in production.

---

## Operational Intent

This file exists to keep teams synchronized on architecture reality and transition discipline:

- Protect current business continuity.
- Preserve live-mode safety.
- Enable staged internal infrastructure maturity.
- Support long-term LSA GLOBAL autonomy without destabilizing active operations.
