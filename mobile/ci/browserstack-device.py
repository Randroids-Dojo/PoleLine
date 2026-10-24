#!/usr/bin/env python3
"""Operate a retained-build cloud device through fixed provider endpoints."""

import argparse
import base64
import hashlib
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import struct
import time
import urllib.error
import urllib.parse
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
    "activity": 'dumpsys activity activities | grep -m1 "ResumedActivity"',
}
SYSTEM_DIAGNOSTICS = {
    "vibration": "dumpsys vibrator_manager",
    "windows": "dumpsys window windows",
    "screen-timeout": "settings get system screen_off_timeout",
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
    if isinstance(result, dict) and result.get("status") not in (None, 0):
        raise ProviderError(200, result.get("value")) from None
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


def video_url_allowed(url):
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or ""
    return (parsed.scheme == "https" and parsed.username is None and parsed.password is None
            and parsed.port in (None, 443) and (host in ("app-automate.browserstack.com", "api-cloud.browserstack.com")
            or host.endswith(".amazonaws.com") or host.endswith(".cloudfront.net")))


def save_recording(session, output, authorization, receipt):
    details = request(API, "/app-automate/sessions/" + session + ".json", authorization)
    details = details.get("automation_session", {})
    receipt["providerSession"] = {k: details[k] for k in ("duration", "os", "os_version", "device", "status")
                                  if isinstance(details.get(k), (str, int))}
    reason = details.get("reason", "")
    if isinstance(reason, str) and re.fullmatch(r"[A-Z0-9_]{1,80}", reason):
        receipt["providerSession"]["reason"] = reason
    url = details.get("video_url", "")
    for attempt in range(5):
        if not isinstance(url, str) or not video_url_allowed(url):
            raise ValueError("Unexpected recording destination")
        host = urllib.parse.urlsplit(url).hostname
        receipt["recordingDownload"] = {"host": host, "attempt": attempt + 1}
        try:
            response = urllib.request.build_opener(upload.NoRedirect).open(
                urllib.request.Request(url), timeout=120)
        except urllib.error.HTTPError as error:
            if error.code in (301, 302, 303, 307, 308):
                url = urllib.parse.urljoin(url, error.headers.get("Location", ""))
                error.close()
                continue
            receipt["recordingDownload"]["httpStatus"] = error.code
            body = error.read(65536).decode("utf-8", errors="replace")
            for code in ("AccessDenied", "SignatureDoesNotMatch", "ExpiredToken", "AuthorizationHeaderMalformed"):
                if "<Code>" + code + "</Code>" in body:
                    receipt["recordingDownload"]["storageCode"] = code
                    break
            error.close()
            raise ProviderError(error.code, "Recording download failed") from None
        digest = hashlib.sha256()
        size = 0
        path = output / "session.mp4"
        with response, path.open("wb") as destination:
            while chunk := response.read(1024 * 1024):
                if size == 0 and not (chunk[4:8] == b"ftyp" or chunk.startswith(b"\x1a\x45\xdf\xa3")):
                    raise ValueError("Recording response is not a supported video container")
                size += len(chunk)
                if size > 512 * 1024 * 1024:
                    raise ValueError("Recording exceeds the evidence size limit")
                digest.update(chunk)
                destination.write(chunk)
        receipt["recording"] = {"file": path.name, "bytes": size, "sha256": digest.hexdigest()}
        receipt["state"] = "recording_saved"
        return
    raise ValueError("Too many recording redirects")


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
    if action not in ("start", "observe", "tap", "stroke", "back", "home", "resume", "orientation", "diagnostics", "stop", "recording"):
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
    if action == "recording":
        save_recording(session, output, authorization, receipt)
        return receipt
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
    elif action == "orientation":
        orientation = command.get("orientation")
        if orientation not in ("PORTRAIT", "LANDSCAPE"):
            raise ValueError("Expected a portrait or landscape orientation")
        receipt["requestedOrientation"] = orientation
        request(HUB, prefix + "/orientation", authorization, "POST", {"orientation": orientation})
        current = request(HUB, prefix + "/orientation", authorization).get("value")
        if current in ("PORTRAIT", "LANDSCAPE"):
            receipt["reportedOrientation"] = current
    elif action == "diagnostics":
        commands = dict(DIAGNOSTICS)
        if command.get("systemChecks") is True:
            commands.update(SYSTEM_DIAGNOSTICS)
        receipt["diagnostics"] = {}
        for label, cmd in commands.items():
            try:
                value = request(HUB, prefix + "/execute/sync", authorization, "POST", {
                    "script": "browserstack_executor: " + json.dumps({"action": "adbShell", "arguments": {"command": cmd}}),
                    "args": [],
                }).get("value")
                (output / (label + ".txt")).write_text(str(value), encoding="utf-8")
                receipt["diagnostics"][label] = {"state": "saved"}
            except ProviderError as error:
                receipt["diagnostics"][label] = {"state": "provider_error", "httpStatus": error.status,
                    "category": error.category, "providerCode": error.code}
    elif action == "stop":
        request(HUB, prefix, authorization, "DELETE")
        receipt["state"] = "stopped"
        return receipt
    elif action not in ("start", "observe"):
        raise ValueError("Unknown device action")
    time.sleep(1)
    receipt["evidenceStage"] = "request_screenshot"
    encoded = request(HUB, prefix + "/screenshot", authorization).get("value")
    receipt["evidenceStage"] = "decode_screenshot"
    if not isinstance(encoded, str):
        raise ValueError("Screenshot encoding is not text")
    compact = "".join(encoded.split())
    receipt["screenshotEncoding"] = {"characters": len(encoded), "whitespace": len(encoded) - len(compact)}
    png = base64.b64decode(compact, validate=True)
    receipt["evidenceStage"] = "validate_screenshot"
    if not png.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Device screenshot is not a PNG")
    (output / "screen.png").write_bytes(png)
    receipt["screenshotDimensions"] = struct.unpack(">II", png[16:24])
    receipt["evidenceStage"] = "request_ui_source"
    source = request(HUB, prefix + "/source", authorization).get("value")
    (output / "ui.xml").write_text(str(source), encoding="utf-8")
    receipt["evidenceStage"] = "captured"
    return receipt


def validate_sequence(command):
    session = command.get("sessionId", "")
    if not isinstance(session, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", session):
        raise ValueError("Invalid sequence session")
    steps = command.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 32:
        raise ValueError("Expected between 1 and 32 touch steps")
    duration = 0
    for step in steps:
        if not isinstance(step, dict) or set(step) - {"action", "points", "durationMs"}:
            raise ValueError("Unexpected sequence input")
        if step.get("action") not in ("tap", "stroke", "observe"):
            raise ValueError("Sequences accept only touch and observation")
        if step["action"] != "observe":
            touch(step.get("points"), step.get("durationMs", 350))
            duration += max(1, len(step["points"]) - 1) * step.get("durationMs", 350) + 80
    if duration > 45000:
        raise ValueError("Sequence touch duration exceeds 45 seconds")
    return steps


def execute_sequence(command, apk, output, authorization, receipt):
    steps = validate_sequence(command)
    receipt.update(action="sequence", sessionId=command["sessionId"], fullDeviceAcceptance=False,
                   toolingCommit=os.environ.get("GITHUB_SHA"), checkedAtUtc=datetime.now(timezone.utc).isoformat(),
                   completedSteps=0)
    for index, step in enumerate(steps, 1):
        folder = output / f"step-{index:02d}"
        folder.mkdir()
        current = {}
        execute(dict(step, sessionId=command["sessionId"]), apk, folder, authorization, current)
        (folder / "receipt.json").write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
        for name in ("screen.png", "ui.xml"):
            shutil.copyfile(folder / name, output / name)
        receipt["completedSteps"] = index
        receipt["lastStepDirectory"] = folder.name
        source = (folder / "ui.xml").read_text(encoding="utf-8")
        if 'package="app.toyboxes.poleline"' not in source:
            receipt.update(state="operator_input_needed", reason="unexpected_foreground")
            return
        if 'text="Track limits"' in source:
            receipt.update(state="operator_input_needed", reason="track_limits")
            return
    receipt["state"] = "sequence_completed"


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
            command = json.loads(os.environ["CLOUD_DEVICE_COMMAND"])
            if command.get("action") == "sequence":
                execute_sequence(command, args.apk, args.output, authorization, receipt)
            else:
                execute(command, args.apk, args.output, authorization, receipt)
    except ProviderError as error:
        receipt.update(state="provider_error", httpStatus=error.status, category=error.category,
                       providerCode=error.code)
    except Exception as error:
        receipt.update(state="command_failed", errorType=type(error).__name__)
    (args.output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))
    return 0 if receipt.get("state") in ("started", "command_completed", "stopped", "uploaded_for_automation", "recording_saved", "sequence_completed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
