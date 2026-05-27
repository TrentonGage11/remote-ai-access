from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ApiKeyAuthConfig:
    enabled: bool
    header_name: str
    require_header_only: bool
    protected_path_prefixes: List[str] = field(default_factory=list)
    exempt_path_prefixes: List[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ApiKeyAuthConfig":
        return cls(
            enabled=bool(data.get("enabled", False)),
            header_name=str(data.get("headerName", "x-api-key")),
            require_header_only=bool(data.get("requireHeaderOnly", True)),
            protected_path_prefixes=[str(item) for item in data.get("protectedPathPrefixes", [])],
            exempt_path_prefixes=[str(item) for item in data.get("exemptPathPrefixes", [])],
        )


@dataclass
class AgentStepOverrideConfig:
    enabled: bool
    base_max_steps: int
    max_override_steps: int

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AgentStepOverrideConfig":
        return cls(
            enabled=bool(data.get("enabled", False)),
            base_max_steps=int(data.get("baseMaxSteps", 0)),
            max_override_steps=int(data.get("maxOverrideSteps", 0)),
        )


@dataclass
class RuntimeConfig:
    default_provider: str
    default_model: str
    allowed_models: List[str]
    supported_providers: List[str]
    agent_mode_supported_providers: List[str]
    agent_step_override: AgentStepOverrideConfig
    api_key_auth: ApiKeyAuthConfig

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RuntimeConfig":
        return cls(
            default_provider=str(data.get("defaultProvider", "openai")),
            default_model=str(data.get("defaultModel", "")),
            allowed_models=[str(item) for item in data.get("allowedModels", [])],
            supported_providers=[str(item) for item in data.get("supportedProviders", [])],
            agent_mode_supported_providers=[str(item) for item in data.get("agentModeSupportedProviders", [])],
            agent_step_override=AgentStepOverrideConfig.from_dict(data.get("agentStepOverride", {})),
            api_key_auth=ApiKeyAuthConfig.from_dict(data.get("apiKeyAuth", {})),
        )


@dataclass
class ChatResponse:
    reply: str
    model: str
    provider: str
    agent_mode: bool = False
    executed_tools: List[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChatResponse":
        return cls(
            reply=str(data.get("reply", "")),
            model=str(data.get("model", "")),
            provider=str(data.get("provider", "")),
            agent_mode=bool(data.get("agentMode", False)),
            executed_tools=[str(item) for item in data.get("executedTools", [])],
        )


@dataclass
class FileEntry:
    name: str
    type: str
    size: int
    modified_at: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FileEntry":
        return cls(
            name=str(data.get("name", "")),
            type=str(data.get("type", "file")),
            size=int(data.get("size", 0)),
            modified_at=str(data.get("modifiedAt", "")),
        )


@dataclass
class FileListResponse:
    path: str
    entries: List[FileEntry]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FileListResponse":
        return cls(
            path=str(data.get("path", "")),
            entries=[FileEntry.from_dict(item) for item in data.get("entries", [])],
        )


@dataclass
class GitCommit:
    hash: str
    short_hash: str
    date: str
    subject: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GitCommit":
        return cls(
            hash=str(data.get("hash", "")),
            short_hash=str(data.get("shortHash", "")),
            date=str(data.get("date", "")),
            subject=str(data.get("subject", "")),
        )


@dataclass
class GitLogResponse:
    commits: List[GitCommit]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GitLogResponse":
        return cls(
            commits=[GitCommit.from_dict(item) for item in data.get("commits", [])]
        )


@dataclass
class NotificationEntry:
    id: str
    timestamp: str
    level: str
    message: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "NotificationEntry":
        return cls(
            id=str(data.get("id", "")),
            timestamp=str(data.get("timestamp", "")),
            level=str(data.get("level", "info")),
            message=str(data.get("message", "")),
        )


@dataclass
class NotificationsResponse:
    notifications: List[NotificationEntry]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "NotificationsResponse":
        return cls(
            notifications=[NotificationEntry.from_dict(item) for item in data.get("notifications", [])]
        )


@dataclass
class SecuritySettings:
    api_key_auth_enabled: bool
    api_key_header_name: str
    api_keys: List[str]
    protected_path_prefixes: List[str]
    exempt_path_prefixes: List[str]
    api_key_require_header_only: bool
    agent_max_steps_override_code: str
    workspace_upload_bypass_codes_raw: str
    updated_at: Optional[str]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SecuritySettings":
        return cls(
            api_key_auth_enabled=bool(data.get("apiKeyAuthEnabled", False)),
            api_key_header_name=str(data.get("apiKeyHeaderName", "x-api-key")),
            api_keys=[str(item) for item in data.get("apiKeys", [])],
            protected_path_prefixes=[str(item) for item in data.get("apiKeyProtectedPathPrefixes", [])],
            exempt_path_prefixes=[str(item) for item in data.get("apiKeyExemptPathPrefixes", [])],
            api_key_require_header_only=bool(data.get("apiKeyRequireHeaderOnly", True)),
            agent_max_steps_override_code=str(data.get("agentMaxStepsOverrideCode", "")),
            workspace_upload_bypass_codes_raw=str(data.get("workspaceUploadBypassCodesRaw", "")),
            updated_at=data.get("updatedAt"),
        )
