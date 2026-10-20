# PoleLine by Toyboxes

Draw a racing line, choose your tyres, then watch an original open-wheel toy racer follow it. Chase medals and your own personal best ghost across 25 original fictional circuits. All gameplay and content work offline from the first launch.

- Android: Kotlin, platform widgets and Canvas. Android 8.0 or later, target API 36, arm64 and x86_64.
- iOS: SwiftUI, Canvas and an Objective-C++ bridge. iOS 17 or later, iPhone and iPad.
- Shared C++17 simulation and track-limit validation. No WebViews, downloaded tracks, accounts, ads, in-app purchases, analytics or servers.
- Package and bundle ID: `app.toyboxes.poleline`, version `1.0.0`, build `1`.
- Publisher: Toyboxes, Randroid LLC. Paid download. Price pending the publisher's instruction.

The native build consumes only `native/`. It does not package the original web game's real-world circuits, team colours, web assets or API routes. The original source remains available outside this directory.

## Build and test

```sh
node native/scripts/generate-circuits.mjs
node native/scripts/check-release.mjs
cmake -S native/shared -B native/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/build --config Release
ctest --test-dir native/build -C Release --output-on-failure
cd native/android
./gradlew assembleRelease bundleRelease lintRelease
```

Android uses JDK 17, SDK 36, NDK 27.1.12297006 and CMake 3.22.1. It explicitly builds libraries with 16 KB page alignment. Release and debug builds remain unsigned until the retained identity signs them. On the configured Windows publishing machine run `native/scripts/sign-android.ps1 -Kind upload` from PowerShell. Signing material is never stored in this repository.

For native Android instrumentation, build `assembleReleaseAndroidTest`, sign both test and release APKs with the retained upload identity using `native/scripts/sign-android.ps1 -Kind upload -IncludeTests`, install them, then run:

```sh
adb shell am instrument -w app.toyboxes.poleline.test/androidx.test.runner.AndroidJUnitRunner
```

On a Mac with Xcode 26 or later and XcodeGen installed:

```sh
cd native/ios
xcodegen generate
xcodebuild test -project PoleLine.xcodeproj -scheme PoleLine \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO
```

Choose an available simulator from `xcrun simctl list devices available`. For App Store distribution, set the existing Toyboxes Apple team in Xcode, archive for a generic iOS device, then validate and distribute with the retained Apple signing identity. Do not generate or replace signing identities to bypass missing account access.

GitHub Actions runs portable simulation tests, the Android release build and lint, and iOS native tests. Simulator outputs are verification artifacts, not signed App Store submissions.

## Content and saves

`native/scripts/generate-circuits.mjs` authors independent harmonic layouts. It reads no upstream circuit data. Gold, silver and bronze targets come from the fictional car's own simulated pace, not real qualifying times. Six original team names and colour schemes are selectable.

The C++ core rejects off-road segments, backward laps, shortcuts, invalid points and incomplete loops. A forward/backward speed solver accounts for curvature, downforce, braking, power, battery limits and tyre temperature. Native timing is independently versioned from the web simulation.

Personal best lines, tyres, sectors and settings persist locally using Android SharedPreferences and iOS UserDefaults. Best ghosts are reconstructed from saved lines. No network permission is requested on Android. iOS makes no network requests. Uninstalling removes app data. iOS device backups are managed by the operating system.

## Release evidence

Store copy and content declarations live in `native/store/`. Current receipts and remaining release blockers live in `native/store/RELEASE-STATUS.md`. Screenshots and signed artifacts are collected in the ignored `release-artifacts/` directory.
