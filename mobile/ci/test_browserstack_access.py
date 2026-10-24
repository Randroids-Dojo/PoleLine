import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error


spec = importlib.util.spec_from_file_location("access", Path(__file__).with_name("browserstack-access.py"))
access = importlib.util.module_from_spec(spec)
spec.loader.exec_module(access)


class Response(io.BytesIO):
    status = 200


class AccessCheckTests(unittest.TestCase):
    def test_provider_private_fields_never_enter_the_receipt(self):
        marker = "private-fixture-credential"
        apps = [{"app_name": "poleline-fixture.apk", "app_url": "bs://fixture", "access_key": marker},
                {"app_name": "unrelated-app.apk", "app_url": "bs://private-other-app"}]
        responses = [apps, {"automate_plan": "Free", "parallel_sessions_max_allowed": 1,
                            "access_key": marker}, apps]
        with patch.object(access.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = [Response(json.dumps(row).encode()) for row in responses]
            receipt = access.check("fixture-user", marker)
        encoded = json.dumps(receipt)
        self.assertNotIn(marker, encoded)
        self.assertNotIn("private-other-app", encoded)
        self.assertTrue(receipt["appLiveAuthenticated"])
        self.assertEqual(receipt["devicesStarted"], 0)

    def test_provider_http_errors_do_not_echo_sensitive_error_details(self):
        marker = "private-fixture-error"
        error = urllib.error.HTTPError(access.BASE, 401, marker, {}, None)
        with patch.object(access.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = error
            receipt = access.check("fixture-user", marker)
        self.assertNotIn(marker, json.dumps(receipt))
        self.assertEqual(receipt["appLive"]["httpStatus"], 401)
        self.assertFalse(receipt["appLiveAuthenticated"])

    def test_redirects_cannot_forward_the_authorization_header(self):
        with self.assertRaises(ValueError):
            access.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://example.com")


if __name__ == "__main__":
    unittest.main()
