# Android APK Build (Durable Path)

This project prefers a **checked-in native Android project** under `mobile-app/android`.

## Root cause behind the current failure

`expo prebuild` attempts to resolve the template package `expo-template-bare-minimum@sdk-51` from npm.
In restricted environments this request is being denied with:

- `npm ERR! code E403`
- `403 Forbidden - GET https://registry.npmjs.org/expo-template-bare-minimum`

When that happens, Expo prints `Failed to create the native directory` and `mobile-app/android` is never created.

## One-time durable setup

Generate and commit `mobile-app/android` once in a trusted environment where npm access to Expo templates is allowed:

```bash
cd mobile-app
npm config set registry https://registry.npmjs.org/
CI=1 npx expo prebuild --platform android
```

Then commit the generated `mobile-app/android` directory.

## CI behavior

Workflow `.github/workflows/android-apk.yml` now:

1. Forces npm public registry (`https://registry.npmjs.org/`).
2. Installs dependencies.
3. If `mobile-app/android` exists, skips generation and builds directly.
4. If missing, tries `expo prebuild`, captures full terminal output, and surfaces root-cause excerpts before failing.
5. Forces React Native bundling flags so debug and release APKs both include `assets/index.android.bundle`.
6. Builds both standalone APK variants with Gradle (`./gradlew :app:assembleDebug :app:assembleRelease`).
7. Verifies each APK actually contains `assets/index.android.bundle` before upload.
8. Uploads artifact `lsa-global-internal-standalone-apks` containing:
   - `mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`
   - `mobile-app/android/app/build/outputs/apk/release/app-release-unsigned.apk`.
