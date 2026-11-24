plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

android {
  namespace = "com.peakbrowser.mobile"
  compileSdk = 36

  defaultConfig {
    applicationId = "com.peakbrowser.mobile"
    minSdk = 26
    targetSdk = 36
    versionCode = 130
    versionName = "1.3.0"
  }

  signingConfigs {
    create("release") {
      val ksPath = System.getenv("PEAK_KEYSTORE_PATH")
      if (!ksPath.isNullOrBlank()) {
        storeFile = file(ksPath)
        storePassword = System.getenv("PEAK_KEYSTORE_PASS") ?: "peakbrowser130"
        keyAlias = System.getenv("PEAK_KEY_ALIAS") ?: "peakbrowser"
        keyPassword = System.getenv("PEAK_KEYSTORE_PASS") ?: "peakbrowser130"
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      val ksPath = System.getenv("PEAK_KEYSTORE_PATH")
      if (!ksPath.isNullOrBlank()) {
        signingConfig = signingConfigs.getByName("release")
      }
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    compose = true
    aidl = false
    buildConfig = false
    shaders = false
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }
}

kotlin {
  jvmToolchain(17)
}

dependencies {
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  androidTestImplementation(composeBom)

  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)

  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  implementation("androidx.compose.material:material-icons-extended")

  debugImplementation(libs.androidx.compose.ui.tooling)
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.test.manifest)

  testImplementation(libs.junit)
}
