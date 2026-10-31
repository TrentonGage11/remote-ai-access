# External Black-Box Security Assessment: ai.tg11.org

Assessment date: 2026-08-23  
Target: https://ai.tg11.org  
Perspective: unauthenticated attacker, followed by a low-privilege user with the supplied HTTP Basic credential  
Testing mode: authorized, non-destructive external black-box assessment  
Final retest: 2026-08-23, approximately 21:00 UTC

## Executive summary

The unauthenticated perimeter is narrow, but the credentialed application contains two serious authorization failures that can be chained into server-side command execution.

The global HTTP Basic gate resisted the unauthenticated bypasses tested. After the owner supplied the Basic credential, however, the application exposed a second authorization tier: direct file, terminal, Git, test, and notification APIs require an API key, while administration requires an admin token. That separation is not enforced by server-side agent jobs. A Basic-only request to the chat API successfully caused the agent to invoke run_terminal and execute the harmless command pwd even though the direct terminal endpoint returned 401 API key required.

The chat endpoint is also vulnerable to cross-site request forgery. A browser with cached Basic credentials sent those credentials automatically on a cross-site simple POST. A cross-origin application/x-www-form-urlencoded request with agentMode=true then caused the target to execute the harmless run_terminal command pwd and returned executedTools containing run_terminal. An attacker can therefore make a victim browser invoke agent tools without reading the response. Combined with the authorization bypass above, this creates a realistic chain from an arbitrary attacker-controlled page to blind workspace access or command execution in the agent container.

A third material issue weakens the edge architecture. The Basic-only tool catalogue discloses a public origin IPv4 address and a root SSH remote. The origin accepts direct HTTP and HTTPS connections from the Internet; direct authenticated HTTPS returned the application with no Cloudflare headers. SSH is also reachable. SSH advertised public-key authentication only, which is a useful compensating control, and the application still required Basic Auth, but the configuration allows anyone who learns the address to bypass Cloudflare protections.

One additional high-impact browser issue is probable but was not executed against production. File Lab previews raw workspace HTML in a same-origin iframe with both allow-same-origin and allow-scripts. The origin CSP permits arbitrary modules from esm.sh, while the API key and admin token are stored in origin-wide localStorage. Attacker-controlled workspace HTML can therefore plausibly run with the application origin and obtain privileged browser state. Unescaped Git subjects and search-result paths provide related stored HTML injection paths.

Two perimeter issues found earlier in the assessment were fixed before the final retest:

- TLS 1.0 and TLS 1.1 now fail with a protocol-version alert; TLS 1.2 and TLS 1.3 remain healthy.
- The registrar now publishes the matching DNSSEC DS record, and both Cloudflare and Google validating resolvers return the AD flag.

### Overall posture

The pre-authentication edge is reasonably strong, but the authenticated trust model is not. Possession of the outer Basic credential currently grants substantially more capability than the documented API-key boundary suggests, and a victim who has cached that credential can be induced cross-site to exercise those capabilities. The first remediation priority is to enforce authorization at every agent tool invocation and to add real CSRF protection to every state-changing browser endpoint.

### Finding summary

| ID | Title | Status | Severity | Confidence |
|---|---|---|---:|---:|
| F-01 | API-key authorization bypass permits Basic-only agent tool and terminal execution | Confirmed | High | High |
| F-02 | CSRF permits Basic-authenticated agent execution and state changes | Confirmed | High when chained; Medium standalone | High |
| F-03 | Disclosed public origin permits direct Cloudflare bypass and exposes SSH | Confirmed | Medium | High |
| F-04 | Upload bypass and workspace codes are placed in URLs | Confirmed | Low | High |
| F-05 | Exact Apache and SSH product versions are disclosed | Confirmed | Informational | High |
| F-06 | Client-supplied trace identifiers are reflected | Confirmed | Informational | High for reflection |
| P-01 | Same-origin HTML preview and stored HTML sinks can compromise browser-held secrets | Probable | High | Medium-High |
| P-02 | Workspace codes may not enforce an object-level ownership boundary | Probable | Medium | Medium-Low |
| P-03 | No Basic-auth throttling observed at a 12-request threshold | Probable | Low | Medium |
| R-01 | Deprecated TLS 1.0 and TLS 1.1 accepted | Resolved during assessment | None active | High |
| R-02 | DNSSEC lacked a parent chain of trust | Resolved during assessment | None active | High |

## Scope, rules, and testing effects

The assessment was limited to ai.tg11.org, the origin host disclosed by the application, and infrastructure clearly serving the target. Cloudflare anycast addresses were not subjected to broad or aggressive scanning. Unrelated tg11.org services and third-party systems were not tested.

The supplied Basic credential was read from tmp.txt in memory. Its values were never printed or placed literally in commands. The file was verified unchanged at the end; its digest is intentionally omitted because a digest of a small credential file could assist offline guessing.

The following limits were maintained:

- No denial-of-service, resource exhaustion, high-volume guessing, crash testing, request smuggling, or destructive payloads.
- No file write, upload, rename, delete, Git mutation, snapshot restore, settings update, notification, or external exfiltration request.
- No API key or admin token was available. Direct file, Git, test, notification, sharing, and admin behavior beyond their authorization gates remains partially untested.
- No other user's workspace code or data was enumerated.
- The public origin address is intentionally redacted from this report.
- Apache and OpenSSH CVEs were not inferred solely from upstream banner versions because Ubuntu backports security fixes without changing those upstream version components.

Low-impact server-side effects created for validation:

- Five asynchronous chat-job submissions: two intentionally invalid bodies, one minimal non-agent response check, one read-only list_directory check returning only a count, and one pwd terminal check.
- Two synchronous agent requests executing only pwd, including the final form-encoded CSRF validation.
- One no-op workspace selection of default and one no-op branch selection of the already-current branch in a disposable browser context.
- One SSH authentication-method probe using no credential; it was rejected and advertised publickey only.

No job, record, or file was deleted afterward, in keeping with the owner's request. The assessment did not intentionally modify persistent application data or configuration.

## Methodology

The work combined manual browser validation with conservative scripted requests:

- DNS A, AAAA, NS, DNSKEY, CDS, DS, CAA, certificate, and validating-resolver checks.
- TLS protocol and cipher negotiation with OpenSSL.
- Narrow TCP checks of the Cloudflare hostname and the application-disclosed origin.
- HTTP method, path-normalization, proxy-header, host-header, authentication parsing, CORS, CSRF, caching, cookie, and security-header tests.
- Authenticated crawl of HTML pages and JavaScript bundles.
- JavaScript endpoint, data-flow, storage, and injection-sink review from live-served assets.
- Runtime comparison of Basic-only, API-key-protected, and admin-token-protected routes.
- Harmless agent tool validation using list_directory and pwd only.
- Low-volume Basic-auth rate-limit testing.
- Final retest after the transient Cloudflare 525 condition was resolved.

Potential results were reproduced and compared with negative controls. Scanner or version signatures were not treated as vulnerabilities without behavior-level validation.

## Attack surface

### Architecture

~~~text
Internet client
  -> Cloudflare edge and public certificate
    -> publicly reachable Apache/2.4.52 (Ubuntu) origin
      -> HTTP Basic authentication
        -> Remote AI Access application
          -> Basic-only chat, job, configuration, and workspace-selection APIs
          -> API-key file, terminal, Git, test, and notification APIs
          -> admin-token security API
          -> server-side agent tool executor
            -> Docker terminal and workspace tools
~~~

The final line is the broken boundary: the agent tool executor did not require the API key that protects equivalent direct APIs.

### DNS, certificate, and edge transport

- A: 104.21.61.199 and 172.67.213.126
- AAAA: Cloudflare anycast addresses
- Authoritative DNS: darl.ns.cloudflare.com and rafe.ns.cloudflare.com
- Edge certificate: tg11.org and wildcard tg11.org, issued by Google Trust Services
- Certificate validity observed: 2026-08-02 through 2026-10-31
- TLS 1.2 and 1.3: valid ECDHE/AEAD negotiation
- HTTP/2: negotiated
- HTTP/3: advertised
- DNSSEC final state: matching DS at the org parent and AD from 1.1.1.1 and 8.8.8.8
- CAA: no record observed; optional hardening only

### Public services

Cloudflare front-end listeners were observed on standard Cloudflare ports. The application-disclosed origin was narrowly checked:

| Origin port | Result | Observation |
|---:|---:|---|
| 22/tcp | Open | OpenSSH_8.9p1 banner; root login name disclosed; publickey only advertised |
| 80/tcp | Open | Apache 301 redirect to HTTPS |
| 443/tcp | Open | Direct application response; Cloudflare Origin certificate; no Cloudflare headers |
| 3000/tcp | Closed or filtered | No connection |
| 8080/tcp | Closed or filtered | No connection |
| 8443/tcp | Closed or filtered | No connection |

The origin IP is omitted to avoid further disclosure. It is returned by the Basic-only /api/tools response in workspaceGitRemote.remoteSshUrl.

### Authenticated pages

The following returned 200 with Basic Auth:

- /
- /index.html
- /filelab.html
- /api-tools.html
- /security-admin.html
- /notifications.html
- /notification-rules.html
- /notification-permission.html
- /snapshots.html
- /diff-merge.html
- /search.html
- /test-runner.html
- /archive.html
- /history.html
- /audit.html

Fifteen same-origin JavaScript bundles, styles.css, and models.csv were identified. No source-map reference was found. File Lab imports pinned CodeMirror modules live from https://esm.sh.

### Authentication and authorization layers

| Layer | Representative routes | Observed result |
|---|---|---|
| No credential | Most application pages and APIs | 401 Basic challenge |
| Public token surface | /share/{token}, share-media.js | Random token returned 404; public token route exists |
| Basic only | /api/config, /api/tools, /api/openapi.json, /api/chat, /api/chat/jobs, /api/session/workspace, /api/session/branch | 200, 202, or application validation errors |
| Basic plus API key | /api/files, workspace Git, /api/tests, /api/notifications | 401 API key required without key |
| Basic plus admin token | /api/admin/security | 403 Invalid admin token without token |

The application advertises x-api-key as the default API-key header. Direct attempts to reuse the supplied Basic username or password as the API key or admin token failed.

### API and interface inventory

Chat and jobs:

- POST /api/chat
- POST /api/chat/jobs
- GET /api/chat/jobs/{jobId}
- DELETE /api/chat/jobs/{jobId}
- GET /api/chat/jobs/{jobId}/events using Server-Sent Events

Session and workspace:

- GET and POST /api/session/workspace
- GET and POST /api/session/branch
- GET /api/session/workspace/git
- POST /api/session/workspace/git/pull
- POST /api/session/workspace/git/push

Metadata:

- GET /api/config
- GET /api/tools
- GET /api/openapi.json
- GET /models.csv

Files and workspace:

- GET /api/files/list
- GET /api/files/read
- GET /api/files/download
- POST /api/files/write
- POST /api/files/upload
- Chunked upload start, chunk, status, and complete routes
- POST /api/files/copy
- POST /api/files/move
- POST /api/files/rename
- DELETE /api/files/delete
- POST /api/files/mkdir
- POST /api/files/format
- POST /api/files/lint
- POST /api/files/terminal
- GET /api/files/audit
- Git log and revert routes
- Snapshot list, create, restore, diff, and merge routes
- Search, media preview, browser-session, and public-share routes

Other:

- GET /api/notifications
- GET /api/tests/profiles
- POST /api/tests/run
- GET and PUT /api/admin/security

No WebSocket or GraphQL interface was found.

The OpenAPI document contains 38 paths and 43 operations but omits several live chat-job, SSE, sharing, media, and browser-session routes. It defines ApiKeyAuth but does not attach that requirement to the protected file, Git, test, and notification operations. Runtime enforcement worked on direct requests.

### Browser storage and security headers

Sensitive origin-wide localStorage keys include:

- remote-ai-access-api-key
- remote-ai-access-api-key-header
- remote-ai-access-admin-token
- filelab-upload-bypass-code
- remote-ai-access-chat-state-v1
- remote-ai-access-history-v1
- remote-ai-access-chat-backups-v1
- remote-ai-access-context-global-v1

The API authentication bundle patches same-origin /api fetch calls to add the stored API key. The security-admin page can display real API keys, the agent override code, and upload bypass codes after admin authentication.

The global CSP observed on File Lab was:

~~~text
default-src 'self';
script-src 'self' https://esm.sh;
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self' https://ai.tg11.org https://esm.sh;
object-src 'none';
base-uri 'self';
form-action 'self';
font-src 'self' https: data:;
frame-ancestors 'self';
script-src-attr 'none';
upgrade-insecure-requests
~~~

HSTS, X-Frame-Options, nosniff, no-referrer, Cross-Origin-Opener-Policy, and Cross-Origin-Resource-Policy were present. Static JavaScript uses public max-age=2678400, approximately 31 days, with unversioned filenames.

## Confirmed findings

### F-01: API-key authorization bypass permits Basic-only agent tool and terminal execution

- Severity: High
- Confidence: High
- CVSS v3.1: 8.8, AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H
- Classification: CWE-862 Missing Authorization; CWE-863 Incorrect Authorization; OWASP A01 Broken Access Control; OWASP API5 Broken Function Level Authorization
- Affected endpoints: POST /api/chat and POST /api/chat/jobs when agentMode is true
- Preconditions: The attacker has the outer HTTP Basic credential but does not have the application API key.
- Security boundary: The API key is intended to protect file, terminal, Git, test, notification, and related privileged capabilities.

#### Technical explanation

The live configuration says API-key authentication is enabled and protects:

~~~text
/api/files
/api/session/workspace/git
/api/tests
/api/notifications
~~~

The direct terminal route correctly rejected Basic-only access:

~~~http
POST /api/files/terminal HTTP/1.1
Host: ai.tg11.org
Authorization: Basic <redacted>
Content-Type: application/json

{"command":"pwd"}

HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error":"API key required for this endpoint","hint":"Provide header x-api-key"}
~~~

The chat routes are outside the protected prefixes. They accept agentMode and pass the request to a privileged server-side tool executor. The executor did not independently enforce the API-key policy.

#### Reproduction and proof of concept

Send the same Basic credential, omit x-api-key, and ask the agent to run only pwd:

~~~http
POST /api/chat HTTP/1.1
Host: ai.tg11.org
Authorization: Basic <redacted>
Content-Type: application/json

{
  "provider": "openai",
  "model": "gpt-5.5",
  "agentMode": true,
  "autoCompact": false,
  "messages": [{
    "role": "user",
    "content": "Authorized test. Use only run_terminal with the exact command pwd. Return only the output length."
  }]
}
~~~

Observed sanitized response:

~~~http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "agentMode": true,
  "executedTools": ["run_terminal"],
  "reply": "<present; path intentionally not retained>"
}
~~~

A separate Basic-only asynchronous job completed list_directory and returned only an entry count. No file names or content were retained in the assessment output.

The disclosed terminal policy uses Docker but allows 107 command names, including sh, bash, python, python3, node, cat, curl, wget, and git. Its own documentation permits pipes, redirects, and command chains. Docker isolation reduces host impact but does not protect the mounted workspace or secrets reachable from the tool environment.

#### Security boundary violated

A Basic-only user was denied the direct terminal API yet reached the equivalent privileged function through chat. Authorization was checked at one HTTP route but not at the downstream capability.

#### Realistic impact

A Basic-only attacker was confirmed able to enumerate the workspace root and execute an allow-listed shell command inside the agent container.

The advertised tool catalogue and terminal policy make the following additional impacts likely, but they were not exercised:

- Reading, modifying, or deleting workspace files.
- Invoking Git, tests, snapshots, notifications, permissions, and API tools.
- Making outbound requests with curl, wget, Git, or agent web tools.
- Consuming provider tokens and compute.

No host escape, root shell, persistence, destructive action, or data exfiltration was attempted. The confirmed boundary is command execution in the configured agent environment, not proof of origin-host root compromise.

#### Likelihood

High for anyone who obtains the shared Basic credential. Exploitation needs one normal chat request and no API key, special race, or complex payload.

#### Recommended remediation

1. Enforce an immutable authorization context inside the agent tool dispatcher. Every privileged tool call must check the authenticated principal, workspace scope, and required permission immediately before execution.
2. Require the API key, or preferably a scoped per-user session, whenever agentMode is true. Reject the request before provider invocation if the permission is absent.
3. Split ordinary chat and tool-capable agent execution into distinct endpoints and scopes.
4. Bind authorization to the job at creation and revalidate it on each tool step, including resumed or queued jobs.
5. Require explicit out-of-band user approval for write, delete, terminal, Git push/revert, permission, notification, sharing, and administrative tools. Prompt text is not authorization.
6. Reduce the terminal command surface. Treat sh, bash, Python, Node, redirects, pipes, curl, wget, and similar interpreters as arbitrary code execution even when command names are allow-listed.
7. Keep the container unprivileged, rootless where possible, read-only by default, without host Docker socket, cloud metadata access, broad environment secrets, or unrestricted egress.
8. Log principal, workspace, tool name, normalized arguments, approval decision, and result for every call without logging secrets.

#### Remediation verification

- Basic-only POST requests with agentMode true must return 401 or 403 before a provider job is created.
- A non-agent chat request may continue if intentionally allowed.
- A properly scoped API key should permit only its assigned tools and workspace.
- Revoking the key or permission while a job is queued must prevent later tool execution.
- Direct and indirect attempts to invoke run_terminal, read_file, write_file, Git, and admin functions without the corresponding scope must all fail.

#### Chaining

This finding combines directly with F-02:

~~~text
attacker-controlled site
  -> victim browser sends cached Basic credential
    -> CSRF submits agentMode request
      -> missing API-key authorization at tool dispatcher
        -> blind terminal or workspace action
~~~

### F-02: CSRF permits Basic-authenticated agent execution and state changes

- Severity: High when chained with F-01; Medium for provider-cost abuse alone
- Confidence: High
- CVSS v3.1 for the demonstrated chain: 8.1, AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:N
- Classification: CWE-352 Cross-Site Request Forgery; OWASP A01 Broken Access Control
- Affected endpoints: POST /api/chat, POST /api/session/workspace, and POST /api/session/branch; POST /api/chat/jobs also accepts cross-origin simple requests but its body parsing was not relied on for the command-execution proof
- Preconditions: A victim has authenticated to ai.tg11.org using browser-cached Basic credentials and then visits attacker-controlled content.
- Security boundary: Cross-site content must not exercise authenticated state-changing functionality.

#### Technical explanation

HTTP Basic credentials are ambient browser state. CORS governs whether a script can read a response; it does not stop a simple cross-site request from being sent.

The chat endpoint accepts application/x-www-form-urlencoded bodies, including the message and agentMode fields. Such a form POST is a simple cross-origin request and does not require a CORS preflight. The route reflects arbitrary Origin values but does not send Access-Control-Allow-Credentials. The missing credential allowance blocks response reads, but execution occurs before the browser applies that read restriction.

A headless Chrome test first authenticated normally, then loaded an attacker-origin page. Chrome automatically attached the cached Basic Authorization header to a cross-site simple POST. The target returned its application-level JSON validation response instead of the outer 401, proving that cached Basic credentials cross the authentication boundary. A separate combined form-encoded request with an untrusted Origin then executed run_terminal.

#### Reproduction and proof of concept

Browser proof that the Basic credential is ambient:

~~~http
POST /api/chat HTTP/1.1
Host: ai.tg11.org
Authorization: Basic <automatically attached and redacted>
Origin: http://127.0.0.1:<random-port>
Content-Type: text/plain

security_assessment_probe=invalid
~~~

Observed response:

~~~http
HTTP/1.1 400 Bad Request
Access-Control-Allow-Origin: http://127.0.0.1:<random-port>
Vary: Origin

{"error":"messages must contain non-empty user or assistant items within size limits","traceId":"<redacted>"}
~~~

A behaviorally validated form-encoded command proof returned:

~~~http
POST /api/chat HTTP/1.1
Host: ai.tg11.org
Authorization: Basic <redacted>
Origin: https://attacker.invalid
Content-Type: application/x-www-form-urlencoded

provider=openai&model=gpt-5.5&agentMode=true&message=Use+only+run_terminal+with+the+exact+command+pwd

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://attacker.invalid
Vary: Origin

{"agentMode":true,"executedTools":["run_terminal"],"reply":"<present; path intentionally not retained>",...}
~~~

No Access-Control-Allow-Credentials header was returned. The response would be unreadable to attacker JavaScript, but the command had already executed.

An ordinary attacker page can generate the same request without JavaScript-controlled headers:

~~~html
<form id="f"
      action="https://ai.tg11.org/api/chat"
      method="post">
  <input name="provider" value="openai">
  <input name="model" value="gpt-5.5">
  <input name="agentMode" value="true">
  <input name="message" value="Use only run_terminal with the exact command pwd">
</form>
<script>f.submit()</script>
~~~

The proof used only pwd. A real attacker can supply a different agent instruction; no destructive instruction was tested.

Workspace and branch switching also accept application/x-www-form-urlencoded:

~~~http
POST /api/session/workspace HTTP/1.1
Authorization: Basic <redacted>
Origin: https://attacker.invalid
Content-Type: application/x-www-form-urlencoded

accessCode=default

HTTP/1.1 200 OK
Set-Cookie: raa_workspace=<redacted>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000

{"ok":true,"workspaceCode":"default"}
~~~

A no-op POST selecting the already-current branch also returned 200. The workspace cookie lacks Secure, but it is a selector rather than the authentication credential.

#### Security boundary violated

An attacker-controlled origin can make an authenticated victim invoke an agent tool and change application selection state without a CSRF token or trusted-Origin decision.

#### Realistic impact

Confirmed:

- Blind terminal execution of pwd through the victim's Basic-authenticated session.
- Unauthorized provider cost and quota consumption.
- Workspace and branch selection changes.
- Audit-log noise.

Likely because of F-01 and the advertised tools, but intentionally not exercised:

- Blind workspace read or mutation.
- Git, snapshot, notification, sharing, or other agent-tool effects.
- Data exfiltration through an allowed outbound tool even though the browser cannot read the response.

#### Likelihood

High when a user keeps the Basic credential cached in a browser. Exploitation can be embedded in a normal attacker-controlled page and does not require knowing the Basic credential.

#### Recommended remediation

1. Reject state-changing requests when Origin is missing or does not exactly match the approved application origin. If non-browser clients must omit Origin, require a non-ambient scoped API credential for that path.
2. Require application/json for JSON APIs and return 415 for text/plain and form-encoded chat bodies.
3. Add a cryptographically strong CSRF token bound to the authenticated browser session.
4. Do not rely on CORS or SameSite cookies to protect HTTP Basic authentication.
5. Stop reflecting arbitrary origins. Prefer no CORS on browser-only chat routes, or use an exact allow-list and include credentials only when deliberately required.
6. Require API-key or per-user scoped authorization for all state-changing chat, job, workspace, and branch actions.
7. Validate the request synchronously before queuing. Empty job bodies currently receive 202 and are rejected only later.
8. Replace shared Basic Auth with per-user OIDC or Cloudflare Access sessions with MFA, expiry, revocation, and audit identity.

The [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) provides implementation patterns for tokens, custom headers, and Origin validation.

#### Remediation verification

- Repeat the attacker-origin browser test. The target must reject the request before provider or workspace action.
- text/plain and form-encoded chat bodies must return 415.
- application/json from an attacker origin must fail trusted-Origin or CSRF validation.
- A legitimate same-origin request with a valid session and token should succeed.
- Confirm no job record or provider usage is created for rejected requests.

#### Chaining

The F-02 to F-01 chain is the highest-risk confirmed attack path in this assessment.

### F-03: Disclosed public origin permits direct Cloudflare bypass and exposes SSH

- Severity: Medium
- Confidence: High
- CVSS v3.1: 6.5 provisional, AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:L
- Classification: CWE-200 Exposure of Sensitive Information; CWE-284 Improper Access Control; OWASP A05 Security Misconfiguration
- Affected assets: the redacted origin IPv4 address on ports 22, 80, and 443; GET /api/tools
- Preconditions: An attacker learns the origin address. A Basic-only user can obtain it directly from the tool catalogue.
- Security boundary: Internet traffic should traverse Cloudflare before reaching the origin.

#### Technical explanation

The Basic-only /api/tools document returns workspaceGitRemote.remoteSshUrl. Its value contains a public IPv4 address and the root account name. That address accepts direct connections from arbitrary Internet clients.

Direct port results:

~~~text
22/tcp   open
80/tcp   open
443/tcp  open
3000     closed or filtered
8080     closed or filtered
8443     closed or filtered
~~~

The origin certificate is a Cloudflare Origin certificate and is not publicly trusted for a direct client. That is normal for Full (strict) origin TLS, but it does not stop an attacker from connecting while ignoring public trust validation.

#### Reproduction and proof of concept

Retrieve the remote without printing it into shared logs:

~~~bash
curl -su '<basic-user>:<basic-password>' \
  https://ai.tg11.org/api/tools |
  jq -r '.workspaceGitRemote.remoteSshUrl'
~~~

Extract the host as ORIGIN_IP, then test direct routing:

~~~bash
curl -k --resolve ai.tg11.org:443:$ORIGIN_IP \
  -i https://ai.tg11.org/

curl -k --resolve ai.tg11.org:443:$ORIGIN_IP \
  -su '<basic-user>:<basic-password>' \
  -i https://ai.tg11.org/
~~~

Observed sanitized responses:

~~~http
HTTP/1.1 401 Unauthorized
Server: Apache/2.4.52 (Ubuntu)
WWW-Authenticate: Basic realm=Remote AI Access

HTTP/1.1 200 OK
Server: Apache/2.4.52 (Ubuntu)

<title>Remote AI Access</title>
~~~

Neither direct response contained cf-ray or cf-cache-status. Direct port 80 returned an Apache 301. SSH returned:

~~~text
SSH-2.0-OpenSSH_8.9p1
Authentication methods: publickey
~~~

No SSH credential was tried and no login succeeded.

#### Security boundary violated

The origin responds to clients that did not traverse or authenticate through Cloudflare. Any WAF, bot, IP reputation, edge rate-limit, Access, and DDoS controls present only at Cloudflare can be bypassed.

#### Realistic impact

- Direct attack and password-guessing traffic can avoid Cloudflare edge policy.
- The origin address and SSH service become targets for vulnerability research and resource attacks.
- Direct traffic can reveal distinct origin behavior and versions.
- If the Basic credential is obtained, the complete application can be used directly.

The application Basic gate remained active, SSH was key-only, and no direct unauthenticated application access or SSH login was achieved. Those controls keep the issue at Medium rather than High.

#### Likelihood

Medium. The address is disclosed to every Basic user and may also exist in passive DNS, logs, or scanning databases. Exploitation of the bypass is trivial once it is known.

#### Recommended remediation

1. Firewall origin ports 80 and 443 to current Cloudflare source ranges only, or use Cloudflare Tunnel so the origin has no public inbound web listener.
2. Enable and enforce Authenticated Origin Pulls or equivalent mTLS at Apache. Cloudflare documents that AOP ensures requests are from its network: [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/).
3. Restrict SSH to a VPN, bastion, or narrow administrator allow-list. Keep public-key-only authentication, disable direct root login where practical, and use a dedicated deploy account.
4. Remove the public origin address and root username from /api/tools. Return an internal alias or omit the SSH remote from client-facing metadata.
5. After restriction, consider changing the origin address if it has been broadly exposed.
6. Monitor direct-origin logs separately during the transition.

#### Remediation verification

- From a non-Cloudflare external host, direct TCP connections to origin 80 and 443 should time out or reject, or TLS should require the Cloudflare client certificate.
- Direct SSH should be unreachable outside the approved administration path.
- Normal requests through ai.tg11.org must continue to work.
- /api/tools must no longer reveal a public address or privileged account name.

#### Chaining

~~~text
Basic-only metadata disclosure or passive discovery
  -> origin IP
    -> bypass Cloudflare controls
      -> direct Basic guessing or application probing
        -> F-01 if Basic access is obtained
~~~

### F-04: Upload bypass and workspace codes are placed in URLs

- Severity: Low
- Confidence: High
- Classification: CWE-598 Use of GET Request Method With Sensitive Query Strings; CWE-200
- Affected client: filelab.js and app.js
- Affected parameters: upload_code and access_code
- Preconditions: A user enters an upload bypass code or selects a non-default workspace.
- Security boundary: Credential-like codes should not enter browser history, proxy logs, request logs, or copied URLs.

#### Technical explanation

File Lab sends the upload bypass code in a header and redundantly in query strings for normal and chunked uploads:

~~~javascript
/api/files/upload?upload_code=<code>
/api/files/upload/chunk/start?upload_code=<code>
/api/files/upload/chunk/<id>?index=<n>&upload_code=<code>
/api/files/upload/chunk/<id>/complete?upload_code=<code>
~~~

The live bundle also places non-default workspace access codes in page URLs:

~~~javascript
url.searchParams.set("access_code", code);
~~~

The site-wide Referrer-Policy no-referrer reduces third-party Referer leakage, but it does not prevent Cloudflare, Apache, application, audit, browser-history, screenshot, clipboard, or support-log exposure.

#### Reproduction

Review live filelab.js around lines 2064-2137 and 2437-2440, and app.js around lines 330-333. No real code value was printed or submitted during this assessment.

#### Realistic impact and likelihood

Anyone with access to request logs, browser history, copied URLs, or diagnostic traces may recover a bypass or workspace selector. Actual impact depends on the bypass code's scope and expiry. Likelihood is Medium over time because URL logging is common; direct impact is Low because the API key and Basic gate remain additional controls.

#### Recommended remediation

- Send upload bypass codes only in a dedicated header or authenticated request body, never in the URL.
- Store workspace selection in a server-side session or opaque HttpOnly cookie rather than the page URL.
- Redact current parameter names at Cloudflare, Apache, application, APM, and audit layers until the client is fixed.
- Make bypass codes short-lived, single-purpose, revocable, and scoped to a workspace and operation.
- Rotate any long-lived code that may already be present in retained logs.

#### Remediation verification

Exercise normal and chunked uploads and workspace switching in a test environment. Browser location, network URL, reverse-proxy logs, and application logs must contain no raw code.

#### Chaining

A leaked upload code may weaken upload controls. A leaked workspace code becomes more consequential if P-02 or F-01 remains.

### F-05: Exact Apache and SSH product versions are disclosed

- Severity: Informational
- Confidence: High
- Classification: CWE-200; OWASP A05 Security Misconfiguration
- Affected services: Apache error pages and direct origin headers; origin SSH banner
- Preconditions: None once the origin is known
- Security boundary: No direct access-control boundary was crossed.

#### Evidence

~~~http
GET /server-status HTTP/1.1
Host: ai.tg11.org

HTTP/1.1 403 Forbidden

<address>Apache/2.4.52 (Ubuntu) Server at ai.tg11.org Port 443</address>
~~~

Direct SSH returned OpenSSH_8.9p1. /server-status remained denied, including ?auto and spoofed loopback proxy headers.

#### Impact

The banners improve exploit selection. They do not prove the installed Ubuntu package revision or any CVE. The upstream Apache security page lists vulnerabilities affecting upstream 2.4.52, but Ubuntu backports fixes. As of the final report, the Ubuntu Jammy package index listed 2.4.52-1ubuntu4.23 for common architectures: [Ubuntu apache2 package](https://packages.ubuntu.com/source/jammy/apache2).

#### Recommended remediation

Configure Apache:

~~~apache
ServerTokens Prod
ServerSignature Off
~~~

Keep /server-status disabled or tightly restricted. Verify and update packages using the origin's package manager rather than the banner:

~~~bash
dpkg-query -W -f='${binary:Package}:${Version}\n' apache2 apache2-bin openssh-server
apt-cache policy apache2 apache2-bin openssh-server
~~~

Keep SSH key-only and disable direct root login if operationally possible.

#### Verification

External error pages and headers should omit detailed versions. Package commands should show the current supported security revision. No CVE should be closed solely from the banner.

### F-06: Client-supplied trace identifiers are reflected

- Severity: Informational
- Confidence: High for reflection; Low for downstream log impact
- Classification: Potential CWE-117 only if downstream logs trust or unsafely serialize the value
- Affected header: x-trace-id
- Preconditions: None

#### Reproduction

~~~http
GET / HTTP/1.1
Host: ai.tg11.org
X-Trace-Id: user-controlled-probe

HTTP/1.1 401 Unauthorized
X-Trace-Id: user-controlled-probe
~~~

Reflection alone is not a vulnerability. If audit systems treat the value as server-authentic, an attacker could create collisions or misleading correlation.

#### Remediation and verification

Generate the authoritative trace identifier at the external trust boundary. If client correlation is useful, preserve the submitted value in a separately named, length- and character-restricted untrusted field. Verify that responses and security logs distinguish the two values.

## Probable vulnerabilities requiring additional validation

### P-01: Same-origin HTML preview and stored HTML sinks can compromise browser-held secrets

- Severity: High
- Confidence: Medium-High
- Provisional CVSS v3.1: 8.7, AV:N/AC:L/PR:L/UI:R/S:C/C:H/I:H/A:N
- Classification: CWE-79 Improper Neutralization of Input During Web Page Generation; CWE-922 Insecure Storage of Sensitive Information
- Affected pages: /filelab.html, /snapshots.html, and /search.html
- Preconditions: A victim with an API key or admin token in localStorage previews or views attacker-controlled workspace or Git metadata.
- Status: The dangerous data flow and configuration are confirmed. Production script execution was not attempted because it would require placing attacker-controlled content in the workspace.

#### Technical explanation

File Lab fetches raw workspace HTML using the stored API key and places it directly into srcdoc:

~~~html
<iframe id="previewHtmlFrame"
        sandbox="allow-same-origin allow-scripts">
~~~

~~~javascript
const html = await blob.text();
previewHtmlFrameEl.srcdoc = html;
~~~

The exact live locations were filelab.html line 203 and filelab.js lines 1062-1173.

For same-origin content, allow-same-origin preserves the ai.tg11.org origin and allow-scripts permits JavaScript. The page CSP blocks inline script but permits arbitrary modules from https://esm.sh. An attacker can publish or control a module reachable on that trusted origin and reference it from workspace HTML. Code then runs with access to parent, same-origin APIs, and ai.tg11.org localStorage. It can also remove its iframe sandbox attribute and reload.

MDN specifically discourages combining allow-scripts and allow-same-origin for same-origin content because the embedded document can remove the sandbox: [iframe sandbox guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).

Two related unescaped sinks broaden the entry paths:

- snapshots.js lines 55-65 inserts a Git or snapshot subject into innerHTML without escaping.
- search.js lines 49-63 inserts a result path into innerHTML without escaping.

Linux and Git filenames and commit subjects can contain HTML metacharacters. A nested iframe srcdoc payload can create a new document that loads an esm.sh module even though a script element directly inserted with innerHTML would not execute.

#### Minimal staging proof

1. Use a disposable workspace and a non-production test API key.
2. Place an HTML file whose only external test module sets a benign marker on parent.document.
3. Preview the file in File Lab.
4. Confirm the module can read a harmless localStorage sentinel and access parent.
5. Repeat with an HTML-marked filename and Git subject, using only a visual marker.
6. Do not use or read production tokens.

#### Realistic impact

- Theft of API key, admin token, upload bypass code, chat history, context, and agent override data.
- Same-origin API invocation as the victim.
- Administrative security-setting changes if an admin token is present.
- Workspace read/write, sharing, Git, terminal, or notification actions.

An imported untrusted repository is a realistic source even when the attacker has no application credential.

#### Likelihood

Medium. Victim interaction and attacker-controlled workspace or Git content are required, but previewing repository HTML and viewing search/snapshot metadata are normal product behaviors.

#### Recommended remediation

1. Serve untrusted previews from a dedicated origin that has no application cookies, localStorage, API routes, or trust relationship with ai.tg11.org.
2. For raw preview, remove script permission entirely. Use sandbox with no allow-scripts and no allow-same-origin.
3. If script execution is a required feature, keep the iframe on an opaque or isolated origin and communicate through a narrowly validated postMessage protocol.
4. Never combine allow-scripts and allow-same-origin for attacker-controlled same-origin content.
5. Replace innerHTML with textContent for result paths, subjects, tool descriptions, and rule names. Build DOM elements with createElement.
6. Bundle CodeMirror locally, remove https://esm.sh from script-src, and use immutable build-time dependency pinning.
7. Move API and admin credentials from localStorage to short-lived HttpOnly Secure SameSite sessions. Keep administrative sessions on a separate origin if possible.
8. Rotate existing API/admin/bypass credentials after the sinks are fixed if untrusted workspace content has ever been previewed.

#### Verification

- Attacker HTML preview must have an opaque origin and no ability to access parent or localStorage.
- Scripts in preview content must not execute unless explicitly isolated and approved.
- HTML metacharacters in paths and subjects must render literally.
- CSP should use script-src 'self' unless a specifically justified source is required.

#### Chaining

~~~text
untrusted repository, filename, or commit subject
  -> File Lab preview, search, or snapshot page
    -> trusted-origin script execution
      -> localStorage API/admin token theft
        -> privileged API or security-admin access
~~~

### P-02: Workspace codes may not enforce an object-level ownership boundary

- Severity: Medium if workspaces belong to different users or tenants
- Confidence: Medium-Low
- Classification: CWE-639 Authorization Bypass Through User-Controlled Key; OWASP API1 Broken Object Level Authorization
- Affected inputs: X-Workspace-Code, raa_workspace, access_code, and POST /api/session/workspace
- Preconditions: Multiple trust-separated workspaces exist and an attacker can know or guess another valid code.
- Status: The unconstrained configuration and selector design are confirmed; non-default or cross-tenant selection was intentionally not attempted.

#### Evidence

GET /api/session/workspace reports constrainedByAllowList as false. The client accepts codes matching:

~~~text
[a-z0-9][a-z0-9_-]{1,47}
~~~

The assessment selected only default and the already-current branch as no-op checks. Static client behavior and the reported unconstrained setting indicate that non-default codes are designed to be accepted, but that behavior and cross-workspace access were not validated. Traversal syntax fell back to default. There is no per-user application identity beyond the shared Basic credential.

#### Potential impact

If codes correspond to different users, customers, or repositories, a Basic user may be able to switch to another workspace. F-01 could then expose or modify that workspace without the API key.

#### Recommended validation

In staging, create two disposable users and two workspaces with distinct ownership. Attempt every workspace, file, chat-job, Git, test, snapshot, notification, and share operation using the other user's ID. Validate both header and cookie selectors.

#### Recommended remediation

- Authenticate named users, not a shared Basic principal.
- Resolve every workspace from a server-side principal-to-workspace ownership mapping.
- Treat workspace codes as selectors, never as authorization.
- Scope API keys and agent jobs to one workspace and re-check ownership on every operation.
- Set constrainedByAllowList true if the feature is intended to expose only configured workspaces.
- Use non-enumerable identifiers but do not rely on identifier entropy as the control.

#### Remediation verification

Cross-user workspace selection and all downstream direct or agent-mediated operations must return 403 without revealing whether the object exists.

### P-03: No Basic-auth throttling observed at a 12-request threshold

- Severity: Low
- Confidence: Medium
- Classification: CWE-307 Improper Restriction of Excessive Authentication Attempts; OWASP A07 Identification and Authentication Failures
- Affected boundary: global HTTP Basic authentication
- Preconditions: Network access and a weak, reused, shared, or leaked credential
- Status: No control was visible at the deliberately small threshold; a higher or monitoring-only control may exist.

#### Reproduction

Twelve rapid, distinct invalid credentials all returned 401 at normal speed. None returned 429, Retry-After, a challenge, or monotonic delay growth. Six common default credential pairs were also rejected.

This does not prove unlimited guessing and no larger campaign was attempted.

#### Impact and likelihood

Basic Auth has no account-specific second factor or revocable browser session. Successful guessing grants access to F-01. Likelihood depends primarily on credential entropy, reuse, logging, and undisclosed edge or origin controls.

#### Recommended remediation

- Prefer Cloudflare Access or OIDC with named users, MFA, expiry, revocation, and audit identity.
- If Basic remains, use a long random unique credential and rotate it regularly.
- Apply rate limits at both Cloudflare and the origin, keyed to trusted client IP plus normalized username.
- Alert on distributed failures. Avoid long blocking sleeps or permanent lockout that can be abused for denial of service.
- Ensure direct-origin traffic cannot bypass the control, as described in F-03.

#### Verification

In staging or a maintenance window, verify the documented threshold, 429 or safe backoff response, Retry-After behavior, alert generation, origin parity, recovery window, and resistance to trivial distributed attempts.

## Resolved during assessment

### R-01: Deprecated TLS 1.0 and TLS 1.1

Initial testing confirmed TLS 1.0 and 1.1 with CBC/SHA-1-era suites. Final testing showed both handshakes fail:

~~~text
tlsv1 alert protocol version
SSL alert number 70
~~~

TLS 1.2 and TLS 1.3 remained valid:

~~~text
TLSv1.2  ECDHE-ECDSA-CHACHA20-POLY1305
TLSv1.3  TLS_AES_256_GCM_SHA384
Certificate verification: OK
~~~

Current status: resolved. Keep Cloudflare Minimum TLS Version at 1.2 or higher. Cloudflare documents the setting at [Minimum TLS Version](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/).

### R-02: DNSSEC parent chain of trust

Initial testing found Cloudflare DNSKEY, RRSIG, CDS, and CDNSKEY data but no DS at the org parent. Final testing found the matching DS:

~~~text
2371 13 2 12142A706A7A1F208A2CE8EB154CAFFC678CB017D6D6B5C265E6859BDA4CBA43
~~~

Both 1.1.1.1 and 8.8.8.8 returned the AD flag for the DS and ai.tg11.org A response.

Current status: resolved. Future DNS provider or key changes should coordinate DS removal and replacement carefully to avoid validation outages.

## Attack-chain analysis

### Chain A: cross-site page to server-side command execution

~~~text
attacker hosts ordinary webpage
  -> victim previously authenticated with HTTP Basic
    -> browser automatically sends cached Basic credential
      -> form-encoded CSRF sets agentMode=true
        -> chat route omits API-key requirement
          -> agent tool executor invokes run_terminal
            -> confirmed harmless command; broader workspace impact is likely
~~~

Status: High-confidence confirmed chain through harmless run_terminal execution. Destructive action and exfiltration were deliberately not executed.

### Chain B: untrusted repository to privileged browser compromise

~~~text
attacker controls repository HTML, filename, or commit subject
  -> privileged user previews or views it
    -> same-origin iframe or innerHTML gadget loads CSP-allowed script
      -> script reads localStorage API/admin credentials
        -> privileged API and admin actions
~~~

Status: Probable High. The data flows and unsafe sandbox/CSP combination are confirmed; production script execution was not attempted.

### Chain C: metadata disclosure to edge bypass

~~~text
Basic user reads /api/tools
  -> public origin IP and root SSH username
    -> direct origin connection bypasses Cloudflare
      -> direct probing or Basic guessing
        -> F-01 after credential access
~~~

Status: Confirmed through direct application routing. No SSH login or credential guessing was attempted.

### Chain D: workspace selector to cross-workspace agent access

~~~text
known or guessed workspace code
  -> unconstrained workspace selection
    -> F-01 agent tool invocation
      -> other workspace data or command execution
~~~

Status: Conditional. No other workspace was accessed.

### Closed chain: DNS or legacy TLS

The final TLS and DNSSEC retests close the earlier legacy-transport and unsigned-delegation chains. Continue monitoring these settings after Cloudflare or registrar changes.

## Negative validation and false positives

The following were tested without confirming a vulnerability:

- No unauthenticated bypass of the Basic gate through encoded paths, duplicate slashes, dot segments, malformed credentials, alternate methods, or spoofed reverse-proxy headers.
- X-Forwarded-For, X-Real-IP, True-Client-IP, Forwarded, X-Original-URL, and X-Rewrite-URL did not bypass Basic Auth, the API key, admin token, or /server-status controls.
- Invalid Host and absolute-form targets were rejected or normalized; no open proxy was found.
- TRACE was rejected.
- The outer Basic username and password did not work as the API key or admin token.
- Direct file, Git, test, and notification routes rejected Basic-only access.
- /api/admin/security stayed 403 across encoding and proxy-header variants.
- Authenticated Cloudflare responses were not served to an unauthenticated cache request.
- Cross-origin GETs did not expose API data. Chat responses omit Access-Control-Allow-Credentials, so attacker JavaScript cannot read credentialed responses.
- Clickjacking protections are present through CSP frame-ancestors and X-Frame-Options.
- /server-status returned only a forbidden page; no worker or request data was exposed.
- No source maps, .git content, .env file, backup file, debug console, GraphQL endpoint, or WebSocket interface was exposed before authentication.
- The public share route returned 404 for a random token. Token entropy and object authorization require a disposable API key and share object to assess fully.
- Path traversal values in workspace selectors fell back to default. No filesystem traversal was demonstrated.
- The chat and File Lab Markdown renderers escape raw input before generating markup. Diff and audit renderers also escape content.
- No pre-authentication cookie was issued.
- The edge certificate was valid for ai.tg11.org.
- The Apache and OpenSSH banners are not proof of a CVE. Current Ubuntu package revision and enabled modules must be checked internally.
- No host escape, container escape, privilege escalation, SQL injection, template injection, XXE, insecure deserialization, SSRF, or direct origin authentication bypass was demonstrated.

## Informational observations and hardening

1. The raa_workspace selector cookie is HttpOnly and SameSite=Lax but lacks Secure. Add Secure and consider SameSite=Strict. It is not the primary authentication credential.
2. No logout endpoint exists for HTTP Basic; browsers effectively retain the session until they forget cached credentials or close. Prefer per-user session authentication.
3. Static JavaScript is publicly cacheable for about 31 days under unversioned names. Use content-hashed filenames or short revalidation so security fixes cannot remain stale in browsers.
4. API responses such as /api/config and /api/tools lack explicit Cache-Control. Add private, no-store where responses contain operational or security-sensitive data.
5. Bundle CodeMirror locally and reduce script-src to self. Version-pinning a live esm.sh URL does not eliminate CDN, registry, or transitive supply-chain risk.
6. Correct the OpenAPI security requirements and document every live route, including jobs, SSE, sharing, media preview, and browser sessions.
7. Publish a minimal /.well-known/security.txt outside Basic Auth.
8. Consider a deliberate CAA policy compatible with every CA Cloudflare may use.
9. Add a narrow Permissions-Policy after inventorying required browser features.
10. Keep HSTS and strong framing, MIME, referrer, and opener policies.

## Prioritized remediation

### 1. Fix immediately

1. Enforce API-key or per-user scoped authorization inside the agent tool dispatcher and block agentMode before job creation when permission is absent.
2. Add strict CSRF defenses to chat, jobs, workspace, and branch endpoints; reject text/plain and form bodies for JSON APIs.
3. Firewall the origin to Cloudflare, enable Authenticated Origin Pulls or use Cloudflare Tunnel, and restrict SSH to an administration path.
4. Disable same-origin scripted HTML preview and fix the unescaped path and snapshot-subject sinks.

### 2. Fix soon

1. Replace shared Basic Auth with per-user OIDC or Cloudflare Access and MFA.
2. Move API/admin secrets out of localStorage into short-lived HttpOnly Secure sessions; separate the admin origin if possible.
3. Implement explicit workspace ownership and scoped credentials; validate BOLA with two disposable accounts.
4. Remove upload bypass and workspace codes from URLs and redact historic logs.
5. Validate and enforce Basic-auth throttling at both edge and origin until Basic is retired.
6. Update Apache, OpenSSH, the OS, container images, and dependencies from supported security repositories; then suppress version banners.

### 3. Defense-in-depth improvements

1. Rootless, least-privilege agent containers with read-only mounts by default, strict egress, no host sockets, and minimal secrets.
2. Explicit approvals for every mutating or externally communicating agent tool.
3. Locally bundled, content-hashed JavaScript and a self-only script CSP.
4. Accurate OpenAPI authorization declarations and complete endpoint inventory.
5. Secure, SameSite selector cookies and private/no-store API responses.
6. Server-generated trace IDs with untrusted client IDs separated.
7. Public security.txt, carefully configured CAA, and a narrow Permissions-Policy.

### 4. Resolved or monitor

1. Keep Minimum TLS Version at 1.2 or higher and monitor Cloudflare configuration drift.
2. Monitor DNSSEC DS/DNSKEY consistency through registrar or provider changes.
3. Retest direct-origin reachability after firewall or Tunnel changes.
4. Retest all browser sinks and rotate exposed client-side credentials after remediation.

## Remediation acceptance test

A focused retest should demonstrate:

- Basic-only ordinary chat works only if intentionally allowed, while any agent tool request fails before provider invocation.
- Direct and indirect privileged operations enforce the same principal, scope, workspace, and approval checks.
- Cross-origin text/plain, form, and JSON POSTs create no job or selection change.
- Direct origin 80/443 and SSH are unreachable from an ordinary Internet host.
- Untrusted HTML runs on an isolated origin or cannot execute script, and paths/subjects render as literal text.
- API/admin secrets are absent from localStorage and URLs.
- Two disposable users cannot select or operate on each other's workspaces.
- Current package revisions are documented and patched.
- TLS 1.0/1.1 remain disabled and DNSSEC remains fully validated.

## Final conclusion

The target's unauthenticated edge resisted the tested bypasses, and the owner fixed the observed TLS and DNSSEC weaknesses during the engagement. The credentialed application nonetheless has a high-risk authorization flaw: Basic-only chat can invoke server tools that direct APIs reserve for an API key. Because browser-cached Basic credentials are also CSRFable on the chat endpoints, an external attacker can plausibly turn one victim page visit into blind agent command execution.

The fastest risk reduction is to disable or API-key-gate agent mode immediately, reject cross-origin and non-JSON state-changing requests, and restrict the origin to Cloudflare. The HTML preview and browser-secret model should be corrected next, before untrusted repositories or metadata are handled in privileged sessions.
