from __future__ import annotations

import time
from typing import Any, Dict, Optional

import requests

from .errors import RemoteAIAccessError, TransportError, ValidationError, error_from_http
from .models import ChatResponse, FileListResponse, GitLogResponse, NotificationsResponse, RuntimeConfig, SecuritySettings


class RemoteAIAccessClient:
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
        session: Optional[requests.Session] = None,
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
        self.session = session or requests.Session()

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        if self.api_key:
            headers[self.api_key_header] = self.api_key
        if self.workspace_code:
            headers["X-Workspace-Code"] = self.workspace_code
        if extra:
            headers.update(extra)
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        data: Any = None,
        files: Any = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        attempt = 0
        while True:
            try:
                response = self.session.request(
                    method=method,
                    url=url,
                    params=params,
                    json=json_body,
                    data=data,
                    files=files,
                    headers=self._headers(headers),
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                if attempt >= self.max_retries:
                    raise TransportError(
                        f"Transport error after {attempt + 1} attempt(s): {exc}",
                        details={"url": url, "method": method},
                    ) from exc
                time.sleep(self.retry_backoff_seconds * (2 ** attempt))
                attempt += 1
                continue

            text = response.text
            payload: Any
            try:
                payload = response.json() if text else {}
            except Exception:
                payload = {"raw": text}

            if response.ok:
                return payload

            if response.status_code in self.retry_on_status_codes and attempt < self.max_retries:
                time.sleep(self.retry_backoff_seconds * (2 ** attempt))
                attempt += 1
                continue

            raise error_from_http(
                response.status_code,
                payload,
                default_message=response.reason or f"Request failed with status {response.status_code}",
            )

    def config(self) -> Dict[str, Any]:
        return self._request("GET", "/api/config")

    def config_typed(self) -> RuntimeConfig:
        return RuntimeConfig.from_dict(self.config())

    def tools(self) -> Dict[str, Any]:
        return self._request("GET", "/api/tools")

    def openapi(self) -> Dict[str, Any]:
        return self._request("GET", "/api/openapi.json")

    def chat(self, messages: list[Dict[str, str]], *, provider: str = "openai", model: Optional[str] = None, agent_mode: bool = False, agent_max_steps_override: Optional[int] = None, agent_max_steps_override_code: Optional[str] = None) -> Dict[str, Any]:
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
        return self._request("POST", "/api/chat", json_body=payload)

    def chat_typed(self, messages: list[Dict[str, str]], *, provider: str = "openai", model: Optional[str] = None, agent_mode: bool = False, agent_max_steps_override: Optional[int] = None, agent_max_steps_override_code: Optional[str] = None) -> ChatResponse:
        return ChatResponse.from_dict(
            self.chat(
                messages,
                provider=provider,
                model=model,
                agent_mode=agent_mode,
                agent_max_steps_override=agent_max_steps_override,
                agent_max_steps_override_code=agent_max_steps_override_code,
            )
        )

    def workspace_get(self) -> Dict[str, Any]:
        return self._request("GET", "/api/session/workspace")

    def workspace_set(self, access_code: str) -> Dict[str, Any]:
        return self._request("POST", "/api/session/workspace", json_body={"accessCode": access_code})

    def workspace_git_info(self) -> Dict[str, Any]:
        return self._request("GET", "/api/session/workspace/git")

    def workspace_git_pull(self, *, remote_name: str = "origin", branch: Optional[str] = None, strategy: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"remoteName": remote_name}
        if branch:
            payload["branch"] = branch
        if strategy:
            payload["strategy"] = strategy
        return self._request("POST", "/api/session/workspace/git/pull", json_body=payload)

    def workspace_git_push(self, *, remote_name: str = "origin", branch: Optional[str] = None, set_upstream: Optional[bool] = None, force_with_lease: Optional[bool] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"remoteName": remote_name}
        if branch:
            payload["branch"] = branch
        if set_upstream is not None:
            payload["setUpstream"] = bool(set_upstream)
        if force_with_lease is not None:
            payload["forceWithLease"] = bool(force_with_lease)
        return self._request("POST", "/api/session/workspace/git/push", json_body=payload)

    def list_notifications(self, *, limit: int = 50) -> Dict[str, Any]:
        return self._request("GET", "/api/notifications", params={"limit": limit})

    def list_notifications_typed(self, *, limit: int = 50) -> NotificationsResponse:
        return NotificationsResponse.from_dict(self.list_notifications(limit=limit))

    def files_list(self, path: str = "") -> Dict[str, Any]:
        return self._request("GET", "/api/files/list", params={"path": path})

    def files_list_typed(self, path: str = "") -> FileListResponse:
        return FileListResponse.from_dict(self.files_list(path=path))

    def files_read(self, path: str) -> Dict[str, Any]:
        return self._request("GET", "/api/files/read", params={"path": path})

    def files_write(self, path: str, content: str) -> Dict[str, Any]:
        return self._request("POST", "/api/files/write", json_body={"path": path, "content": content})

    def files_upload(self, local_file_path: str, *, path: str = "") -> Dict[str, Any]:
        with open(local_file_path, "rb") as f:
            files = {"file": f}
            data = {"path": path} if path else None
            return self._request("POST", "/api/files/upload", files=files, data=data)

    def files_download(self, path: str) -> requests.Response:
        url = f"{self.base_url}/api/files/download"
        response = self.session.get(url, params={"path": path}, headers=self._headers(), timeout=self.timeout)
        if not response.ok:
            raise RemoteAIAccessError(f"Download failed with status {response.status_code}", status_code=response.status_code, details=response.text)
        return response

    def files_move(self, from_path: str, to_path: str) -> Dict[str, Any]:
        return self._request("POST", "/api/files/move", json_body={"fromPath": from_path, "toPath": to_path})

    def files_rename(self, path: str, new_name: str) -> Dict[str, Any]:
        return self._request("POST", "/api/files/rename", json_body={"path": path, "newName": new_name})

    def files_delete(self, path: str) -> Dict[str, Any]:
        return self._request("DELETE", "/api/files/delete", params={"path": path})

    def files_mkdir(self, path: str) -> Dict[str, Any]:
        return self._request("POST", "/api/files/mkdir", json_body={"path": path})

    def files_format(self, path: str, content: str, *, write: bool = False) -> Dict[str, Any]:
        return self._request("POST", "/api/files/format", json_body={"path": path, "content": content, "write": bool(write)})

    def files_lint(self, path: str, content: str) -> Dict[str, Any]:
        return self._request("POST", "/api/files/lint", json_body={"path": path, "content": content})

    def files_terminal(self, command: str, args: Optional[list[str]] = None, *, cwd: str = "", timeout_ms: int = 20000) -> Dict[str, Any]:
        return self._request(
            "POST",
            "/api/files/terminal",
            json_body={"command": command, "args": args or [], "cwd": cwd, "timeoutMs": timeout_ms},
        )

    def files_audit(self, *, limit: int = 200) -> Dict[str, Any]:
        return self._request("GET", "/api/files/audit", params={"limit": limit})

    def files_git_log(self, *, limit: int = 20) -> Dict[str, Any]:
        return self._request("GET", "/api/files/git/log", params={"limit": limit})

    def files_git_log_typed(self, *, limit: int = 20) -> GitLogResponse:
        return GitLogResponse.from_dict(self.files_git_log(limit=limit))

    def files_git_revert(self, ref: str = "HEAD~1") -> Dict[str, Any]:
        return self._request("POST", "/api/files/git/revert", json_body={"ref": ref})

    def files_snapshots(self, *, limit: int = 30) -> Dict[str, Any]:
        return self._request("GET", "/api/files/snapshots", params={"limit": limit})

    def files_snapshot_create(self, message: str = "") -> Dict[str, Any]:
        return self._request("POST", "/api/files/snapshots", json_body={"message": message})

    def files_snapshot_restore(self, ref: str = "HEAD~1") -> Dict[str, Any]:
        return self._request("POST", "/api/files/snapshots/restore", json_body={"ref": ref})

    def files_diff_refs(self, left: str = "HEAD~1", right: str = "HEAD", path: str = "") -> Dict[str, Any]:
        params = {"left": left, "right": right}
        if path:
            params["path"] = path
        return self._request("GET", "/api/files/diff", params=params)

    def files_diff_paths(self, left_path: str, right_path: str) -> Dict[str, Any]:
        return self._request("POST", "/api/files/diff/paths", json_body={"leftPath": left_path, "rightPath": right_path})

    def files_merge_from_snapshot(self, ref: str, path: str) -> Dict[str, Any]:
        return self._request("POST", "/api/files/merge/from-snapshot", json_body={"ref": ref, "path": path})

    def files_search(self, query: str, *, mode: str = "hybrid", path: str = "", limit: int = 20) -> Dict[str, Any]:
        params: Dict[str, Any] = {"q": query, "mode": mode, "limit": limit}
        if path:
            params["path"] = path
        return self._request("GET", "/api/files/search", params=params)

    def tests_profiles(self) -> Dict[str, Any]:
        return self._request("GET", "/api/tests/profiles")

    def tests_run(self, profile: str, *, cwd: str = "project", timeout_ms: int = 120000) -> Dict[str, Any]:
        return self._request("POST", "/api/tests/run", json_body={"profile": profile, "cwd": cwd, "timeoutMs": timeout_ms})

    def admin_get_security(self) -> Dict[str, Any]:
        if not self.admin_token:
            raise ValidationError("admin_token is required for admin endpoint")
        return self._request("GET", "/api/admin/security", headers={"x-admin-token": self.admin_token})

    def admin_get_security_typed(self) -> SecuritySettings:
        return SecuritySettings.from_dict(self.admin_get_security())

    def admin_update_security(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.admin_token:
            raise ValidationError("admin_token is required for admin endpoint")
        return self._request("PUT", "/api/admin/security", json_body=payload, headers={"x-admin-token": self.admin_token})
