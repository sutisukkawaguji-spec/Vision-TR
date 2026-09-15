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
    }

    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
}

val webRoot = rootProject.projectDir.parentFile
val generatedWebAssets = layout.buildDirectory.dir("generated/visiontr-assets")

val syncVisionTrWebAssets by tasks.registering(Copy::class) {
    from(webRoot) {
        include("index.html", "app.js", "config.js", "manifest.json", "service-worker.js")
        include("favicon.png", "icon.png", "icon-192.png")
    }
    into(generatedWebAssets)
}

android.sourceSets.getByName("main").assets.srcDir(generatedWebAssets)
tasks.named("preBuild").configure { dependsOn(syncVisionTrWebAssets) }
