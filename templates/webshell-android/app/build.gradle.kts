plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

fun String.escapeForBuildConfig(): String = replace("\\", "\\\\").replace("\"", "\\\"")

val webShellUrl =
    (findProperty("SOLANA_MOBILE_URL") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?: "https://example.com/"
val webShellApplicationId =
    (findProperty("SOLANA_MOBILE_APPLICATION_ID") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?: "com.example.webshell"
val webShellVersionCode =
    (findProperty("SOLANA_MOBILE_VERSION_CODE") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?.toIntOrNull()
        ?: 1
val webShellVersionName =
    (findProperty("SOLANA_MOBILE_VERSION_NAME") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?: "1.0"
val webShellSigningStoreFile =
    (findProperty("SOLANA_MOBILE_KEYSTORE_PATH") as String?)
        ?.trim()
        ?.ifBlank { null }
val webShellSigningStorePassword =
    (findProperty("SOLANA_MOBILE_KEYSTORE_PASSWORD") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?: System
            .getenv("SOLANA_MOBILE_KEYSTORE_PASSWORD")
            ?.trim()
            ?.ifBlank { null }
val webShellSigningKeyAlias =
    (findProperty("SOLANA_MOBILE_KEYSTORE_ALIAS") as String?)
        ?.trim()
        ?.ifBlank { null }
val webShellSigningKeyPassword =
    (findProperty("SOLANA_MOBILE_KEY_PASSWORD") as String?)
        ?.trim()
        ?.ifBlank { null }
        ?: System
            .getenv("SOLANA_MOBILE_KEY_PASSWORD")
            ?.trim()
            ?.ifBlank { null }
val hasReleaseSigning =
    webShellSigningStoreFile != null &&
        webShellSigningStorePassword != null &&
        webShellSigningKeyAlias != null

android {
    namespace = "com.example.webshell"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = webShellApplicationId
        minSdk = 28
        targetSdk = 37
        versionCode = webShellVersionCode
        versionName = webShellVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "SOLANA_MOBILE_URL", "\"${webShellUrl.escapeForBuildConfig()}\"")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("webShellRelease") {
                storeFile = file(webShellSigningStoreFile!!)
                storePassword = webShellSigningStorePassword
                keyAlias = webShellSigningKeyAlias
                keyPassword = webShellSigningKeyPassword ?: webShellSigningStorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("webShellRelease")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.swiperefreshlayout)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
