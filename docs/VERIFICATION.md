# Verified Contracts and Security Boundaries

Checked against actual npm packages and official documentation on 2026-10-17. This is a commercial-cloud, local, single-process MVP, not a production deployment.

## Sharing preparation (2026-10-19)

- Optional GitLab uses the official configured HTTPS `/api/v4/mcp` endpoint and a supported Bearer token. It is disabled when both settings are absent; partial or insecure configuration fails explicitly. Legacy PATs are not documented as a working official-MCP authentication method.
- GitLab's exact read-tool allowlist is in [src/gitlab.js](../src/gitlab.js). Gemini names are prefixed with `gitlab_`, while remote calls use the discovered original names. No write, generic executor or Duo session tools are exposed.
- The shared HTTP MCP transport refuses redirects, bounds response size to 1 MiB, handles multiline/chunked SSE events without waiting for an open stream to end, follows bounded cursor pagination and coalesces initialization. OAuth/expired-session refresh is not implemented.
- Provider failures are isolated: one failing integration does not remove another provider's tools. Multiple model tool responses are returned together, preserving call IDs.
- The Teams ZIP description now discloses external AI and optional integrations rather than claiming no external AI is used. Developer/privacy/terms URLs remain placeholders and must be reviewed before app distribution.
- The [short new-machine guide](QUICKSTART.md), [integration guide](INTEGRATIONS.md) and [session template](../config.example.ps1) separate clone-time source from per-developer secrets and bot registrations.
- Root and tools use locked dependency installs. CI runs offline on Windows without secrets. Publishing excludes private files, local dependencies/runtime, logs and generated packages; the Git file inventory must still be reviewed before the first commit.
- SDK 2.1.0 maps `App.start(0)` to its default port, so HTTP authentication tests initialize the SDK and start its HTTP server directly on an ephemeral port. Runtime verifies its own listener after `App.start`, refusing a success-shaped startup when the SDK catches a bind failure.

These checks are not a full independent security audit or a production-readiness certification. Local-file storage, shared integration identities and a single process remain explicit limitations. Concurrent messages are not queued per chat, so memory ordering and a clear command racing an in-flight reply are not guaranteed; avoid overlapping requests in this MVP. No live GitLab connection has been made.

## Published Packages and Local Environment

| Item | Verified result |
| --- | --- |
| OS | Windows_NT 10.0.19045 x64 |
| Original Node | 20.11.1, unsupported |
| Local test Node/npm | Portable official Node 22.23.3 / npm 10.9.9; ZIP SHA-256 matched official SHASUMS256.txt |
| SDK | `@microsoft/teams.apps@2.1.0`, published engines `>=22.12.0` |
| CLI | `@microsoft/teams.cli@3.0.4`, published engines `>=22.12.0` |
| ZIP library | `fflate@0.8.3`, pinned patched release; 0.8.2 had GHSA-px8p-9vwx-vf98 |
| Installations | Runtime and isolated tools installed normally, native install scripts enabled |
| Local native cache | `PersistenceCreator.createPersistence` with Windows CurrentUser protection succeeded |

The CLI remains outside runtime dependencies. `npm ci` at root and all fake-CLI/runtime tests do not require its native modules. `npm run tools:install` is a separate operation. Root and tools lockfiles record resolved packages. No global CLI install or automatic CLI update is used.

## SDK 2.1.0

- `new App({clientId, clientSecret, tenantId, dangerouslyAllowUnauthenticatedRequests:false})` overrides the unsafe environment fallback in the installed constructor. No unauthenticated adapter/token injection is exposed in production code.
- `app.on('message', handler)`, `app.start(port)` and `app.stop()` are used as published. Mention normalization is explicitly disabled with `activity.mentions.stripText:false`; the handler checks the Microsoft-delivered mention entity against `activity.recipient.id`.
- The HTTP server validates inbound bearer tokens before activity handlers. The installed validator checks Teams issuer/audience/signature/lifetime and service URL claims. ARGUS additionally checks tenant/user/channel/scope and commercial Teams service URL hosts. Unit tests of handler inputs do not replace SDK authentication.
- `app.api.clone({serviceUrl: address.serviceUrl}).conversations.createActivity(conversationId, payload)` uses the authenticated saved regional route. Tests exercise both the clone arguments and the real API client's HTTP request to a loopback receiver. The API package calls its exported constructor `Client`; `ApiClient` is the apps package's alias.
- The Teams SDK handles Teams transport/authentication; ARGUS makes its own Gemini REST calls and streamable-HTTP MCP calls. It does not use Graph chat APIs or the Teams SDK's historical AI prompt/plugin abstractions.
- The proactive API path performs a single createActivity call, not a streaming/retry path. Delivery timeout is conservative: unknown, no automatic replay. SDK authentication HTTP calls are distinct from message delivery.
- SDK/app/client loggers suppress raw values. Operator errors expose only fixed safe codes, not exception objects or remote response bodies.

## CLI 3.0.4

Actual installed `--help --json`, source and output serializers were inspected; flags are not inferred from a different CLI:

```text
teams --disable-auto-update --yes app create --name ARGUS
  --teams-managed --sign-in-audience myOrg
  --endpoint https://PUBLIC-HOST/api/messages
  --env PRIVATE-DIRECTORY/bot.credentials.json
  --color-icon PRIVATE-DIRECTORY/color.png
  --outline-icon PRIVATE-DIRECTORY/outline.png --json
```

Global `--yes` is passed only by the guarded setup command after the operator supplied `--confirm`. `--disable-auto-update` is always supplied by the wrapper/client. Create JSON is a plain object, not an envelope: `teamsAppId`, `botId`, `botLocation:'teams-managed'`, `endpoint`, and `credentialsFile` when `--env` was supplied. Without that destination the CLI can print credentials, so ARGUS never invokes create without it and rejects a credentials-bearing response.

JSON credential files use `{ "Teams": { "ClientId": "...", "ClientSecret": "...", "TenantId": "..." } }`, not flat environment-variable names. CLI output is captured privately and never dumped on parse/failure. Secret import selects only verified required fields.

`status --json` returns `loggedIn`, `tenantId`, `userObjectId` (MSAL localAccountId), `tdp.connected`, and `tdp.sideloading.tenant/user`. Unknown flags fail closed. Status also reports Azure CLI details, but ARGUS does not require or use an Azure subscription.

Source confirms login uses `loginScopes=[]`; on-demand resource tokens use silent acquisition only. The explicit user-controlled consent bridge uses that same pinned MSAL client/cache with separate interactive resource requests. No assumption is made that login consented to Graph or Portal. Preflight requires both tokens and read-only Graph access, Portal connection and both upload flags; it does not guarantee every tenant role/policy permits creation.

The narrow bridge reads installed CLI internal modules for secure storage, consent and metadata inspection; these are version-pinned **private APIs**, not claimed stable SDK APIs. On upgrade, reverify them. Runtime imports none of them. Native secure storage must work; no install-script/TLS/cache security bypass is used. The supported setup environment is native Windows, not WSL.

CLI create lacks a scope flag and initially defaults to personal/team/groupChat. Finish immediately invokes `app update MANAGEMENT-ID --scopes personal,groupChat --json`, re-reads and verifies metadata before releasing an installation link. Runtime rejects team/channel scope independently.

The metadata bridge uses `fetchAppDetailsV2` (`teamsAppId` management ID, `appId` external manifest ID), its single `bots[0].botId`, `fetchBot` (managed, isSingleTenant, messagingEndpoint), and Graph application lookup (AzureADMyOrg). It returns a strict nonsecret metadata selection only. The current CLI's generated manifest id may equal the client ID; ARGUS does not rely on that equality.

Installation link follows the actual CLI helper: `https://teams.microsoft.com/l/app/MANAGEMENT-ID?installAppPackage=true&appTenantId=TENANT-ID`.

Endpoint updates use `app update MANAGEMENT-ID --endpoint ... --json`; no create call occurs. Setup preserves IDs and uses a durable pre-create marker. Create is not a transactional Microsoft operation; the marker intentionally survives failures and blocks duplicate creates. Finish/recover cannot reconstruct a secret value or guess incomplete cloud resources.

## Storage and Threat Model

Local bearer token: 32 cryptographic random bytes; operator compares SHA-256 digests with `timingSafeEqual`, is bound only to 127.0.0.1, rejects Origin/fetch browser headers, validates exact input keys/types and caps JSON bodies at 1 KiB. The operator only selects an authenticated registered alias and the fixed message. Local malware or the Windows account owner can read local private secrets; the token is not a defense against a compromised laptop.

Conversation keys include tenant, scope and authenticated conversation ID. Alias owner and address are immutable under registration. STOP deactivates the whole current chat and clears that chat's AI memory; another alias cannot reset a shared chat's send status. Route changes require review, not an automatic redirect. The accepted service hosts are restricted to commercial Teams Bot Framework/Teams infrastructure, in addition to SDK authentication; sovereign clouds are not supported by this MVP.

Gemini credentials are read from process environment variables and sent only in the `x-goog-api-key` header to Google's Generative Language API. Atlassian credentials are read from process environment variables and sent only to the fixed `https://mcp.atlassian.com/v2/mcp?tools=all` endpoint. The MCP client exposes only discovered Jira read/search tools and denies names associated with writes. This name-based restriction is an application guard, not a substitute for least-privilege Atlassian permissions or independent security review. The Atlassian account is shared among Argus users, so its visible Jira projects are visible through this bot to every allowlisted user. Do not use a broad account.

AI memory is stored in `.private/conversation-memory.json`, scoped to tenant and Teams chat, and retains at most the latest 12 user/assistant exchanges. `DECISION DONE`, `FORGET`, and `STOP` clear the current chat's memory. The model does not infer that a decision is final. Local disk ACLs do not encrypt this content at rest. Each message and retained recent turns are sent to Gemini; Jira tool results are sent to Gemini for response generation. Configure only when the relevant users are authorized for that data transfer.

Atomic writes use same-directory unique temporary files, file fsync and rename. Any malformed persisted store or failed write stops further use. One process/one writer is enforced with an exclusive lock; after a crash its removal requires human verification. This is not a distributed database or guaranteed power-loss recovery mechanism.

Sending/unknown reservations block proactive sends globally. Cooldown is per authenticated chat. A manual reconciliation is explicitly a human assertion, with exact attempt ID and confirmation, not a Microsoft receipt and not a resend. If delivery remains ambiguous, retain unknown.

## Offline Test Coverage

The Gemini, MCP and memory tests use synthetic credentials and mocked HTTP responses; they do not contact Google, Atlassian or Teams, and do not validate real credentials or tenant permissions.

Latest validation (2026-10-19): the complete suite passed with Node 22.23.3 (**73 passed, 0 failed**) while a separate local bot remained running. A clean source-only copy, excluding private state, local runtime and dependencies, installed 115 packages using `npm ci --offline` and passed **72 tests with 1 expected skip** (the installed-CLI help contract is skipped when the optional CLI has not been installed). No provider credentials or cloud registrations were needed. The old Node 20 runtime remains unsupported.

All publishable JavaScript passed Node syntax checks, the PowerShell session template parsed successfully, and local documentation file links resolved. The Git candidate inventory contained 50 files; private/dependency/runtime/build locations were excluded. A local known-token-pattern scan found no matches; this is not an exhaustive secrets audit and does not authorize publication without the owner's review.

Tests use Node's built-in runner, fake CLI responses, temporary private directories and mocked Gemini/MCP HTTP responses. They do not log into Microsoft, Google or Atlassian, request consent, create a tunnel/bot, or deliver to a real Teams tenant. Coverage includes registration/mentions, isolation, ownership/STOP, conversation memory/clear commands, Gemini/MCP tool-call boundaries, preview/confirmation, operator HTTP security, durable reservations/concurrency/cooldown/unknown, restart/corrupt state, regional SDK routing, unsigned HTTP rejection, PNG/ZIP contents, initialization/credential import, provisioning flags/policy/consent stops, duplicate protection/resume/recover, identity preservation and endpoint updates.

Commands to reproduce:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run tools:install
npm.cmd run teams -- --version
node tools/bridge.js storage
npm.cmd audit
npm.cmd --prefix tools audit
```

Local readiness reports shape separately from Microsoft credential verification and real delivery. Neither offline tests nor a Graph/Portal metadata query verifies the bot secret or human receipt. Real personal/group Teams flow remains untested until an authorized user performs it.

## Official References

- [Teams SDK](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/)
- [Register an app quickstart](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/get-started/quickstart-register)
- [SDK trust model](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/essentials/app-authentication/trust-model)
- [Proactive messaging](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/essentials/sending-messages/proactive-messaging)
- [Persistent local tunnels](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/developer-tools/local-tunnels)
- [Dev Tunnels CLI commands](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands)
- [Developer Program FAQ](https://learn.microsoft.com/en-us/office/developer-program/microsoft-365-developer-program-faq)
- [Tenant preparation](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/prepare-your-o365-tenant)
- [Teams custom app policy](https://learn.microsoft.com/en-us/microsoftteams/teams-custom-app-policies-and-settings)
- [App upload](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload)
- [Microsoft 365 trials/purchases](https://learn.microsoft.com/en-us/microsoft-365/commerce/try-or-buy-microsoft-365)