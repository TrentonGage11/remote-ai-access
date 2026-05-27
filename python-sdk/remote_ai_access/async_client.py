from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

import httpx

from .errors import RemoteAIAccessError, TransportError, ValidationError, error_from_http
from .models import ChatResponse, FileListResponse, RuntimeConfig, SecuritySettings


class AsyncRemoteAIAccessClient:
    def __init__(
        self,
        base_url: str,
        *,
        api_key: Optional[str] = None,
        api_key_header: str = "x-api-key",
        workspace_code: Optional[str] = None,
        admin_token: Optional[str] = None,
        timeout: float = 30.0,
        max_retries: int = 2,
        retry_backoff_seconds: float = 0.4,
        retry_on_status_codes: tuple[int, ...] = (408, 425, 429, 500, 502, 503, 504),
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.api_key_header = api_key_header
        self.workspace_code = workspace_code
        self.admin_token = admin_token
        self.timeout = timeout
        self.max_retries = max(0, int(max_retries))
        self.retry_backoff_seconds = max(0.0, float(retry_backoff_seconds))
        self.retry_on_status_codes = set(int(code) for code in retry_on_status_codes)
        self.client = client or httpx.AsyncClient(timeout=timeout)
        self._owns_client = client is None

    async def __aenter__(self) -> "AsyncRemoteAIAccessClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._owns_client:
            await self.client.aclose()

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        if self.api_key:
            headers[self.api_key_header] = self.api_key
        if self.workspace_code:
            headers["X-Workspace-Code"] = self.workspace_code
        if extra:
            headers.update(extra)
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        attempt = 0
        while True:
            try:
                response = await self.client.request(
                    method=method,
                    url=url,
                    params=params,
                    json=json_body,
                    headers=self._headers(headers),
                )
            except httpx.HTTPError as exc:
                if attempt >= self.max_retries:
                    raise TransportError(
                        f"Transport error after {attempt + 1} attempt(s): {exc}",
                        details={"url": url, "method": method},
                    ) from exc
                await asyncio.sleep(self.retry_backoff_seconds * (2 ** attempt))
                attempt += 1
                continue

            text = response.text
            payload: Any
            try:
                payload = response.json() if text else {}
            except Exception:
                payload = {"raw": text}

            if 200 <= response.status_code < 300:
                return payload

            if response.status_code in self.retry_on_status_codes and attempt < self.max_retries:
                await asyncio.sleep(self.retry_backoff_seconds * (2 ** attempt))
                attempt += 1
                continue

            raise error_from_http(
                response.status_code,
                payload,
                default_message=response.reason_phrase or f"Request failed with status {response.status_code}",
            )

    async def config(self) -> Dict[str, Any]:
        return await self._request("GET", "/api/config")

    async def config_typed(self) -> RuntimeConfig:
        return RuntimeConfig.from_dict(await self.config())

    async def tools(self) -> Dict[str, Any]:
        return await self._request("GET", "/api/tools")

    async def openapi(self) -> Dict[str, Any]:
        return await self._request("GET", "/api/openapi.json")

    async def chat(
        self,
        messages: list[Dict[str, str]],
        *,
        provider: str = "openai",
        model: Optional[str] = None,
        agent_mode: bool = False,
        agent_max_steps_override: Optional[int] = None,
        agent_max_steps_override_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "provider": provider,
            "messages": messages,
            "agentMode": agent_mode,
        }
        if model:
            payload["model"] = model
        if agent_max_steps_override is not None:
            payload["agentMaxStepsOverride"] = int(agent_max_steps_override)
        if agent_max_steps_override_code:
            payload["agentMaxStepsOverrideCode"] = agent_max_steps_override_code
        return await self._request("POST", "/api/chat", json_body=payload)

    async def chat_typed(
        self,
        messages: list[Dict[str, str]],
        *,
        provider: str = "openai",
        model: Optional[str] = None,
        agent_mode: bool = False,
        agent_max_steps_override: Optional[int] = None,
        agent_max_steps_override_code: Optional[str] = None,
    ) -> ChatResponse:
        return ChatResponse.from_dict(
            await self.chat(
                messages,
                provider=provider,
                model=model,
                agent_mode=agent_mode,
                agent_max_steps_override=agent_max_steps_override,
                agent_max_steps_override_code=agent_max_steps_override_code,
            )
        )

    async def files_list(self, path: str = "") -> Dict[str, Any]:
        return await self._request("GET", "/api/files/list", params={"path": path})

    async def files_list_typed(self, path: str = "") -> FileListResponse:
        return FileListResponse.from_dict(await self.files_list(path=path))

    async def files_read(self, path: str) -> Dict[str, Any]:
        return await self._request("GET", "/api/files/read", params={"path": path})

    async def files_write(self, path: str, content: str) -> Dict[str, Any]:
        return await self._request("POST", "/api/files/write", json_body={"path": path, "content": content})

    async def tests_profiles(self) -> Dict[str, Any]:
        return await self._request("GET", "/api/tests/profiles")

    async def tests_run(self, profile: str, *, cwd: str = "project", timeout_ms: int = 120000) -> Dict[str, Any]:
        return await self._request("POST", "/api/tests/run", json_body={"profile": profile, "cwd": cwd, "timeoutMs": timeout_ms})

    async def admin_get_security(self) -> Dict[str, Any]:
        if not self.admin_token:
            raise ValidationError("admin_token is required for admin endpoint")
        return await self._request("GET", "/api/admin/security", headers={"x-admin-token": self.admin_token})

    async def admin_get_security_typed(self) -> SecuritySettings:
        return SecuritySettings.from_dict(await self.admin_get_security())

    async def admin_update_security(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.admin_token:
            raise ValidationError("admin_token is required for admin endpoint")
        return await self._request("PUT", "/api/admin/security", json_body=payload, headers={"x-admin-token": self.admin_token})
