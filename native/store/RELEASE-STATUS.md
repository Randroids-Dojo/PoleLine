# Native mobile release status

This receipt is in progress. It does not establish store submission or publication.

## Verified

- Cloned PoleLine into `C:\Users\randr\Dev\PoleLine`, branch `feat/toyboxes-native-offline`.
- Upstream web checks: 44 tests passed, production build passed before edits.
- Native C++ core: all 25 fictional circuits and 75 tyre combinations passed deterministic timing, sector sums, telemetry, full-loop validation, shortcut/reverse/off-road rejection, native drawing completion and undo on MSVC x64.
- Native Android release APK, AAB and release lint build passed.
- Google Play is authenticated to the Toyboxes organization account, ID `4940278051196101377`.

## In progress

- Native Android real touch, offline first-launch, persistence, replay, lifecycle and screenshot checks.
- iOS compilation, simulator tests and screenshots.
- Signed artifact verification and store listing setup.

## Pending external details

- The user chose a paid download and will supply the price. Do not choose or publish a price without that input.
- The current execution environment reports `randroid-pc` on Windows. The configured `Mac-Codex` SSH endpoint refuses connections. The user identified another Mac Codex; its connection address is pending.
- App Store Connect in the available browser requires authentication. No Apple team or distribution identity has been verified.

## Store submission

Neither store has received this build for review. Update this section only with directly verified store evidence and exact artifact hashes.
