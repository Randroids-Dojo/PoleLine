#!/usr/bin/env python3
"""Operate a retained-build cloud device through fixed provider endpoints."""

import argparse
import base64
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import struct
import time
import urllib.error
import urllib.request
import uuid


spec = importlib.util.spec_from_file_location("upload", Path(__file__).with_name("upload-browserstack.py"))
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)
API = "https://api-cloud.browserstack.com"
HUB = "https://hub-cloud.browserstack.com/wd/hub"
PACKAGE = "app.toyboxes.poleline"
RETAINED_APP_AUTOMATE = "bs://20da9a9ba3cb51710a9f4ad8a99a3adebdcb018a"
DIAGNOSTICS = {
    "package": "dumpsys package app.toyboxes.poleline",
    "frames": "dumpsys gfxinfo app.toyboxes.poleline",
    "activity": 'dumpsys activity -p app.toyboxes.poleline activities | grep -E "mResumedActivity"',
}


class ProviderError(Exception):
    def __init__(self, status, body):
        super().__init__("Provider request failed")
        self.status = status
        code = re.search(r"\b(BROWSERSTACK_[A-Z0-9_]+)\b", str(body))
        self.code = code.group(1) if code else None
        text = str(body).lower()
        self.category = "provider_error"
        for marker, category in (("free trial", "trial_limit"), ("invalid username", "authentication"),
                                 ("invalid access", "authentication"), ("app not found", "app_unavailable"),
                                 ("invalid app", "app_unavailable"), ("parallel", "parallel_limit"),
                                 ("not supported", "unsupported")):
            if marker in text:
                self.category = category
                break


def request(base, route, authorization, method="GET", payload=None, content_type="application/json"):
    if base not in (API, HUB) or not route.startswith("/"):
        raise ValueError("Unexpected provider destination")
    body = json.dumps(payload).encode() if isinstance(payload, dict) else payload
    req = urllib.request.Request(base + route, data=body, method=method,
        headers={"Authorization": authorization, "Content-Type": content_type})
    try:
        with urllib.request.build_opener(upload.NoRedirect).open(req, timeout=180) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise ProviderError(error.code, error.read()) from None
    if isinstance(result, dict) and isinstance(result.get("value"), dict) and result["value"].get("error"):
        raise ProviderError(200, result["value"]) from None
    return result


def upload_app(apk, authorization):
    artifact = upload.verify(apk)
    boundary = "poleline-" + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
            f'filename="{apk.name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()
    body += apk.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    result = request(API, "/app-automate/upload", authorization, "POST", body,
                     "multipart/form-data; boundary=" + boundary)
    app_url = result.get("app_url", "")
    if not re.fullmatch(r"bs://[A-Za-z0-9_-]+", app_url):
        raise ValueError("App upload not confirmed")
    return app_url, artifact


def touch(points, duration):
    if not isinstance(points, list) or not 1 <= len(points) <= 80:
        raise ValueError("Expected between 1 and 80 touch points")
    if not isinstance(duration, int) or not 50 <= duration <= 2000:
        raise ValueError("Touch duration is out of range")
    for point in points:
        if not isinstance(point, list) or len(point) != 2 or any(
                not isinstance(v, int) or not 0 <= v <= 10000 for v in point):
            raise ValueError("Invalid touch coordinates")
    actions = [{"type": "pointerMove", "duration": 0, "origin": "viewport",
                "x": points[0][0], "y": points[0][1]}, {"type": "pointerDown", "button": 0}]
    actions.extend({"type": "pointerMove", "duration": duration, "origin": "viewport", "x": x, "y": y}
                   for x, y in points[1:])
    actions.extend([{"type": "pause", "duration": 80}, {"type": "pointerUp", "button": 0}])
    return {"actions": [{"type": "pointer", "id": "finger", "parameters": {"pointerType": "touch"},
                         "actions": actions}]}


def execute(command, apk, output, authorization, receipt):
    action = command.get("action")
    if action not in ("start", "observe", "tap", "stroke", "back", "home", "resume", "diagnostics", "stop"):
        raise ValueError("Unknown device action")
    receipt.update(action=action, checkedAtUtc=datetime.now(timezone.utc).isoformat(),
                   toolingCommit=os.environ.get("GITHUB_SHA"), fullDeviceAcceptance=False)
    if action == "start":
        app_url = command.get("appUrl", RETAINED_APP_AUTOMATE)
        if app_url != RETAINED_APP_AUTOMATE:
            raise ValueError("Only the retained verified App Automate upload can be reused")
        receipt["artifact"] = {"sha256": upload.ANDROID_HASHES[".apk"],
            "source": "Verified signed APK uploaded by bootstrap run 40038034714",
            "serverBytesRevalidated": False}
        receipt["appUrl"] = app_url
        options = {"projectName": "PoleLine build 3", "buildName": "PoleLine native acceptance",
                   "userName": os.environ.get("BROWSERSTACK_USERNAME", "").strip(),
                   "accessKey": os.environ.get("BROWSERSTACK_ACCESS_KEY", "").strip(),
                   "sessionName": "Pixel 8 Pro signed build 3", "video": True, "audio": True,
                   "deviceLogs": True, "networkLogs": False, "idleTimeout": 300}
        caps = {"platformName": "Android", "appium:deviceName": "Google Pixel 8 Pro",
                "appium:platformVersion": "14.0", "appium:automationName": "UIAutomator2",
                "appium:app": app_url, "appium:newCommandTimeout": 300, "bstack:options": options}
        result = request(HUB, "/session", authorization, "POST",
                         {"capabilities": {"alwaysMatch": caps, "firstMatch": [{}]}})
        session = result.get("value", {}).get("sessionId") or result.get("sessionId")
        receipt["state"] = "started"
        receipt["videoAndAudioRequested"] = True
    else:
        session = command.get("sessionId", "")
        receipt["state"] = "command_completed"
    if not isinstance(session, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", session):
        raise ValueError("Invalid session identifier")
    receipt["sessionId"] = session
    prefix = "/session/" + session
    if action in ("tap", "stroke"):
        request(HUB, prefix + "/actions", authorization, "POST",
                touch(command.get("points"), command.get("durationMs", 350)))
    elif action == "back":
        request(HUB, prefix + "/back", authorization, "POST", {})
    elif action == "home":
        request(HUB, prefix + "/appium/device/press_keycode", authorization, "POST", {"keycode": 3})
    elif action == "resume":
        request(HUB, prefix + "/appium/device/activate_app", authorization, "POST", {"appId": PACKAGE})
    elif action == "diagnostics":
        for label, cmd in DIAGNOSTICS.items():
            value = request(HUB, prefix + "/execute/sync", authorization, "POST", {
                "script": "browserstack_executor: " + json.dumps({"action": "adbShell", "arguments": {"command": cmd}}),
                "args": [],
            }).get("value")
            (output / (label + ".txt")).write_text(str(value), encoding="utf-8")
    elif action == "stop":
        request(HUB, prefix, authorization, "DELETE")
        receipt["state"] = "stopped"
        return receipt
    elif action not in ("start", "observe"):
        raise ValueError("Unknown device action")
    time.sleep(1)
    encoded = request(HUB, prefix + "/screenshot", authorization).get("value")
    png = base64.b64decode(encoded, validate=True)
    if not png.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Device screenshot is not a PNG")
    (output / "screen.png").write_bytes(png)
    receipt["screenshotDimensions"] = struct.unpack(">II", png[16:24])
    source = request(HUB, prefix + "/source", authorization).get("value")
    (output / "ui.xml").write_text(str(source), encoding="utf-8")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--upload-only", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    username = os.environ.get("BROWSERSTACK_USERNAME", "").strip()
    key = os.environ.get("BROWSERSTACK_ACCESS_KEY", "").strip()
    authorization = "Basic " + base64.b64encode(f"{username}:{key}".encode()).decode()
    receipt = {"fullDeviceAcceptance": False}
    try:
        if not username or not key:
            raise ValueError("Credentials are missing")
        if args.upload_only:
            app_url, artifact = upload_app(args.apk, authorization)
            receipt.update(state="uploaded_for_automation", appUrl=app_url, artifact=artifact, devicesStarted=0)
        else:
            execute(json.loads(os.environ["CLOUD_DEVICE_COMMAND"]), args.apk, args.output, authorization, receipt)
    except ProviderError as error:
        receipt.update(state="provider_error", httpStatus=error.status, category=error.category,
                       providerCode=error.code)
    except Exception:
        receipt.update(state="command_failed")
    (args.output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))
    return 0 if receipt.get("state") in ("started", "command_completed", "stopped", "uploaded_for_automation") else 1


if __name__ == "__main__":
    raise SystemExit(main())
