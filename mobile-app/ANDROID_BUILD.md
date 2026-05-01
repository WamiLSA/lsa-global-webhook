# Android APK Build (Durable Path)

This project now prefers a **checked-in native Android project** under `mobile-app/android`.

## Why

`expo prebuild` requires fetching Expo templates from npm (for example `expo-template-bare-minimum`).
When that fetch is blocked (403), CI cannot generate `android/` and APK build never starts.

To make CI reproducible and independent, generate `android/` once and commit it.

## One-time generation steps (run in a trusted machine)

```bash
cd mobile-app
npm config set registry https://registry.npmjs.org/
CI=1 npx expo prebuild --platform android
```

Then commit the generated `mobile-app/android` directory.

## CI behavior

Workflow `.github/workflows/android-apk.yml` now:

1. Forces npm public registry (`https://registry.npmjs.org/`).
2. Installs dependencies (`npm ci`).
3. Validates `mobile-app/android` exists.
4. Builds debug APK directly with Gradle (`./gradlew assembleDebug`).
5. Uploads artifact `lsa-global-internal-debug-apk` from:
   `mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`.
