# PoleLine mobile shell

The mobile apps are the web game in a native shell. Capacitor wraps the Vite build (`npm run build:toybox`, output in `dist-toybox`) in an Android project at `mobile/android` and an iOS project at `mobile/ios`. The game draws, simulates and stores everything on the device; the shell adds the app icon, splash screen, haptics, keep awake, the share sheet and the system bars, and nothing else. There is no network access at all: the Android manifest requests no permissions.

Identity: app id `app.toyboxes.poleline`, name PoleLine, publisher Toyboxes (Randroid LLC), version 1.0.0, Android `versionCode` 3, iOS `CFBundleVersion` 3.

## Prerequisites

- Node 22 and the repo's `npm install`.
- Android: JDK 21, the Android SDK with platform 36 and the emulator. Gradle reads the SDK path from `mobile/android/local.properties` (`sdk.dir=...`, not committed) or `ANDROID_HOME`.
- iOS: Xcode 16 or later on a Mac. Capacitor 8 uses Swift Package Manager, so there is no Podfile and no workspace; open `mobile/ios/App/App.xcodeproj`.

## Scripts

```bash
npm run build:toybox     # typecheck, then build the mobile edition into dist-toybox
npm run mobile:sync      # build, then copy the bundle and plugins into both projects
npm run mobile:android   # open the Android project in Android Studio
npm run mobile:ios       # open the Xcode project
npm run mobile:assets    # regenerate icons and splash screens from mobile/assets
```

Run `npm run mobile:sync` after every change to the game or to `capacitor.config.ts`, then build in Android Studio or Xcode. `node mobile/assets/make.mjs` rebuilds the source art in `mobile/assets` from `public/icon.svg` before `npm run mobile:assets`.

## Versioning

Bump `versionCode` in `mobile/android/app/build.gradle` and `CURRENT_PROJECT_VERSION` in `mobile/ios/App/App.xcodeproj/project.pbxproj` together, one step per store upload. Change `versionName` and `MARKETING_VERSION` together when the player facing version changes.

## Signing

No signing material lives in this repository. The Android upload key is held outside this Mac and Play App Signing is enabled for the listing, so a release bundle built here stays unsigned until the key holder signs it. iOS signs through the Toyboxes Apple team in Xcode (automatic signing on the App target).

## Verification

```bash
npm run mobile:sync

# Android debug build, emulator, screenshot
cd mobile/android && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew assembleDebug
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_36.0 -no-window -gpu swiftshader_indirect -no-snapshot -no-audio -port 5584 &
export ANDROID_SERIAL=emulator-5584
adb wait-for-device && adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.toyboxes.poleline/.MainActivity
adb exec-out screencap -p > /tmp/poleline-android.png
adb shell dumpsys package app.toyboxes.poleline | grep -A3 'requested permissions'   # prints nothing: no permissions

# iOS simulator build, install, screenshot (pick any installed iPhone; xcrun simctl list devices)
cd mobile/ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath ../DerivedData build
xcrun simctl boot "iPhone 17 Pro"
xcrun simctl install booted ../DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted app.toyboxes.poleline
xcrun simctl io booted screenshot /tmp/poleline-ios.png

# Release configuration compiles without a signing identity
xcodebuild -project App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

Look at the screenshots: the home screen (wordmark, circuit strip, Draw a lap) must be fully visible with dark system bar icons over the paper background and nothing hidden under the bars.
