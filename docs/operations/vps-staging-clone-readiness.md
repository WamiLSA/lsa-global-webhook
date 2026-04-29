# VPS Staging Clone Readiness (Hostinger)

## Current Production Chain (Unchanged)

The current production chain remains:

**GitHub → Render web service → Supabase production database → LSA GLOBAL Internal OS / WhatsApp webhook**

This pull request is documentation-only and does not modify any production runtime behavior.

## Production Source of Truth

- **Render remains the production runtime environment** for the webhook service.
- **Supabase remains the production database** and the active data source for production operations.

## Hostinger VPS Role (Staging Foundation Only)

Hostinger VPS is designated as a **staging/private infrastructure foundation only** at this stage.

It is not approved as a production replacement and is not part of any live traffic cutover at this time.

## Future Staging Paths (Planned)

For future staging setup, use the following planned locations:

- **VPS staging clone path:**
  `/opt/lsa-global/repos/lsa-global-webhook`
- **Staging environment file path (outside Git):**
  `/opt/lsa-global/env/lsa-global-webhook.staging.env`

## Security and Repository Safety Rules

- **No secrets must be committed** to the repository.
- **`.env` files must never be committed** to the repository.
- Environment files must remain outside Git and be managed only in secure server-side paths.

## Explicit Non-Approval Boundaries (Current Phase)

At this stage, the following are **not approved yet**:

- No DNS cutover.
- No PostgreSQL installation on VPS.
- No Docker/Coolify installation.
- No mail server installation.

## Staged Migration Checklist (Future Execution Sequence)

When staging execution is formally approved, use this sequence:

1. Clone repository.
2. Create staging environment file outside Git.
3. Install dependencies.
4. Run health check.
5. Test inbox/modules.
6. Compare behavior with Render production.
7. Only then decide the next step.

## Change Scope of This PR

This change is documentation-only and is intended to prepare safe future staging readiness without disturbing current production operations.
