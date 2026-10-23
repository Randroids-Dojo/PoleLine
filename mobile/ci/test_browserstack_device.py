import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("device", Path(__file__).with_name("browserstack-device.py"))
device = importlib.util.module_from_spec(spec)
spec.loader.exec_module(device)


class DeviceControllerTests(unittest.TestCase):
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
        self.assertEqual(receipt["appUrl"], "bs://fixture")

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
