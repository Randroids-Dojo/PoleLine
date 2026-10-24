# Build 3 cloud evidence

`mobile-release-check.yml` runs the existing installed-app iOS touch checks on
an iPhone and an iPad simulator using GitHub's Mac runners. It also creates an
unsigned ARM64 device IPA for a provider that can re-sign it. No signing key or
password is created, copied, exported or included in these artifacts.

`build3-web.zip` is a temporary release fixture copied byte for byte from the
checked web directory inside the signed Android build 3. Its file manifest is
`build3-web-manifest.json`. The CI bundle from the original main-branch run has
different line endings in its HTML and source maps, so it is not substituted
for the retained bundle. Both native test builds must contain the exact 71
retained files and pass `toybox:check`.

The simulator tests check the first launch, Skip, circuits, settings, and one
drawing stroke. Result bundles contain unedited screenshots and the workflow
also records the simulator screen. These checks do not establish complete lap,
sound, haptics, real-device performance, or App Store distribution acceptance.
The IPA is not distribution signed and is not suitable for App Store upload.

Evidence includes the simulator identity, Xcode version, build and test logs,
asset verification, the unsigned IPA identity, and the IPA SHA-256.
The `screenshots` directory exports the original PNG attachments from the result
bundle with Apple's `xcresulttool`; the images are not resized or edited.

## BrowserStack and Firebase

For a quick credential and product-access check, dispatch the workflow with
`cloud_access_only=true`. It reads App Live uploads, App Automate uploads and
the App Automate plan through the documented provider APIs. Its receipt keeps
only PoleLine app identifiers and plan capacity, with no credential values.
This mode starts no devices and does not establish gameplay acceptance.

`cloud_device_command` accepts a native device command JSON object. `start`
reuses the fixed App Automate upload of the retained signed APK, verified in
bootstrap run 40038034714 against its exact hash and all 71 web files. It opens
a Pixel 8 Pro session with video and audio requested. Later commands use the
returned session ID for touch input, screenshots, lifecycle checks and
provider-supported adb diagnostics. `stop` releases the device. `recording`
downloads its original video through the provider API without exposing signed
access links or forwarding credentials to storage redirects. Screenshots
remain original PNG files. The receipt records that server bytes were not
downloaded or revalidated for each session. Other app identifiers are rejected.
The controller never injects a lap or changes game data. A command receipt is
not a completed acceptance checklist. All secrets remain in runner memory.
`orientation` accepts only PORTRAIT or LANDSCAPE and captures the resulting
display. Restore PORTRAIT after an attempt and verify the device's original
auto-rotate setting. `cold-start` terminates and reopens only PoleLine; it tries
the fixed `am start -W` command for TotalTime and restores the app even when the
provider rejects that command. An unsupported timing receipt is not a pass.
`sequence` replays at most 32 touch/observation steps on the same session, with
at most 45 seconds of touch movement. It validates every step before input,
saves an original screenshot and UI source after each step, and stops when the
game displays Track limits. This is used for an additional saved lap comparison
after the two required circuits have been traced individually on screen.

App Live and App Automate require separate uploads. The one-time upload used a
short-lived job token with `contents: write` because GitHub rejected access to
the private draft QA asset with its normal read-only token. That bootstrap job
and its write grant were removed immediately after the verified upload. The
remaining workflow has only `contents: read` permission. No release was
published and no device was started by the bootstrap job.

The iPhone job can upload its verified device IPA to BrowserStack App Live.
Configure `BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY` as private
repository Actions secrets. Enter them directly in GitHub. No credential is
stored in the repository, command arguments, logs or receipts. Without these
secrets the job records `not_configured`, which is not a successful upload.
BrowserStack re-signs the device IPA with its own provisioning profile.

`upload-browserstack.py` also accepts the retained, signed build 3 APK or AAB.
It checks the exact Android artifact hash or iOS identity and all 71 retained
web files before making any request. Use `--dry-run` to validate without network
access. The receipt records the artifact hash and confirmed BrowserStack app ID.
This upload does not start a device test or upload anything to either store.

The isolated Firebase project is `poleline-release-qa`, on the Spark plan with
Google Analytics disabled. The Android app is `app.toyboxes.poleline`.
Firebase App Distribution contains the retained signed build 3 APK and release
notes. No testers were invited. BrowserStack's Firebase source additionally
requires a Google OAuth web client with this redirect URI:
`https://app-live.browserstack.com/firebase/oauth`. Its connection is pending
Google Cloud re-authentication and approval of the displayed OAuth access.

Provider documentation:
- https://www.browserstack.com/app-live/rest-api
- https://www.browserstack.com/docs/app-live/app-source/firebase-integration
