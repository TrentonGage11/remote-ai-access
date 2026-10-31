# Remote AI Access

Small web app you can host on an approved domain. It keeps provider API keys on the server and provides a simple multi-provider chat UI in the browser.

## What this gives you

- Browser UI for prompts and responses
- Secure backend proxy for OpenAI, GitHub Copilot, Google, xAI, DeepSeek, Anthropic Claude, Together AI, and OpenRouter
- Provider API keys stay server-side
- Optional HTTP Basic Auth
- Request rate limiting and CSP/security headers
- File Lab page with sandboxed file editing and drag/drop upload
- Local git snapshot tracking for file operations and rollback support
- API tools reference page for agent/tool calling instructions
- OpenAPI schema endpoint for machine-readable API discovery
- Chat Archive page for cross-device export/import of chat history
- Per-operation audit log page for file and git tool usage
- Workspace Activity Timeline combining audit, agent, subagent, tool, Git, file, share, recipe, and failure events
- Bounded research, review, image, and approval-gated coding subagents described in [SUBAGENTS.md](SUBAGENTS.md)

## Requirements

- Node.js 18+
- At least one configured provider inference key

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
- `DEFAULT_PROVIDER`: optional initial provider; it is used only when that provider has a configured inference key
- `APP_BASE_URL`: for CSP/connect settings, ex: `http://localhost:8787`
- `API_RATE_LIMIT_WINDOW_MS`: rate-limit window for `/api` routes in ms (default `60000`)
- `API_RATE_LIMIT_MAX`: max `/api` requests per window per IP (default `3000`)
- `CHAT_JOB_MAX_CONCURRENT`: maximum agent jobs running at once across the service (default `2`, maximum `12`)
- `CHAT_JOB_MAX_AGE_MS`: completed and queued job retention window (default `21600000`, six hours)
- `CHAT_JOB_DB_PATH`: durable queue and result store (default `./sandbox/_admin/chat-jobs.json`)
- `CHAT_JOB_DEFAULT_WORKSPACE_CONCURRENT`: default concurrent jobs per workspace, bounded by the global maximum
- `CHAT_JOB_WORKSPACE_CONCURRENCY_JSON`: optional workspace limit overrides, for example `{"default":1,"media":2}`
- `WORKSPACE_AGENT_STEP_OVERRIDE_CODES`: optional `workspace:code` CSV; workspace entries override the global high-step unlock
- `PROVIDER_REQUEST_TIMEOUT_MS`: timeout for each provider request attempt (default `1800000`, 30 minutes)
- `PROVIDER_MAX_RETRIES`: transient provider retries for timeouts, `429`, and selected `5xx` responses (default `5`)
- `PROVIDER_RETRY_BASE_MS`, `PROVIDER_RETRY_MAX_MS`: bounded exponential retry delay (defaults `1000` and `60000`)
- `AGENT_RECIPE_SCHEDULE_DB_PATH`: durable Saved Recipe schedule store (default `./sandbox/_admin/agent-recipe-schedules.json`)
- `OPENAI_API_KEY`: optional; enables the OpenAI provider
- `OPENAI_MODEL`: default `gpt-4.1` (current frontier choices include `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`)
- `OPENAI_IMAGE_MODEL`, `XAI_IMAGE_MODEL`, `GOOGLE_IMAGE_MODEL`: provider image-generation model names (`XAI_IMAGE_MODEL` defaults to `grok-imagine-image`)
- `GOOGLE_API_KEY`: optional; enables `google` provider (Gemini via OpenAI-compatible endpoint)
- `GOOGLE_MODEL`: default Google model (default `gemini-3.7-flash`)
- `GOOGLE_API_BASE_URL`: Google OpenAI-compatible base URL (default `https://generativelanguage.googleapis.com/v1beta/openai`)
- `GOOGLE_ALLOWED_MODELS`: optional comma-separated Google allow-list
- `XAI_API_KEY`: optional; enables `xai` provider (Grok)
- `XAI_MODEL`: default xAI model (default `grok-4.6`)
- `XAI_API_BASE_URL`: xAI OpenAI-compatible base URL (default `https://api.x.ai/v1`)
- `XAI_ALLOWED_MODELS`: optional comma-separated xAI allow-list
- `DEEPSEEK_API_KEY`: optional; enables `deepseek` provider via OpenAI-compatible chat completions
- `DEEPSEEK_MODEL`: default DeepSeek model (default `deepseek-v4-flash`)
- `DEEPSEEK_API_BASE_URL`: DeepSeek base URL (default `https://api.deepseek.com`)
- `DEEPSEEK_ALLOWED_MODELS`: optional comma-separated DeepSeek allow-list
- `DEEPSEEK_AGENT_MODELS`: models permitted to use Agent Tools (defaults to `DEEPSEEK_MODEL`)
- `ANTHROPIC_API_KEY`: optional; enables `anthropic` provider via Claude Messages API (`ANTHROPIC_CLAUDE_API_KEY` is also accepted)
- `ANTHROPIC_MODEL`: default Claude model (default `claude-sonnet-5`)
- `ANTHROPIC_API_BASE_URL`: Anthropic base URL (default `https://api.anthropic.com/v1`)
- `ANTHROPIC_VERSION`, `ANTHROPIC_MAX_TOKENS`: Claude request version and output token cap
- `ANTHROPIC_ALLOWED_MODELS`: optional comma-separated Anthropic allow-list
- `TOGETHER_API_KEY`: optional; enables `together` provider via OpenAI-compatible chat completions (`TOGETHER_AI_API_KEY` is also accepted)
- `TOGETHER_MODEL`: default Together model
- `TOGETHER_API_BASE_URL`: Together OpenAI-compatible base URL (default `https://api.together.ai/v1`)
- `TOGETHER_ALLOWED_MODELS`: optional comma-separated Together allow-list
- `TOGETHER_AGENT_MODELS`: models permitted to use Agent Tools (defaults to `TOGETHER_MODEL`; `TOGETHER_AI_AGENT_MODELS` is also accepted)
- `OPENROUTER_API_KEY`: optional; enables `openrouter` provider via OpenAI-compatible chat completions (`OPEN_ROUTER_API_KEY` is also accepted)
- `OPENROUTER_MODEL`: default OpenRouter model (default `anthropic/claude-sonnet-5`)
- `OPENROUTER_API_BASE_URL`: OpenRouter base URL (default `https://openrouter.ai/api/v1`)
- `OPENROUTER_HTTP_REFERER`, `OPENROUTER_TITLE`: optional OpenRouter attribution headers
- `OPENROUTER_ALLOWED_MODELS`: optional comma-separated OpenRouter allow-list
- `OPENROUTER_AGENT_MODELS`: models permitted to use Agent Tools (defaults to `OPENROUTER_MODEL`; `OPEN_ROUTER_AGENT_MODELS` is also accepted)
- `COPILOT_MODEL`, `COPILOT_ALLOWED_MODELS`: GitHub Models default and optional comma-separated allow-list
- `ENABLE_BASIC_AUTH`: `true` or `false`
- `BASIC_AUTH_USER`, `BASIC_AUTH_PASS`: only used if basic auth enabled
- `BASIC_AUTH_SESSION_SECRET`: optional long random signing key for the `/basic-auth` browser login; defaults to a key derived from the Basic Auth credentials
- `BASIC_AUTH_SESSION_TTL_MS`: browser login lifetime in milliseconds (default `43200000`, or 12 hours; clamped from 1 minute to 7 days)
- `HOST`: Node listen address (default `127.0.0.1`; keep loopback when using a reverse proxy)
- `ALLOWED_ORIGINS`: optional comma-separated CORS allowlist for `/api/chat`
- `SANDBOX_ROOT`: folder used by file APIs (default `./sandbox`)
- `FILE_API_MAX_READ_BYTES`: max bytes for file read endpoint (default `1048576`)
- `FILE_API_UPLOAD_MAX_BYTES`: max upload bytes (default `20971520`)
- `FILE_API_CHUNK_SIZE_BYTES`: preferred File Lab chunk size (default `4194304`)
- `FILE_API_MAX_CHUNK_SIZE_BYTES`: largest selectable File Lab chunk size (default `67108864`)
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
- Expiring public file shares with optional passwords, encrypted snapshots, view/download analytics, last-access timestamps, expiry warnings, one-click extension, and revocation
- Unencrypted, unpassworded direct media links support HTTP byte ranges for browser and external video players
- Password-protected links require browser unlock; encrypted links intentionally do not support byte-range seeking
- Public share URLs use `APP_BASE_URL` when configured, otherwise the trusted reverse-proxy request origin

## Chat archive and portability

- `archive.html`: export chats as JSON and import on another device
- Optional password-encrypted archive export/import (AES-GCM via Web Crypto)
- `Save to Server` and `Load from Server` store a named archive profile under the Basic Auth account. Choose a distinct profile name for each person or purpose. The browser encrypts it with a password before upload, so the server stores only the ciphertext. Server archive storage requires `ENABLE_BASIC_AUTH=true`; configure `CHAT_ARCHIVE_ROOT` and `CHAT_ARCHIVE_MAX_BYTES` as needed. The `default` profile preserves the original server archive location.
- Import modes: merge archive into current chats or replace all local chats
- Main chat page includes per-reply copy buttons for Markdown, plain text, and rendered HTML
- Assistant math supports KaTeX delimiters (`$...$`, `$$...$$`, `\\(...\\)`, and `\\[...\\]`), and long tool-call lists collapse behind a per-message count
- One-click button to copy all assistant replies in active chat
- Markdown rendering now supports horizontal rules (`---`) and GitHub-style tables
- Browser-local chat/global context entries support master toggles and individual include/exclude controls for every line
- Chat requests support automatic provider-context compaction when message size limits are hit. Persistent Context Manager content receives a reserved budget and remains in the provider payload while older chat is compacted; full local chat history remains available through Archive and History JSON.

## Design Lab

- `design.html` provides an opt-in Elephant/GOLDFISH-style workflow: context-rich brainstorming, specification drafting, zero-context review, and resolution planning.
- This is an app-native workflow using configured chat providers; the Google repository is an agent design/review plugin, not a hosted inference model.

## Agent tool-calling mode

- Agent mode requires a valid configured API key, even when ordinary chat is available behind Basic Auth.
- State-changing browser API requests must come from the configured application origin; non-browser clients must authenticate with an API key.
- Chat and workspace-selection POST requests accept JSON only.
- Optional Agent Reach tools provide semantic web search, YouTube search/transcripts, and backend health checks. Configure their fixed executable paths with the `AGENT_REACH_*` environment variables.
- YouTube may block transcript extraction from VPS addresses. Use `AGENT_REACH_PROXY` or a cookie file exported from a dedicated account via `AGENT_REACH_YOUTUBE_COOKIES_FILE`; do not use a primary-account cookie file.

- Chat UI includes an `Agent Tools` toggle for configured OpenAI-compatible providers: OpenAI, Google Gemini, xAI, DeepSeek, Together AI, and OpenRouter. Anthropic Claude chat is supported without Agent Tools mode.
- Agent Operations includes a priority run queue with urgent/high/normal/low ordering, two concurrent runs by default, workspace pause/resume, queued reprioritization, cancellation, and expandable results.
- Queued and scheduled runs can select any configured agent-capable provider and model. Scheduled Saved Recipes support one-time, interval, and time-zone-aware daily execution with overlap prevention and completion notifications.
- Completed subagents expose declared artifacts and explicit context proposals for per-item acceptance or rejection; decisions are workspace-scoped and audit logged, and context remains inert until applied in the browser.
- Coding children remain inert until an authenticated workspace user approves their tool/write-scope grant. Existing directories become explicit trailing-slash scopes; files remain exact grants. Their writes stay uncommitted, and accepted artifacts open preselected in Git Change Center for explicit staging and commit review.
- Subagent step budgets scale by role: 64 for research/image, 96 for review, and 128 for coding, with a 256-step server ceiling. A parent can split independent components or non-overlapping file scopes across eight siblings, with four running concurrently.
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
- The hardened systemd service runs as `remote-ai-access` with `SupplementaryGroups=docker`; deployments must ensure that user and group exist and that `/var/run/docker.sock` remains group-accessible.
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
- Browser users can sign in at `/basic-auth` with the configured Basic Auth credentials; native HTTP Basic Auth remains available for scripts and password managers
- Keep `APP_BASE_URL` set to the canonical HTTPS origin so same-origin request validation is deterministic
- Raw workspace HTML previews run in a script-disabled, opaque-origin iframe
- Keep dependencies updated
