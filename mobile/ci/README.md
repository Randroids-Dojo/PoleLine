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
