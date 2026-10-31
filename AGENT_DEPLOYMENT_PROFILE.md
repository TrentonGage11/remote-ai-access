# Agent Deployment Profile

## Goal

Allow authorized agents to deploy reviewed workspace applications to approved `tg11.org` subdomains without granting SSH, a Cloudflare tunnel shell, root access, or arbitrary `systemctl`/Apache execution.

## Boundary

Deployment must be a dedicated server tool, not an extension of `run_terminal`. The tool accepts a declarative manifest and performs fixed operations through a privileged local helper. Agents never receive private keys, Cloudflare credentials, certificate keys, or unrestricted filesystem access.

## First Release

Add a `deploy_application` tool available only to a new `deployment` profile with explicit approval. Its manifest should contain:

- Workspace-relative build artifact and health path
- Subdomain under an administrator-configured suffix allow-list
- Runtime selected from an allow-list such as Node static/Node service
- Requested environment variable names, with secret values resolved server-side
- Port allocated from an administrator-configured pool
- Resource limits and persistent-data requirement

The helper should generate systemd and Apache files from fixed templates, validate the build and Apache configuration, start the candidate on loopback, run its health check, then atomically enable the vhost. A failed health check restores the prior release.

## Required Controls

- API-key and one-time deployment approval required
- Workspace snapshot and immutable release archive before deployment
- Subdomains constrained to an allow-list and checked for conflicts
- No arbitrary service names, paths, commands, proxy targets, certificate paths, or ports
- Dedicated Unix user, loopback bind, systemd sandboxing, CPU/memory/process limits
- Structured audit events for validation, activation, rollback, and public verification
- Preview/dry-run mode showing generated changes without applying them
- Per-workspace deployment concurrency of one
- Explicit rollback tool restricted to releases created by this helper

Cloudflare Tunnel may later be supported as a fixed transport option, but agents must never receive tunnel credentials or use it as a general command channel.

## Implementation Status

The foundation release provides a `deployment` tool profile and a dry-run `deploy_application` action. It validates hostname, runtime, workspace-relative paths, approved environment variable names, and bounded resources; verifies the artifact and Node entrypoint exist in the active workspace; and records a structured deployment-preview audit event.

The approval release adds admin-only issuance, listing, and revocation. Approvals are bound to the active workspace, requested action, and canonical normalized-manifest digest; expire within 30 minutes; are stored with only a SHA-256 token hash; and can be consumed once. Token plaintext is returned only at issuance.

Static activation and rollback are deployed. A root-owned, socket-activated helper independently validates requests, rejects symlinks and hostname conflicts, copies bounded artifacts into immutable releases, renders a fixed Apache/TLS template, runs `apache2ctl configtest`, reloads Apache, and performs an SPKI-pinned loopback health check. Any failed activation restores the prior symlink and vhost.

Approval state moves from `pending` to `activating` before the helper call and then to terminal `consumed` or `failed`, preventing token replay. Rollback accepts no caller-selected target: the helper uses only the prior release recorded in its root-owned registry. Node services, arbitrary environment values, persistent data, Cloudflare transport, and unrestricted SSH remain unavailable.