plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "th.visiontr.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "th.visiontr.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        // This is the same public browser key used by the GitHub Pages app.
        // Row-level security still applies because requests use the signed-in user token.
        buildConfigField("String", "SUPABASE_URL", "\"https://eocbxntymzwbgqaodvse.supabase.co\"")
        buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"sb_publishable_FgUG7gVuo0sC_ILhzkToUw_IcZ0FjuZ\"")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { buildConfig = true }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("org.maplibre.gl:android-sdk:11.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
