#!/usr/bin/env python3
"""Validate PoleLine build 3 and optionally upload it to App Live."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import sys
import urllib.error
import urllib.request
import uuid
import zipfile


ANDROID_HASHES = {
    ".apk": "dc360d1887b830c89b350f1d458de990253645d3ec6f8ecb2a263ba74b6d5f11",
    ".aab": "84c475ca4c8574d4af39319eb25f2506d4c551127c0475b2bbedbb517ccb5108",
}


def verify(artifact):
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    manifest = json.loads(Path(__file__).with_name("build3-web-manifest.json").read_text())
    with zipfile.ZipFile(artifact) as archive:
        if artifact.suffix == ".ipa":
            info = plistlib.loads(archive.read("Payload/App.app/Info.plist"))
            expected = {
                "CFBundleIdentifier": "app.toyboxes.poleline",
                "CFBundleShortVersionString": "1.0.0",
                "CFBundleVersion": "3",
            }
            if any(info.get(key) != value for key, value in expected.items()):
                raise ValueError("IPA identity does not match PoleLine 1.0.0 build 3")
            prefix = "Payload/App.app/public/"
        elif artifact.suffix in ANDROID_HASHES:
            if digest != ANDROID_HASHES[artifact.suffix]:
                raise ValueError("Android artifact does not match the retained signed build 3")
            prefix = "assets/public/" if artifact.suffix == ".apk" else "base/assets/public/"
        else:
            raise ValueError("Expected a build 3 IPA, APK or AAB")
        for entry in manifest:
            content = archive.read(prefix + entry["path"])
            if len(content) != entry["bytes"] or hashlib.sha256(content).hexdigest() != entry["sha256"]:
                raise ValueError(f"Packaged web asset differs: {entry['path']}")
    return {"file": artifact.name, "bytes": artifact.stat().st_size, "sha256": digest,
            "bundleId": "app.toyboxes.poleline", "version": "1.0.0", "build": 3,
            "verifiedWebFiles": len(manifest)}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("BrowserStack upload redirected; credentials were not forwarded")


def upload(artifact, username, access_key):
    boundary = "poleline-" + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
            f'filename="{artifact.name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()
    body += artifact.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    credential = base64.b64encode(f"{username}:{access_key}".encode()).decode()
    request = urllib.request.Request("https://api-cloud.browserstack.com/app-live/upload", data=body,
        headers={"Authorization": "Basic " + credential,
                 "Content-Type": "multipart/form-data; boundary=" + boundary}, method="POST")
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=90) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(f"BrowserStack upload returned HTTP {error.code}") from None
    except urllib.error.URLError:
        raise ValueError("BrowserStack upload could not connect") from None
    app_url = result.get("app_url")
    if not isinstance(app_url, str) or not app_url.startswith("bs://"):
        raise ValueError("Upload response did not confirm a BrowserStack app identifier")
    return app_url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--if-configured", action="store_true")
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    receipt = verify(args.artifact)
    receipt["toolingCommit"] = os.environ.get("GITHUB_SHA")
    username = os.environ.get("BROWSERSTACK_USERNAME")
    access_key = os.environ.get("BROWSERSTACK_ACCESS_KEY")
    if args.dry_run:
        receipt["uploadState"] = "validation_only"
    elif not username or not access_key:
        if not args.if_configured:
            raise ValueError("BrowserStack repository secrets are not configured")
        receipt["uploadState"] = "not_configured"
    else:
        receipt["appUrl"] = upload(args.artifact, username, access_key)
        receipt["uploadState"] = "uploaded"
    if args.receipt:
        args.receipt.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile):
        # Do not echo request details, responses, environment values or credentials.
        print("Build validation or BrowserStack upload failed. No credentials were logged.", file=sys.stderr)
        sys.exit(1)
