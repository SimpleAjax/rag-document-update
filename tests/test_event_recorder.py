from __future__ import annotations

import unittest

from chatbot.event_recorder import MAX_FIELD_CHARACTERS, _bounded_json, redact_text


class EventRecorderSafetyTests(unittest.TestCase):
    def test_secret_values_and_connection_strings_are_redacted(self):
        value = "api_key=sk-abcdefghijklmnop password: hunter2 Bearer abc.def postgres://u:p@127.0.0.1/db"
        safe = redact_text(value)
        self.assertNotIn("sk-abcdefghijklmnop", safe)
        self.assertNotIn("hunter2", safe)
        self.assertNotIn("abc.def", safe)
        self.assertNotIn("postgres://u:p", safe)
        self.assertIn("[REDACTED DATABASE URL]", safe)

    def test_secret_named_fields_are_redacted_and_large_payloads_are_bounded(self):
        payload = {"api_key": "secret-value", "prompt": "x" * (MAX_FIELD_CHARACTERS + 5)}
        safe = _bounded_json(payload)
        self.assertTrue(safe["truncated"])
        self.assertGreater(safe["original_characters"], MAX_FIELD_CHARACTERS)
        self.assertLessEqual(len(safe["preview"]), MAX_FIELD_CHARACTERS)


if __name__ == "__main__":
    unittest.main()
