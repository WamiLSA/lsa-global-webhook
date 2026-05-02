# OTA updates workflow (Expo + EAS Update)

This app is configured for over-the-air (OTA) updates using Expo Updates and EAS Update.

## Current update model

- **Runtime compatibility is pinned to app version** via:
  - `expo.runtimeVersion.policy = "appVersion"`.
- **Channel-based rollout** is configured in `eas.json`:
  - `development` build profile -> `development` channel
  - `preview` build profile -> `preview` channel
  - `production` build profile -> `production` channel

This means OTA updates will apply only to builds with the same `runtimeVersion` (same app version).

## When OTA updates are safe (no reinstall)

You can publish OTA updates for non-native changes, including:

- JavaScript/TypeScript logic
- UI/styling/layout
- navigation changes
- static assets bundled by Metro/Expo (images/fonts already part of app updates flow)

Use one of:

```bash
npm run update:preview
npm run update:production
```

(or the equivalent `eas update --branch <branch>` command with a clear message).

## When a new APK/AAB build is required

You must rebuild and redistribute when changes affect native runtime, for example:

- adding/removing/upgrading native modules
- Expo SDK / React Native version changes
- Android/iOS native project changes
- permissions/config that require native rebuild
- any change that modifies runtime expectations

In those cases:

1. bump `expo.version` in `app.json` to move to a new runtime
2. produce fresh build with EAS (`preview`/`production` profile)
3. distribute/install the new binary
4. continue OTA updates on that new runtime

## In-app user experience

The app now includes a lightweight update banner that:

1. checks for update availability on app load in production binaries
2. shows **"A new update is available"** with **"Tap to update"**
3. downloads update and shows **"Restart app to apply update"**
4. reloads app when user taps restart

This keeps behavior clear and non-technical for internal staff.
