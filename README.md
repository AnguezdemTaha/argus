# ARGUS Teams Agent MVP

A runnable Node.js ES-module Teams bot using the official Microsoft Teams SDK, Gemini, and optional Atlassian and GitLab MCP servers. Ordinary replies use Gemini; configured integrations expose read-only tools. Conversation context is stored locally per Teams chat until the user clears it.

**New machine? Start with the [short local setup guide](docs/QUICKSTART.md).** It covers tenant eligibility, minimum permission checks, administrator handoff, your own bot/tunnel registration and staged tests. [Optional Jira/GitLab configuration](docs/INTEGRATIONS.md) covers credentials and diagnostics. The [complete Windows walkthrough](docs/BEGINNER.md) adds detailed recovery/group-chat steps. [Verified contracts and boundaries](docs/VERIFICATION.md) explain package/API decisions.

Clone only source. Do not share `.private`, provider keys, CLI token caches, downloaded runtimes or dependency folders. Another developer must register their own approved bot and tunnel; sharing a bot identity can redirect its single messaging endpoint away from the original developer.

## Local Requirements

- Node.js >=22.12 (Node 22.23.3 was used here), npm, Windows PowerShell.
- Microsoft work/school tenant with usable Teams licensing and approved custom-app upload. A personal account or an Entra directory alone is not sufficient.
- For cloud registration: permission to create application identities and approved delegated provisioning scopes. No Azure subscription or manually provisioned Azure Bot is required by ARGUS's Teams-managed registration path.

The existing machine had Node 20.11.1. A checksum-verified, ignored portable Node 22.23.3 was installed locally. In each new terminal in **this workspace**, activate it with:

```powershell
$env:Path = "$PWD\.local\node-v22.23.3-win-x64;C:\Program Files\nodejs;$env:Path"
node --version
```

For another machine install supported Node from nodejs.org, then reopen terminals. Do not rely on the ignored portable installation being distributed with source.

`npm.cmd start` automatically uses the existing portable Node 22.23.3 when the current Node is too old, and inherits credentials from the launching terminal. AI configuration errors are reported explicitly in Teams and as fixed codes in the server terminal; ordinary replies never fall back to a simulated answer.

## Commands

Run from the project root; `npm.cmd` avoids PowerShell's npm.ps1 execution-policy issue without changing policy.

| Command | Effect |
| --- | --- |
| `npm.cmd ci` | Runtime dependencies only; CLI/native modules isolated |
| `npm.cmd test` | Offline tests; no tenant or real sends |
| `npm.cmd run setup -- init` | Idempotent private config, random token, original icons |
| `npm.cmd run tools:install` | Normal isolated pinned CLI install, including native scripts |
| `npm.cmd run teams -- login` | User-controlled Microsoft login |
| `npm.cmd run setup -- consent --confirm` | Explicit browser consent, two resources |
| `npm.cmd run setup -- preflight` | Read-only Microsoft access/policy checks |
| `npm.cmd run setup -- preview https://YOUR-HOST/api/messages` | Offline registration plan |
| `npm.cmd run setup -- create https://YOUR-HOST/api/messages --confirm` | One managed/single-tenant registration, then scope verification |
| `npm.cmd run setup -- finish --confirm` | Resume saved registration, never create again |
| `npm.cmd run setup -- recover MANAGEMENT-ID .private/bot.credentials.json --confirm` | Recover verified existing registration using original secret value |
| `npm.cmd run setup -- endpoint https://NEW-HOST/api/messages --confirm` | Update existing bot only; stop SERVER first |
| `npm.cmd run setup -- allow USER-OBJECT-ID --confirm` | Allow consenting same-tenant user; stop SERVER first |
| `npm.cmd run doctor` | Local shape/state checks, not Microsoft credential verification |
| `npm.cmd start` | Teams webhook 3978 and loopback-only operator API 3979; reads integration keys from environment |
| `npm.cmd run check:gemini -- --list-models` | List generation-capable models advertised for your key; no generation |
| `npm.cmd run check:gemini -- --generate` | One small real generation request; prints effective model |
| `npm.cmd run check:jira` | Real MCP initialization, tool listing and site discovery, not issue access |
| `npm.cmd run check:gitlab` | Real MCP initialization and read-tool listing, not project/issue/MR access |
| `npm.cmd run targets` | Registered aliases, activity and send status |
| `npm.cmd run preview -- alice` | Fixed message preview without sending |
| `npm.cmd run send -- alice --confirm` | Explicit fixed-message send |
| `node scripts/operator.js reconcile alice delivered ATTEMPT-ID --confirm` | Manual resolution after conclusive delivery review |
| `npm.cmd run package` | Optional ZIP: manifest + original icons only |

The CLI wrapper disables auto-update and verbose logs. It permits login/logout and read-only app list/get; use guarded setup for mutations. CLI help works without a Microsoft login, for example `npm.cmd run teams -- app create --help --json`.

## Runtime Rules

In the installed personal bot chat, an allowlisted user sends `REGISTER alice`. In the **exact existing group chat** where the app is installed, use a real selected `@ARGUS` mention followed by `REGISTER project`. Group commands and replies require that mention. An email, UPN, raw chat ID, service URL, or typed imitation of a mention cannot register a target.

`STOP` opts out only the authenticated current chat. Any authenticated same-tenant group member can opt that group out, even if not allowlisted. An in-flight send can still complete. Alias ownership is permanent; repeated REGISTER cannot take an alias, redirect it, or clear cooldown/uncertainty. Registering another alias in the same chat shares send state.

Ordinary replies use Gemini. If `ATLASSIAN_MCP_AUTHORIZATION` or both `ATLASSIAN_MCP_EMAIL` and `ATLASSIAN_API_TOKEN` are configured, Gemini may use the Atlassian Rovo MCP server's Jira read/search tools. Create/update/delete/comment/transition tools are excluded in code; this bot does not write to Jira. The Atlassian identity's Jira permissions still govern which issues can be read, so use an approved least-privilege account.

Set `GITLAB_MCP_URL` and `GITLAB_MCP_ACCESS_TOKEN` later to enable the official GitLab MCP endpoint. Neither is needed for Gemini/Jira. GitLab requires a supported MCP token, not a legacy REST PAT. Only explicitly allowlisted discovered project/issue/merge-request read/search tools are exposed with a `gitlab_` prefix. Details and version-dependent prerequisites are in [the integration guide](docs/INTEGRATIONS.md).

Each provider's discovery/read failures disable only that provider for the turn, with an explicit warning and safe error code. Gemini can still answer general questions or use the other provider. Gemini failures still surface as errors.

Recent conversation turns are stored in `.private/conversation-memory.json`, separately per tenant and chat, with a bounded history of up to 12 exchanges. Send exactly `DECISION DONE` or `FORGET` to clear that chat's memory; `STOP` also clears it. Jira tool results are not added to persistent memory unless the assistant includes them in its answer. Local state is protected by the Windows folder ACL, not encrypted at rest.

Proactive sends persist a reservation first. Concurrent sends and all unresolved `sending`/`unknown` attempts block further proactive sends globally. A successful send requires a nonempty Teams message ID, then a 30-second per-chat cooldown. Timeouts, missing IDs, and delivery errors become persistent `unknown`; there are no automatic delivery retries.

## Files and Boundaries

- [src/bot.js](src/bot.js): tenant/user/scope/mention authorization and chat commands.
- [src/ai.js](src/ai.js), [src/mcp.js](src/mcp.js), [src/gitlab.js](src/gitlab.js), [src/memory.js](src/memory.js): Gemini, optional read-only MCP tools and bounded per-chat memory.
- [src/store.js](src/store.js), [src/delivery.js](src/delivery.js): atomic addressing/state and delivery guard.
- [src/sdk.js](src/sdk.js), [src/server.js](src/server.js): authenticated SDK webhook and regional outbound client.
- [src/operator-api.js](src/operator-api.js): bearer-authenticated 127.0.0.1 operator API, browser rejection and strict inputs.
- [src/setup.js](src/setup.js), [tools/bridge.js](tools/bridge.js): guarded provisioning; pinned CLI/cache adapter isolated from runtime.
- [test](test): offline fake-CLI and local HTTP tests.

Private configuration, credentials, conversation addresses, attempt records, AI memory, icons and process lock live under the ignored `.private` directory. Gemini, Atlassian and GitLab credentials are read from process environment variables and are never written by ARGUS. Windows initialization removes inherited access and grants the current user access. This is access control, not at-rest encryption; use disk encryption and a private, non-synced directory. The CLI cache uses native Windows protection separately. Source control ignores private files, generated ZIPs, dependency folders and the local Node download.

One backend process only. No production durability/HA claims. Do not put private state on shared/network storage. Never expose port 3979 through a tunnel.

## Verification Status

Tests use synthetic Gemini/MCP responses and local HTTP servers, not real provider authentication. See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the latest validation. Live Gemini, Jira, GitLab and Teams access must be verified independently on each developer's account and machine. GitLab is intentionally unconfigured until you supply an approved endpoint and token. No real GitLab access is claimed.

The repository includes a Windows [offline CI workflow](.github/workflows/test.yml). It needs no secrets or cloud registration. No commit, repository creation or push is performed by running local tests.