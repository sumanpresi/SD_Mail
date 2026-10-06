plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The signing key is NEVER stored in this repository. GitHub Actions provides it from repository
// secrets (see ANDROID.md). Local builds without a key fall back to the debug key.
val keystorePath: String? = System.getenv("LIFEMAIL_KEYSTORE")
val keystorePassword: String? = System.getenv("LIFEMAIL_KEYSTORE_PASSWORD")
val runNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "com.suman.lifemail"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.suman.lifemail"
        minSdk = 28
        targetSdk = 35
        versionCode = runNumber
        versionName = "1.0.$runNumber"
        // Where the LifeMail web app (Personal) lives, and the Government Workplace home (Work).
        buildConfigField("String", "LIFEMAIL_URL", "\"https://sd-mail-tau.vercel.app\"")
        buildConfigField("String", "WORK_HOME", "\"https://workplace.mgovcloud.in/\"")
    }

    signingConfigs {
        create("release") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = keystorePassword
                keyAlias = System.getenv("LIFEMAIL_KEY_ALIAS") ?: "lifemail"
                keyPassword = keystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.google.android.gms:play-services-auth:21.2.0")
}
