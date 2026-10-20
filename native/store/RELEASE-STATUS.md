# Native mobile release status

Release candidate: PoleLine 1.0.0, build 2, `app.toyboxes.poleline`. Publisher: Toyboxes, Randroid LLC. Paid download; exact price pending the user.

## Implementation and verification

- Native Android uses Kotlin, platform widgets and Canvas. Native iOS uses SwiftUI and Canvas. Both share a C++17 simulation and bundle 25 original fictional circuits and six fictional teams. The native bundles exclude the original web game's licensed sporting content, circuit layouts, web assets and server routes.
- Gameplay, tyre selection, line drawing, timing, sectors, medals, personal bests and ghost replays operate locally. No accounts, ads, in-app purchases, analytics, runtime downloads or game servers. Android requests zero permissions and disables cloud backup and device transfer. iOS local app data can be included in operating-system backups.
- The unchanged upstream web suite passed 44 tests and a production build.
- Shared simulation passed deterministic timing, all 75 circuit/tyre combinations, sector sums, finite monotonic telemetry, native drawing completion and undo, and rejection of shortcuts, reverse laps, off-road segments and malformed input on Windows and Linux.
- Android release build and lint passed. The exact signed build 2 APK passed both native instrumentation tests in airplane mode (14.608 seconds), including real pointer input, race, pause/resume, results, repeated replay results and local persistence. Portrait and landscape layouts were inspected. No physical-device test has been performed.
- APK signatures verify under v2/v3, AAB JAR signature and bundletool validation pass, and 16 KB APK alignment passes. Both packaged native libraries also have 0x4000 ELF load alignment. Package version is 1.0.0/code 2, min API 26, target API 36, arm64-v8a and x86_64, non-debuggable.
- Final build 2 iPhone unit and full touch UI tests passed: 3 unit tests and 2 UI tests, including repeated personal-best results and persistence after relaunch. The full touch test passed in 113.877 seconds on iPhone 17 Pro. The separate first-circuit UI test passed on iPad Pro 13-inch (M5), and the unsigned Release device archive succeeded using Xcode 26.6. All three jobs passed in https://github.com/Randroids-Dojo/PoleLine/actions/runs/39364898437, verification commit `b72b88222cb895232f740be0ed1d6693dbedbe3f`. The iPhone screenshots are 1206x2622; iPad screenshots are 2064x2752. An unsigned archive is not an App Store distribution artifact.
- `node native/scripts/check-release.mjs` passes and now also runs in CI. This source check is not a legal clearance opinion.

## Frozen Android candidate

Runtime source commit: `9e9a1415472fd47f6592eaf30540762dff907888`. Later test/workflow edits do not change the app runtime.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `release-artifacts/poleline-1.0.0-upload-signed.aab` | 2131992 | `d894576d305c8a0aa39f683c91c35c971cb4a639821189c93b0a7d55d1a023ce` |
| `release-artifacts/poleline-1.0.0-upload-signed.apk` | 2786896 | `826b61bab6b749386f0ba853704b944661fab1d123ba9668f00c6851d3161451` |

Both hashes were independently checked with Get-FileHash and certutil. Retained upload certificate SHA-256: `0e6da2776f5ad1932ee49c2f0ccc4816fc9f4d0b4606a77bb5d49debae879553`. Local signing material was not created, replaced, copied, exported or disclosed.

## Live Google Play state

- Toyboxes developer account: `4940278051196101377`. PoleLine app: `4975227597757531667`.
- [Dashboard](https://play.google.com/console/u/0/developers/4940278051196101377/app/4975227597757531667/app-dashboard): 12 of 13 setup items complete; the paid price remains unset.
- Privacy policy, no sign-in, no ads, no collection/sharing, no government/financial/health features, Racing category, support contact, content rating and English listing are saved. Target audience: ages 13 and above. Regional content ratings include Everyone and PEGI 3.
- Original icon and feature graphic plus four actual native Android screenshots are attached. The authored icon and feature graphic are declared as AI-assisted assets; screenshots are unaltered app captures.
- Production draft `1.0.0 (2)` contains only build 2 and its release notes. Google processed the bundle. It has not been sent for review, rolled out or published.
- Installer check is disabled globally, and build 2's enhancement details confirm automatic protection, Sidekick and automatic translation are off. The initial protected build 1 was removed from the release and must not be released. Google requires a new version code to apply the offline setting, which is why this first release uses build 2. Google's installer check can periodically require a data connection: https://support.google.com/googleplay/android-developer/answer/10183279.
- Play App Signing is configured to reuse the existing Joker's Run key through the developer-account key selector, without handling private material. Play signing SHA-256: `af827868488e860ce85ed085e7e30389c7de028b2dc499919f65614a81ce06d6`. The retained local upload identity is unchanged.
- Release preview has two blocking errors: complete the remaining dashboard pricing step and select countries/regions. The sole build warning is the absence of a deobfuscation map; release minification is disabled.

## Toyboxes public pages

- [Privacy](https://toyboxes.app/games/poleline/privacy/) and [player support](https://toyboxes.app/games/poleline/support/) are live.
- https://github.com/Randroids-Dojo/ToyboxesApp/pull/1 and https://github.com/Randroids-Dojo/ToyboxesApp/pull/2 were merged. The production deployment was checked at desktop and mobile widths. All seven pages, 22 assets, sitemap and real 404 passed the live site check.

## Remaining external prerequisites

- The user chose a paid download and will supply the amount and base currency. Do not invent a price. Set regional pricing and release markets before submitting the Play release.
- The execution host reports `randroid-pc` on Windows. Configured `Mac-Codex` at `192.168.68.52` refuses SSH. The user requested their other Mac Codex; its reachable address and SSH access have not been supplied. No other Mac endpoint is configured here.
- App Store Connect requires sign-in in both the collaborative browser and the existing Edge profile. No Toyboxes Apple team, retained distribution identity or provisioning profile has been verified. No Apple app record, signed archive, upload or review submission has been created.
- Finish signed iOS distribution using the existing Toyboxes team and identity after access is available. Validate and upload the exact signed archive; complete the Apple listing, screenshots, privacy, age rating and paid pricing before submission.

Neither store has received this release for review. Submission, approval and publication are separate states.