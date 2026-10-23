import importlib.util
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import os
import sys
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("device", Path(__file__).with_name("browserstack-device.py"))
device = importlib.util.module_from_spec(spec)
spec.loader.exec_module(device)


class DeviceControllerTests(unittest.TestCase):
    def test_recording_download_rejects_other_hosts_and_embedded_credentials(self):
        for url in ("http://app-automate.browserstack.com/video", "https://example.com/video",
                    "https://app-automate.browserstack.com.example.com/video",
                    "https://private:fixture@app-automate.browserstack.com/video"):
            self.assertFalse(device.video_url_allowed(url))
        self.assertTrue(device.video_url_allowed("https://app-automate.browserstack.com/video?token=fixture"))
        self.assertTrue(device.video_url_allowed("https://fixture.s3.amazonaws.com/video"))

    def test_legacy_provider_failure_is_not_treated_as_a_screenshot(self):
        body = json.dumps({"status": 13, "value": "BROWSERSTACK_FIXTURE_ERROR private-error-fixture"}).encode()
        with patch.object(device.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(body)
            with self.assertRaises(device.ProviderError) as caught:
                device.request(device.HUB, "/session/fixture/screenshot", "fixture")
        self.assertEqual(caught.exception.code, "BROWSERSTACK_FIXTURE_ERROR")
        self.assertNotIn("private-error-fixture", str(caught.exception))

    def test_upload_only_does_not_start_a_device_or_print_credentials(self):
        marker = "private-upload-fixture"
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            with patch.dict(os.environ, BROWSERSTACK_USERNAME="fixture", BROWSERSTACK_ACCESS_KEY=marker):
                with patch.object(sys, "argv", ["device", "--upload-only", "--apk", "unused.apk", "--output", directory]):
                    with patch.object(device, "upload_app", return_value=("bs://fixture", {"build": 3})):
                        with patch.object(device, "execute") as execute:
                            with redirect_stdout(output):
                                self.assertEqual(device.main(), 0)
                            execute.assert_not_called()
            self.assertNotIn(marker, output.getvalue())
            receipt = json.loads((Path(directory) / "receipt.json").read_text())
            self.assertEqual(receipt["devicesStarted"], 0)
            self.assertFalse(receipt["fullDeviceAcceptance"])

    def test_touch_input_rejects_invalid_coordinates_and_excessive_durations(self):
        for points, duration in (([[-1, 1]], 100), ([[1, 10001]], 100), ([[1, 1]], 5000), ([], 100)):
            with self.assertRaises(ValueError):
                device.touch(points, duration)

    def test_provider_errors_retain_only_a_safe_category(self):
        marker = "private-device-fixture"
        error = device.ProviderError(401, {"message": "invalid access " + marker})
        self.assertNotIn(marker, json.dumps(vars(error)))
        self.assertNotIn(marker, str(error))
        self.assertEqual(error.category, "authentication")

    def test_session_id_survives_a_later_capture_failure_for_cleanup(self):
        session = "a" * 40
        receipt = {}
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(device, "upload_app", return_value=("bs://fixture", {"build": 3})):
                with patch.object(device.time, "sleep"):
                    with patch.object(device, "request", side_effect=[
                        {"value": {"sessionId": session}}, device.ProviderError(500, "capture failed")
                    ]):
                        with self.assertRaises(device.ProviderError):
                            device.execute({"action": "start"}, Path("unused.apk"), Path(directory),
                                           "private-fixture", receipt)
        self.assertEqual(receipt["sessionId"], session)
        self.assertEqual(receipt["appUrl"], device.RETAINED_APP_AUTOMATE)

    def test_unknown_commands_cannot_make_provider_requests(self):
        with patch.object(device, "request") as request:
            with self.assertRaises(ValueError):
                device.execute({"action": "arbitrary"}, Path("unused.apk"), Path("."), "fixture", {})
        request.assert_not_called()

    def test_reuse_is_bound_to_the_retained_app_identifier(self):
        with patch.object(device, "request") as request:
            with self.assertRaises(ValueError):
                device.execute({"action": "start", "appUrl": "bs://other"}, Path("unused.apk"),
                               Path("."), "fixture", {})
        request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
