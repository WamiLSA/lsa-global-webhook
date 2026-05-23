# WhatsApp Inbox Operator Parity Audit (2026-05-23)

## Existing capabilities observed
- Active/archived thread views and channel switcher (WhatsApp/Mail).
- Thread state actions: read/unread, pin/unpin, mute/unmute.
- Archive/unarchive endpoints.
- Staff send flow with multilingual mediation fields.
- Attachment renderer with image/video/audio/document cards in inbox UI.
- Communications settings with quick reply metadata support.

## Gaps identified for implementation track
- Message-level action menu (desktop/mobile), quote reply context, copy, star, soft-hide.
- Internal note timeline entries and safe non-outbound staff-only handling.
- Message multi-select actions and export.
- Thread-level search/highlight and global advanced inbox filters.
- Labels CRUD and richer default taxonomy.
- Greeting/away automation policy controls and anti-spam per-contact windows.
- 24-hour service window awareness and template reminder scaffolding.
- Delivery/read status surfacing from webhook status callbacks.
- Contact profile panel and assignment/status workflow parity.

## Safety constraints
- Preserve Automation Hub Phase 2/3 behavior and run/audit artifacts.
- Preserve mode separation and idempotency/click locking.
- No hard-delete for operator-visible message removals.

## Recommended phased rollout
1. Message actions + quote reply + internal notes + soft-hide (UI + storage).
2. Search/filter + labels + quick replies slash picker.
3. Service window/status + greeting/away rules.
4. Assignment/profile/export and campaign scaffolding flags.
