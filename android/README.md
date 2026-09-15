# Vision TR Android

This is a separate Android APK project. It copies the existing GitHub Pages
web assets into the APK at build time; it does not modify the web application.

## Build prerequisites

- Android Studio Ladybug or newer
- Android SDK Platform 35 and Build Tools
- JDK 17

Open this `android/` directory in Android Studio and build the `app` module.

## Offline speech layer

`AndroidVisionBridge` is the boundary between the local WebView and the native
speech engine. The next implementation step is to attach Whisper.cpp `base`
(multilingual) to this bridge and call `deliverTranscript()` for each accepted
Thai command. The model is intentionally excluded from Git and APK source;
it should be downloaded during a release build or first-run setup.

Before a release, add `https://appassets.androidplatform.net/*` to the allowed
HTTP referrers for the Google Maps browser API key. The existing GitHub Pages
referrer must remain in the allow-list for the web version.
