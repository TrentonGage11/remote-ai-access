# Remote AI Access

Small web app you can host on an approved domain. It keeps your OpenAI API key on the server and provides a simple chat UI in the browser.

## What this gives you

- Browser UI for prompts and responses
- Secure backend proxy to OpenAI Responses API
- API key stays server-side
- Optional HTTP Basic Auth
- Request rate limiting and CSP/security headers
- File Lab page with sandboxed file editing and drag/drop upload
- Local git snapshot tracking for file operations and rollback support
- API tools reference page for agent/tool calling instructions
- OpenAPI schema endpoint for machine-readable API discovery
- Chat Archive page for cross-device export/import of chat history
- Per-operation audit log page for file and git tool usage

## Requirements

- Node.js 18+
- OpenAI API key

## Quick start

1. Install dependencies:

   npm install

2. Create env file:

   Copy `.env.example` to `.env` and fill values.

3. Run dev server:

   npm run dev

4. Open:

   http://localhost:8787

## Environment variables

- `PORT`: server port, default `8787`
- `APP_BASE_URL`: for CSP/connect settings, ex: `http://localhost:8787`
- `OPENAI_API_KEY`: required
- `OPENAI_MODEL`: default `gpt-4.1` (change to your preferred available model)
- `ENABLE_BASIC_AUTH`: `true` or `false`
- `BASIC_AUTH_USER`, `BASIC_AUTH_PASS`: only used if basic auth enabled
- `ALLOWED_ORIGINS`: optional comma-separated CORS allowlist for `/api/chat`
- `SANDBOX_ROOT`: folder used by file APIs (default `./sandbox`)
- `FILE_API_MAX_READ_BYTES`: max bytes for file read endpoint (default `1048576`)
- `FILE_API_UPLOAD_MAX_BYTES`: max upload bytes (default `20971520`)
- `SANDBOX_GIT_USER_NAME`, `SANDBOX_GIT_USER_EMAIL`: git commit identity for sandbox snapshots

## File Lab features

- `filelab.html`: in-browser CodeMirror editor
- Drag and drop upload, multi-file upload, and folder upload
- Directory browsing + read/write + download + move + rename + delete
- Format endpoint using Prettier
- Lint endpoint for JS/TS feedback with ESLint
- Side-by-side diff preview before save in the editor
- Inline lint markers in editor gutter after lint run
- Git log and revert actions for sandbox rollback

## Chat archive and portability

- `archive.html`: export chats as JSON and import on another device
- Optional password-encrypted archive export/import (AES-GCM via Web Crypto)
- Import modes: merge archive into current chats or replace all local chats
- Main chat page includes per-reply copy buttons for Markdown, plain text, and rendered HTML
- One-click button to copy all assistant replies in active chat
- Markdown rendering now supports horizontal rules (`---`) and GitHub-style tables

## Agent tool-calling mode

- Chat UI includes an `Agent Tools` toggle (OpenAI provider).
- When enabled, `/api/chat` runs a server-side tool-calling loop so the model can actually execute tools.
- Built-in agent tools:
   - `list_tools`, `list_apis`, `tool_status`
   - `list_directory`, `read_file`, `write_file`
   - `format_code`, `lint_code`
   - `search_web` (Stack Overflow + web snippets)
   - `fetch_webpage`
   - `delete_file`, `rename_file`, `create_directory`
   - `zip_unzip`, `run_terminal`, `git_ops`
   - `preview_markdown`, `convert_format`, `process_image`
   - `search_replace`, `export_import_workspace`
   - `test_api`, `manage_permissions`, `schedule_task`, `notify_user`
- Tool-calling metadata is exposed from `GET /api/tools`.
- `run_terminal` now allow-lists `7z`, `7za`, `7zr`, and `vfa`.
- If `TERMINAL_RUNTIME=docker`, archive tools can still run on host via `TERMINAL_HOST_FALLBACK_COMMANDS`.
- `vfa` resolves from `TERMINAL_VFA_COMMAND` or falls back to `TERMINAL_VFA_SCRIPT` (default `../VFA/vfa.py`).

## File tool endpoints

- `GET /api/files/list?path=...`
- `GET /api/files/read?path=...`
- `POST /api/files/write`
- `POST /api/files/upload` (multipart, field `file`, optional `path`)
- `GET /api/files/download?path=...`
- `POST /api/files/move`
- `POST /api/files/rename`
- `DELETE /api/files/delete?path=...`
- `POST /api/files/mkdir`
- `POST /api/files/format`
- `GET /api/files/git/log?limit=20`
- `POST /api/files/git/revert`

Detailed tool docs are exposed at `api-tools.html` and `GET /api/tools`.

## OpenAPI schema

- `GET /api/openapi.json` returns an OpenAPI 3.1 schema for external tooling and SDK generation.

## Python SDK

- A Python package is included in `python-sdk/`.
- Install locally:

   pip install -e ./python-sdk

- Import and use:

   from remote_ai_access import RemoteAIAccessClient

## Deploy notes

- Deploy as a normal Node web service (VM, container, App Service, Render, Railway, etc.)
- Put real secrets in platform secret settings, not committed files
- Point your approved domain to this service
- If behind reverse proxy, keep HTTPS enabled

## Security notes

- Do not expose API key in frontend code
- Enable `ENABLE_BASIC_AUTH=true` for shared deployments
- Keep dependencies updated
