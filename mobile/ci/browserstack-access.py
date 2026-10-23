#!/usr/bin/env python3
"""Check provider access without exposing credentials or starting devices."""

import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request


BASE = "https://api-cloud.browserstack.com"
ROUTES = {
    "appLive": "/app-live/recent_apps?limit=100",
    "appAutomatePlan": "/app-automate/plan.json",
    "appAutomate": "/app-automate/recent_apps?limit=100",
}
PLAN_FIELDS = (
    "automate_plan", "terminal_access", "parallel_sessions_running",
    "parallel_sessions_max_allowed", "team_parallel_sessions_max_allowed",
    "queued_sessions", "queued_sessions_max_allowed",
)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Provider redirect refused")


def fetch(route, authorization):
    if route not in ROUTES.values():
        raise ValueError("Unknown provider route")
    request = urllib.request.Request(BASE + route, headers={
        "Authorization": authorization, "Accept": "application/json",
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=25) as response:
            return {"httpStatus": response.status, "state": "ok"}, json.load(response)
    except urllib.error.HTTPError as error:
        return {"httpStatus": error.code, "state": "http_error"}, None
    except urllib.error.URLError:
        return {"state": "connection_error"}, None
    except (ValueError, OSError):
        return {"state": "invalid_response_or_redirect"}, None


def poleline_apps(data):
    if not isinstance(data, list):
        return []
    apps = []
    for row in data:
        if not isinstance(row, dict):
            continue
        name, app_url = row.get("app_name", ""), row.get("app_url", "")
        if not isinstance(name, str) or not name.lower().startswith("poleline-"):
            continue
        item = {"file": name, "version": str(row.get("app_version", ""))}
        if isinstance(app_url, str) and re.fullmatch(r"bs://[A-Za-z0-9_-]+", app_url):
            item["appUrl"] = app_url
        apps.append(item)
    return apps


def check(username, access_key):
    receipt = {
        "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
        "toolingCommit": os.environ.get("GITHUB_SHA"),
        "credentialsPresent": bool(username and access_key),
        "devicesStarted": 0,
        "fullDeviceAcceptance": False,
    }
    if not receipt["credentialsPresent"]:
        receipt["appLiveAuthenticated"] = False
        return receipt
    authorization = "Basic " + base64.b64encode(f"{username}:{access_key}".encode()).decode()
    for label, route in ROUTES.items():
        state, data = fetch(route, authorization)
        if label == "appAutomatePlan":
            state["plan"] = {key: data[key] for key in PLAN_FIELDS
                if isinstance(data, dict) and key in data and isinstance(data[key], (str, int))}
        else:
            state["polelineApps"] = poleline_apps(data)
            state["validAppList"] = isinstance(data, list)
        receipt[label] = state
    receipt["appLiveAuthenticated"] = (
        receipt["appLive"]["state"] == "ok" and receipt["appLive"]["validAppList"])
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    receipt = check(os.environ.get("BROWSERSTACK_USERNAME", "").strip(),
                    os.environ.get("BROWSERSTACK_ACCESS_KEY", "").strip())
    args.receipt.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))
    return 0 if receipt["appLiveAuthenticated"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        # Never print exception text, request objects, response bodies or environment values.
        print("BrowserStack access check failed. No credential details were logged.")
        raise SystemExit(1)
