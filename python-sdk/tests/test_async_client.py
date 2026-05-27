import unittest
from unittest import mock

import httpx

from remote_ai_access import AsyncRemoteAIAccessClient, AuthenticationError, TransportError


class FakeAsyncResponse:
    def __init__(self, status_code=200, payload=None, reason_phrase="OK"):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.reason_phrase = reason_phrase
        self.text = "" if payload is None else "json"

    def json(self):
        return self._payload


class AsyncClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_then_success(self):
        async_client = mock.AsyncMock()
        async_client.request.side_effect = [
            FakeAsyncResponse(status_code=503, payload={"error": "busy"}, reason_phrase="Service Unavailable"),
            FakeAsyncResponse(status_code=200, payload={"defaultProvider": "openai"}),
        ]

        client = AsyncRemoteAIAccessClient("https://example.com", client=async_client, max_retries=2, retry_backoff_seconds=0)
        result = await client.config()

        self.assertEqual(result["defaultProvider"], "openai")
        self.assertEqual(async_client.request.call_count, 2)

    async def test_auth_error_type(self):
        async_client = mock.AsyncMock()
        async_client.request.return_value = FakeAsyncResponse(status_code=401, payload={"error": "bad key"}, reason_phrase="Unauthorized")

        client = AsyncRemoteAIAccessClient("https://example.com", client=async_client, max_retries=0)
        with self.assertRaises(AuthenticationError):
            await client.config()

    async def test_transport_error_after_retries(self):
        async_client = mock.AsyncMock()
        async_client.request.side_effect = httpx.RequestError("network down")

        client = AsyncRemoteAIAccessClient("https://example.com", client=async_client, max_retries=1, retry_backoff_seconds=0)
        with self.assertRaises(TransportError):
            await client.config()


if __name__ == "__main__":
    unittest.main()
