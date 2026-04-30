# LSA GLOBAL Internal Mobile (Android-first) — Phase 1

## 1) App architecture proposal
- **Framework:** React Native with Expo (fast Android iteration, existing JavaScript stack alignment).
- **Pattern:** Screen + service-layer split.
  - `src/screens`: UI and user actions.
  - `src/api`: backend transport and token-aware client.
  - `src/context`: authentication/session orchestration.
  - `src/components`: reusable UI (e.g., Live/Test mode badge).
- **Runtime safety rule:** mobile app reads and displays runtime mode from backend (`LIVE` vs `TEST`) and visually warns staff.

## 2) Folder structure
See `mobile-app/` for full scaffold.

## 3) Initial mobile screens (Phase 1)
- Login
- Inbox list
- Conversation detail
- Settings (logout)

## 4) Auth flow
1. Staff login via `/api/mobile/auth/login`.
2. Token stored in `expo-secure-store`.
3. Token attached to all API requests.
4. Logout deletes token and returns to login screen.

## 5) Inbox list screen
- Pull-to-refresh
- Search by contact/last message
- Unread indicator (if provided)
- Mode badge for Live/Test awareness

## 6) Conversation detail screen
- Thread rendering for long conversations (`FlatList`)
- Incoming/outgoing differentiation
- Original text + staff/customer translation visibility
- Attachment open trigger
- Timestamps

## 7) Reply composer
- Reply input
- Sending state and failed-send error state
- Safe send guard (disabled when blank/sending)

## 8) API integration plan with current backend
Add mobile-prefixed endpoints in existing Node backend:
- `POST /api/mobile/auth/login`
- `GET /api/mobile/inbox`
- `GET /api/mobile/inbox/:conversationId`
- `POST /api/mobile/inbox/:conversationId/reply`

Implementation principle:
- Reuse current repository/data access modules in `lib/database/repositories/*`.
- Keep Live mode behavior production-safe and unchanged.
- Expose Test mode as explicit runtime metadata (`runtimeMode`) for UI.

## 9) Run/build instructions
From `mobile-app/`:
1. `npm install`
2. `npm run start`
3. Press `a` to run Android emulator.

For direct Android build foundation:
- `npx expo run:android`

## 10) Native vs temporary reuse clarity
- **Fully native now:** navigation, login UI, inbox UI, thread UI, composer UI, secure local token storage, mode badge, mobile settings/logout.
- **Reused from existing backend:** authentication logic, inbox data retrieval, conversation history, send reply flow, runtime mode source of truth.
- **Temporary/reuse fallback:** attachment upload hook is currently placeholder-ready and should connect to existing backend upload pipeline in next step.

## Play Store readiness foundation included
- Android package namespace: `com.lsaglobal.internal`
- Versioned app manifest
- icon/splash/adaptive icon config placeholders
- Future signing + privacy checklist can be layered without architectural rewrite
