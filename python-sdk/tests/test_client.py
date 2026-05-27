import unittest
from unittest import mock

import requests

from remote_ai_access import AuthenticationError, RemoteAIAccessClient, TransportError


class FakeResponse:
    def __init__(self, status_code=200, payload=None, reason="OK"):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.reason = reason
        self.ok = 200 <= status_code < 300
        self.text = "" if payload is None else "json"

    def json(self):
        return self._payload


class ClientTests(unittest.TestCase):
    def test_retries_then_success(self):
        session = mock.Mock()
        session.request.side_effect = [
            FakeResponse(status_code=503, payload={"error": "busy"}, reason="Service Unavailable"),
            FakeResponse(status_code=200, payload={"defaultProvider": "openai"}),
        ]

        client = RemoteAIAccessClient("https://example.com", session=session, max_retries=2, retry_backoff_seconds=0)
        result = client.config()

        self.assertEqual(result["defaultProvider"], "openai")
        self.assertEqual(session.request.call_count, 2)

    def test_auth_error_type(self):
        session = mock.Mock()
        session.request.return_value = FakeResponse(status_code=401, payload={"error": "bad key"}, reason="Unauthorized")

        client = RemoteAIAccessClient("https://example.com", session=session, max_retries=0)
        with self.assertRaises(AuthenticationError):
            client.config()

    def test_transport_error_after_retries(self):
        session = mock.Mock()
        session.request.side_effect = requests.RequestException("network down")

        client = RemoteAIAccessClient("https://example.com", session=session, max_retries=1, retry_backoff_seconds=0)
        with self.assertRaises(TransportError):
            client.config()


if __name__ == "__main__":
    unittest.main()
