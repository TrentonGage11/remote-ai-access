# remote-ai-access (Python SDK)

Python client for the Remote AI Access API.

## Install (local)

```bash
pip install -e ./python-sdk
```

## Quick start

```python
from remote_ai_access import RemoteAIAccessClient

client = RemoteAIAccessClient(
    base_url="https://ai.tg11.org",
    api_key="YOUR_API_KEY",
    workspace_code="default",
    max_retries=3,
)

cfg = client.config()
print(cfg["defaultProvider"])

reply = client.chat(
    messages=[{"role": "user", "content": "List files in src"}],
    agent_mode=True,
)
print(reply.get("reply"))

entries = client.files_list("src")
print(entries)

cfg_typed = client.config_typed()
print(cfg_typed.api_key_auth.header_name)
```

## Async client

```python
import asyncio
from remote_ai_access import AsyncRemoteAIAccessClient


async def main() -> None:
    async with AsyncRemoteAIAccessClient(
        base_url="https://ai.tg11.org",
        api_key="YOUR_API_KEY",
        workspace_code="default",
    ) as client:
        cfg = await client.config_typed()
        print(cfg.default_model)


asyncio.run(main())
```

## Features

- API-key header auth support (`x-api-key` by default)
- Workspace header support (`X-Workspace-Code`)
- Typed dataclass models for common API responses
- Async client support via `httpx`
- Automatic retry/backoff for transient transport and server/rate-limit failures
- Typed error classes (`AuthenticationError`, `RateLimitError`, `ServerError`, etc.)
- Chat/config/tools/openapi wrappers
- File APIs (list/read/write/upload/download/move/rename/delete/mkdir/format/lint)
- Git/snapshot/diff/search wrappers
- Test profile wrappers
- Admin security wrappers with `x-admin-token`

## Endpoint coverage notes

This package wraps the most-used routes directly. You can still call custom routes by extending the client and reusing `_request`.

## Examples

- `examples/sync_basic.py`
- `examples/async_basic.py`
- `examples/admin_security.py`

## Run tests

```bash
python -m unittest discover -s python-sdk/tests -v
```
