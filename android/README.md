# Vision TR Android

This is a separate, native Android APK project. It does not use WebView and it
does not copy the GitHub Pages interface into the APK. The GitHub Pages web app
is left unchanged.

The Android app signs in to the same Supabase project as the web app. Requests
include the signed-in user's token, so the existing Supabase Row Level Security
rules determine which plots that user can see.

## Current native features

- Email/password sign-in with Supabase Auth
- Reads `base_plots` directly from the shared Supabase database
- Native search of the user's plot list
- Opens the selected plot in the installed map/navigation app
- Shows the device's last known GPS location after permission is granted

## Build prerequisites

- Android Studio Ladybug or newer
- Android SDK Platform 35 and Build Tools
- JDK 17

Open this `android/` directory in Android Studio and build the `app` module.
The resulting debug APK is at `app/build/outputs/apk/debug/app-debug.apk`.

The public Supabase client key embedded in the APK is not a database password.
Data access is protected by Supabase authentication and RLS; never add a
Supabase `service_role` key to this project.
