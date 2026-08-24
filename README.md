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
- Planned bounded subagent orchestration described in [SUBAGENTS.md](SUBAGENTS.md)

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
- `API_RATE_LIMIT_WINDOW_MS`: rate-limit window for `/api` routes in ms (default `60000`)
- `API_RATE_LIMIT_MAX`: max `/api` requests per window per IP (default `3000`)
- `OPENAI_API_KEY`: required
- `OPENAI_MODEL`: default `gpt-4.1` (current frontier choices include `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`)
- `GOOGLE_API_KEY`: optional; enables `google` provider (Gemini via OpenAI-compatible endpoint)
- `GOOGLE_MODEL`: default Google model (default `gemini-3.7-flash`)
- `GOOGLE_API_BASE_URL`: Google OpenAI-compatible base URL (default `https://generativelanguage.googleapis.com/v1beta/openai`)
- `GOOGLE_ALLOWED_MODELS`: optional comma-separated Google allow-list
- `XAI_API_KEY`: optional; enables `xai` provider (Grok)
- `XAI_MODEL`: default xAI model (default `grok-4.6`)
- `XAI_API_BASE_URL`: xAI OpenAI-compatible base URL (default `https://api.x.ai/v1`)
- `XAI_ALLOWED_MODELS`: optional comma-separated xAI allow-list
- `ENABLE_BASIC_AUTH`: `true` or `false`
- `BASIC_AUTH_USER`, `BASIC_AUTH_PASS`: only used if basic auth enabled
- `HOST`: Node listen address (default `127.0.0.1`; keep loopback when using a reverse proxy)
- `ALLOWED_ORIGINS`: optional comma-separated CORS allowlist for `/api/chat`
- `SANDBOX_ROOT`: folder used by file APIs (default `./sandbox`)
- `FILE_API_MAX_READ_BYTES`: max bytes for file read endpoint (default `1048576`)
- `FILE_API_UPLOAD_MAX_BYTES`: max upload bytes (default `20971520`)
- `FILE_SHARE_DB_PATH`: public-share metadata store (default `./sandbox/_admin/file-shares.json`)
- `FILE_SHARE_DATA_ROOT`: encrypted share snapshot folder (default `./sandbox/_admin/file-share-data`)
- `FILE_SHARE_ENCRYPTION_SECRET`: long server secret required to create encrypted share snapshots
- `SANDBOX_GIT_USER_NAME`, `SANDBOX_GIT_USER_EMAIL`: git commit identity for sandbox snapshots

## File Lab features

- `filelab.html`: in-browser CodeMirror editor
- Drag and drop upload, multi-file upload, and folder upload
- File rows show human-readable sizes; folder rows show recursive size plus contained file/folder counts
- Directory browsing + read/write + download + move + rename + delete
- Format endpoint using Prettier
- Lint endpoint for JS/TS feedback with ESLint
- Side-by-side diff preview before save in the editor
- Inline lint markers in editor gutter after lint run
- Image previews stream directly instead of buffering the full file in browser memory; TIFF images are cached as browser-compatible PNG previews when FFmpeg is available
- Video previews stream with byte-range seeking; non-MP4/M4V containers are prepared asynchronously and cached as browser-compatible H.264/AAC MP4 when FFmpeg is available
- Audio previews stream inline for MP3, WAV, Ogg/Opus, M4A/AAC, FLAC, and WMA files
- Git log and revert actions for sandbox rollback
- Expiring public file shares with optional passwords, encrypted snapshots, access counts, and revocation
- Unencrypted, unpassworded direct media links support HTTP byte ranges for browser and external video players
- Password-protected links require browser unlock; encrypted links intentionally do not support byte-range seeking
- Public share URLs use `APP_BASE_URL` when configured, otherwise the trusted reverse-proxy request origin

## Chat archive and portability

- `archive.html`: export chats as JSON and import on another device
- Optional password-encrypted archive export/import (AES-GCM via Web Crypto)
- Import modes: merge archive into current chats or replace all local chats
- Main chat page includes per-reply copy buttons for Markdown, plain text, and rendered HTML
- One-click button to copy all assistant replies in active chat
- Markdown rendering now supports horizontal rules (`---`) and GitHub-style tables
- Browser-local chat/global context entries support master toggles and individual include/exclude controls for every line
- Chat requests support automatic provider-context compaction when message size limits are hit. This only changes the payload sent to the model; full local chat history remains available through Archive and History JSON.

## Agent tool-calling mode

- Agent mode requires a valid configured API key, even when ordinary chat is available behind Basic Auth.
- State-changing browser API requests must come from the configured application origin; non-browser clients must authenticate with an API key.
- Chat and workspace-selection POST requests accept JSON only.
- Optional Agent Reach tools provide semantic web search, YouTube search/transcripts, and backend health checks. Configure their fixed executable paths with the `AGENT_REACH_*` environment variables.
- YouTube may block transcript extraction from VPS addresses. Use `AGENT_REACH_PROXY` or a cookie file exported from a dedicated account via `AGENT_REACH_YOUTUBE_COOKIES_FILE`; do not use a primary-account cookie file.

- Chat UI includes an `Agent Tools` toggle for configured OpenAI, Google Gemini, and xAI providers.
- When enabled, `/api/chat` runs a server-side tool-calling loop so the model can actually execute tools.
- Built-in agent tools:
   - `list_tools`, `list_apis`, `tool_status`
   - `list_directory`, `read_file`, `write_file`
   - `format_code`, `lint_code`
   - `search_web` (Stack Overflow + web snippets)
   - `fetch_webpage`
   - `delete_file`, `rename_file`, `create_directory`
   - `zip_unzip`, `run_terminal`, `run_build`, `git_ops`
   - `preview_markdown`, `convert_format`, `process_image`
   - `search_replace`, `export_import_workspace`
   - `test_api`, `manage_permissions`, `schedule_task`, `notify_user`
- Tool-calling metadata is exposed from `GET /api/tools`.
- `run_terminal` accepts either `{ command: "git", args: ["status"] }` or command strings such as `git clone https://github.com/org/repo.git repo`, `cd repo && grep -R TODO .`, and `pwd && ls -la && git status 2>&1 || echo "No git repo here"`.
- When `TERMINAL_RUNTIME=docker`, command strings run through `sh -lc` inside the container, so normal shell syntax works: `&&`, `||`, pipes, redirects, multiline backslashes, command substitution, and flags.
- `run_terminal` keeps host-admin commands blocked in host mode, but now allow-lists common agent setup/exploration tools including Git, package managers, C/C++ build tools (`gcc`, `g++`, `cc`, `c++`, `cmake`, `ctest`, `cpack`, `make`, `ninja`), file tools (`cd`, `cp`, `mv`, `rm`, `chmod`, `grep`, `rg`, `find`, `diff`, `patch`), Python venv/pip tools, archive helpers, `7z`, `7za`, `7zr`, and `vfa`.
- When `TERMINAL_RUNTIME=docker`, additional container-only commands are allowed, including `sh`, `bash`, `dash`, `apt`, `apt-get`, `dpkg`, `dpkg-query`, `curl`, `wget`, `jq`, `ctags`, `gdb`, `lldb`, `strace`, and `ldd`. Docker mode can inspect container paths such as `/usr/bin`.
- In Docker mode, agents can pass `dockerImage` to `run_terminal`, `run_build`, or `POST /api/files/terminal` to request an allow-listed container image for that one command. Built-in choices include Node, Python, Go, Rust, Ubuntu, Debian, Alpine, Fedora, Arch, Kali, Parrot, BlackArch, Emscripten, WASI SDK, PyPA manylinux/musllinux, dockcross Linux/Windows/WebAssembly/Android cross-build images, Rust musl cross builds, LLVM/Clang, .NET SDK, `osxcross`, and `valgrind` images.
- Add more per-request container choices with `TERMINAL_DOCKER_ALLOWED_IMAGES=image1,image2`; the default cross-build images remain available. Images are pulled by Docker on first use and still mount only the active workspace at `/workspace`.
- `run_build` provides build profiles for `cmake-configure`, `cmake-build`, `cmake-test`, `make`, `ninja`, compiler commands, `python-venv`, `pip-install`, and Docker-only `apt-install`.
- Example Windows cross-build request: `{ "profile": "custom", "dockerImage": "dockcross/windows-static-x64", "command": "cmake -S . -B build-win && cmake --build build-win", "timeoutMs": 900000 }`.
- Example LLVM MinGW request: `{ "command": "cmake -S . -B build-mingw && cmake --build build-mingw", "dockerImage": "mstorsjo/llvm-mingw", "timeoutMs": 900000 }`.
- `git_ops` supports branch/worktree management: `branch_list`, `branch_create`, `branch_checkout`, `branch_delete`, `worktree_list`, `worktree_add`, `worktree_remove`, and `worktree_prune`.
- Set `TERMINAL_EXTRA_COMMANDS=cmd1,cmd2` to add local allow-list commands without changing code. On the server, add it to `/opt/remote-ai-access/.env`, then run `systemctl restart remote-ai-access`.
- If `TERMINAL_RUNTIME=docker`, archive tools can still run on host via `TERMINAL_HOST_FALLBACK_COMMANDS`.
- `vfa` resolves from `TERMINAL_VFA_COMMAND` or falls back to `TERMINAL_VFA_SCRIPT` (default `../VFA/vfa.py`).

## File tool endpoints

- `GET /api/files/list?path=...`
- `GET /api/files/read?path=...`
- `POST /api/files/write`
- `POST /api/files/upload` (multipart, field `file`, optional `path`)
- `GET /api/files/download?path=...` (files download directly; directories download as zip archives)
- `POST /api/files/copy`
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
- Keep `APP_BASE_URL` set to the canonical HTTPS origin so same-origin request validation is deterministic
- Raw workspace HTML previews run in a script-disabled, opaque-origin iframe
- Keep dependencies updated
