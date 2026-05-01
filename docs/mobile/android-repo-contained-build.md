# Android CI: repo-contained build path (no per-run Expo prebuild)

## Why this change
CI was failing during `expo prebuild` because Expo attempted to fetch:

- `expo-template-bare-minimum@sdk-51`
- request: `GET https://registry.npmjs.org/expo-template-bare-minimum`
- failure: `403 Forbidden`

That blocks native project generation and prevents Gradle/APK steps from running.

## Durable build architecture
The CI workflow now builds from a checked-in native project at:

- `mobile-app/android`

Workflow behavior:
1. install deps (`npm ci`)
2. setup Java 17
3. verify `mobile-app/android/gradlew` exists
4. run `./gradlew assembleDebug`
5. upload artifact

If `mobile-app/android` is missing, workflow fails fast with exact one-time generation instructions.

## One-time generation and commit requirements
Run this once in a local environment where npm can fetch public packages without policy/proxy 403:

```bash
cd mobile-app
npm config set registry https://registry.npmjs.org/
CI=1 npx expo prebuild --platform android
```

Then commit all required native files:

- `mobile-app/android/**`

Recommended verification before commit:

```bash
cd mobile-app/android
chmod +x gradlew
./gradlew assembleDebug
```

## Registry normalization in CI
The workflow now normalizes npm config before install:

- deletes npm `proxy`/`https-proxy` config keys if present
- sets registry to `https://registry.npmjs.org/`
- prints effective registry for traceability

This protects against accidental registry override while still keeping the pipeline independent from recurring Expo template fetching.

## Expected artifact
- artifact name: `lsa-global-internal-debug-apk`
- uploaded file path inside runner:
  - `mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`
