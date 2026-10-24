#!/bin/bash
set -euo pipefail

poleline_kind="${1:?iphone or ipad required}"
poleline_out="${2:?new evidence directory required}"
mkdir -p "$poleline_out"
poleline_out="$(cd "$poleline_out" && pwd)"
poleline_repo="$(pwd)"
poleline_app_project="$poleline_repo/mobile/ios/App/App.xcodeproj"
poleline_manifest="$poleline_repo/mobile/ci/build3-web-manifest.json"

xcodebuild -version > "$poleline_out/xcode-version.log"
git rev-parse HEAD > "$poleline_out/tooling-commit.log"
xcrun simctl list devices available -j > "$poleline_out/available-devices.json"
poleline_udid="$(python3 - "$poleline_kind" "$poleline_out" <<'PY'
import json, re, sys
from pathlib import Path
kind, out = sys.argv[1], Path(sys.argv[2])
devices = json.loads((out / "available-devices.json").read_text())["devices"]
candidates = []
for runtime, entries in devices.items():
    version = tuple(map(int, re.findall(r"\d+", runtime)))
    for device in entries:
        name = device["name"]
        if not device.get("isAvailable"):
            continue
        if kind == "iphone" and "iPhone" in name:
            score = ("Pro Max" in name, "17 Pro Max" in name, version)
        elif kind == "ipad" and "iPad" in name:
            score = ("13-inch" in name or "12.9-inch" in name, "Pro" in name, version)
        else:
            continue
        candidates.append((score, runtime, device))
if not candidates:
    raise SystemExit(f"No available {kind} simulator")
_, runtime, device = max(candidates, key=lambda entry: entry[0])
(out / "device.json").write_text(json.dumps({"runtime": runtime, **device}, indent=2))
print(device["udid"])
PY
)"

# Build 3 remains unsigned here. No signing identity is created or exported.
if [[ "$poleline_kind" == "iphone" ]]; then
    xcodebuild -project "$poleline_app_project" -scheme App -configuration Release \
        -destination 'generic/platform=iOS' -derivedDataPath "$poleline_out/device-build" \
        CODE_SIGNING_ALLOWED=NO build > "$poleline_out/device-build.log" 2>&1
    poleline_device_app="$poleline_out/device-build/Build/Products/Release-iphoneos/App.app"
    python3 mobile/ci/verify-web.py "$poleline_device_app/public" "$poleline_manifest" --native-shell
    python3 - "$poleline_device_app/Info.plist" "$poleline_out" <<'PY'
import json, plistlib, sys
from pathlib import Path
info = plistlib.loads(Path(sys.argv[1]).read_bytes())
expected = {"CFBundleIdentifier": "app.toyboxes.poleline", "CFBundleShortVersionString": "1.0.0", "CFBundleVersion": "3"}
for key, value in expected.items():
    if info[key] != value:
        raise SystemExit(f"Unexpected {key}: {info[key]}")
Path(sys.argv[2], "device-identity.json").write_text(json.dumps({**expected, "signed": False, "storeUploadReady": False}, indent=2))
PY
    mkdir -p "$poleline_out/package/Payload"
    ditto "$poleline_device_app" "$poleline_out/package/Payload/App.app"
    ditto -c -k --keepParent "$poleline_out/package/Payload" "$poleline_out/poleline-1.0.0-build3-device-unsigned.ipa"
    (cd "$poleline_out" && shasum -a 256 *.ipa > SHA256SUMS.txt)
fi

xcodebuild -project "$poleline_app_project" -scheme App -configuration Release \
    -destination "platform=iOS Simulator,id=$poleline_udid" -derivedDataPath "$poleline_out/simulator-build" \
    CODE_SIGNING_ALLOWED=NO build > "$poleline_out/simulator-build.log" 2>&1
poleline_simulator_app="$poleline_out/simulator-build/Build/Products/Release-iphonesimulator/App.app"
python3 mobile/ci/verify-web.py "$poleline_simulator_app/public" "$poleline_manifest" --native-shell
xcrun simctl boot "$poleline_udid"
xcrun simctl bootstatus "$poleline_udid" -b > "$poleline_out/simulator-boot.log" 2>&1
xcrun simctl install "$poleline_udid" "$poleline_simulator_app"

# Use the same pinned generator as the verified SplitShot cloud workflow.
mkdir -p "$poleline_out/tools"
curl --fail --location --retry 3 --connect-timeout 15 --max-time 120 \
    https://github.com/yonaskolb/XcodeGen/releases/download/2.45.4/xcodegen.zip \
    --output "$poleline_out/tools/xcodegen.zip"
printf '%s  %s\n' 090ec29491aad50aec10631bf6e62253fed733c50f3aab0f5ffc86bc170bdbef "$poleline_out/tools/xcodegen.zip" | shasum -a 256 -c -
ditto -x -k "$poleline_out/tools/xcodegen.zip" "$poleline_out/tools"
"$poleline_out/tools/xcodegen/bin/xcodegen" generate --spec mobile/ios/Playtest/project.yml

xcrun simctl io "$poleline_udid" recordVideo "$poleline_out/simulator.mp4" > "$poleline_out/recording.log" 2>&1 &
poleline_recording_pid=$!
poleline_finish() {
    kill -INT "$poleline_recording_pid" 2>/dev/null || true
    wait "$poleline_recording_pid" 2>/dev/null || true
    xcrun simctl io "$poleline_udid" screenshot "$poleline_out/final-screen.png" || true
}
trap poleline_finish EXIT
xcodebuild test -project mobile/ios/Playtest/Playtest.xcodeproj -scheme Playtest \
    -destination "platform=iOS Simulator,id=$poleline_udid" \
    -derivedDataPath "$poleline_out/test-build" -resultBundlePath "$poleline_out/tests.xcresult" \
    -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO > "$poleline_out/ui-tests.log" 2>&1

# Export the unedited screen attachments for visual review and store preparation.
xcrun xcresulttool help export attachments > "$poleline_out/attachment-export-help.log"
xcrun xcresulttool export attachments --path "$poleline_out/tests.xcresult" \
    --output-path "$poleline_out/screenshots" > "$poleline_out/attachment-export.log" 2>&1
