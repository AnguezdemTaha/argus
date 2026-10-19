# ARGUS: Complete Windows Beginner Walkthrough

This walkthrough starts with no Microsoft development experience. It covers the real bot, not an architecture mockup. Read each checkpoint before proceeding. Use synthetic text and consenting test participants only.

For a new clone, start with the [short setup checklist](QUICKSTART.md). Configure optional Jira/GitLab using [the integration guide](INTEGRATIONS.md) and the non-secret [session template](../config.example.ps1). Each developer needs their own approved registration and tunnel, not another developer's private state.

## 1. Understand What You Need

These are different things, and having one does not imply the others:

| Item | Meaning | Enough to run ARGUS in Teams? |
| --- | --- | --- |
| Personal Microsoft account | Consumer Outlook.com/Hotmail/Xbox identity and personal Teams | No. This MVP targets work/school Teams, not consumer chats. |
| Microsoft Entra directory | Identity boundary containing users and application identities; has a tenant GUID | No. Creating a directory does not provide Microsoft 365 subscriptions, Teams licensing, or custom-app permissions. |
| Microsoft 365 work/school tenant with Teams | Organization with service subscriptions, assigned user licenses and enabled Teams | Necessary; still needs permissions below. |
| Permission to create application identities | Tenant policy/role allowing the provisioning identity to register/manage an app | Separate from Teams licensing and from app installation. |
| Permission to upload/install custom Teams apps | Teams tenant settings, assigned user policy and app availability permit the app | Separate from Entra app creation and Graph consent. |

The laptop hosts JavaScript. The Teams SDK validates and handles bot activities. Teams-managed registration supplies bot identity/routing infrastructure, **not hosting**. Teams still needs your public HTTPS webhook, and the app must be installed in every exact destination chat. No manually created Azure Bot or Azure subscription is required by ARGUS's registration path.

### Choose a Legitimate Test Environment

Do not buy, create, or approve anything just because a command fails. Choose one authorized option:

1. Use an existing work/school tenant only with its administrator's permission, suitable Teams licensing and a restricted test group.
2. Check current Microsoft 365 Developer Program eligibility. Joining the program does **not** guarantee an E5 sandbox. Microsoft's current FAQ lists eligible Visual Studio Professional/Enterprise standard subscribers, eligible ISV Success/MAICPP partners, and Premier/Unified Support customers through their support contacts. Eligibility/verification varies; government clouds are excluded. Review the live FAQ and dashboard rather than assuming entitlement.
3. Consider an eligible Microsoft 365 business trial or paid test subscription. Availability, identity/payment verification, country and licensing terms vary. Verify that the actual selected plan includes Teams or that the required Teams license is separately obtained. Trials can renew into paid subscriptions. Review cancellation and recurring billing before accepting.

Official sources, checked during implementation on 2026-10-17:

- [Microsoft 365 Developer Program FAQ, eligibility and current billing requirements](https://learn.microsoft.com/en-us/office/developer-program/microsoft-365-developer-program-faq).
- [Prepare a Microsoft 365 tenant for Teams development](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/prepare-your-o365-tenant).
- [Try or buy Microsoft 365 for business](https://learn.microsoft.com/en-us/microsoft-365/commerce/try-or-buy-microsoft-365).

The current Developer Program FAQ describes additional billing-account verification for sandbox setup, which may require an eligible existing Azure billing/subscription arrangement. That is a possible **tenant-acquisition prerequisite imposed by Microsoft**, not an ARGUS Azure Bot dependency. Stop and consult the billing administrator if that applies; do not create an Azure subscription or change spending settings just to follow this guide. Nothing here promises a free tenant, trial eligibility or free Teams access.

### Check the Tenant and Your User

1. Open a normal browser at [Teams](https://teams.microsoft.com/). Sign in with the test work/school account. Use a dedicated browser profile to avoid selecting a similarly named personal account.
2. Verify that Teams actually opens and that you can use its chat area. If it displays a license/account/organization error, resolve that with the tenant administrator first.
3. Open [Microsoft 365 admin center](https://admin.microsoft.com/) if you are authorized. Under **Users > Active users > your user > Licenses and apps**, verify the Teams-capable license/service is assigned. A nonadministrator should ask the administrator to check this instead.
4. Open [Entra admin center](https://entra.microsoft.com/). Select the correct directory using the account/directory menu. Under **Entra ID > Overview**, note the **Tenant ID** (GUID).
5. Under **Entra ID > Users > All users**, open your user and locate **Object ID**. This is a human user ID, not an email address, UPN, app ID or secret ID. Setup will obtain it automatically from the CLI's signed-in account.
6. Ask whether this user is allowed to create/manage application registrations. The relevant settings/roles are administered in **Entra ID > Users > User settings > App registrations** and application administrator roles. Do not change tenant policy yourself unless you are authorized.

Checkpoint: a licensed, consenting work/school user can open Teams in the intended commercial-cloud tenant. Otherwise stop the cloud portion; you can still install runtime dependencies and run every offline test.

## 2. Understand Provisioning Consent Versus Bot Permissions

The official pinned CLI uses a shared public client, ID `7ea7c24c-b1f6-4a20-9d11-9ae12e9e7ac0`. CLI 3.0.4 requests login with **no resource scopes**, then tries silent token acquisition during commands. Login alone does not prove either of these delegated permissions has been granted:

- Microsoft Graph: `https://graph.microsoft.com/Application.ReadWrite.All`.
- Teams Developer Portal: `https://dev.teams.microsoft.com/AppDefinitions.ReadWrite`.

These are substantial **provisioning identity permissions**, not ARGUS runtime chat permissions. The Graph scope generally requires administrator consent. The tenant's consent policy or Conditional Access can block either operation even when login succeeds. ARGUS does not add Graph chat read/send permissions to the bot. Runtime uses its own bot client ID/secret and Teams bot transport, not your human login token.

The explicit `setup consent --confirm` command later opens normal browser consent for each resource using the pinned CLI's own MSAL cache. Only you or an authorized administrator should approve it. It does not bypass admin consent, grant a role or change tenant policy. The bridge uses private internal CLI modules because CLI 3.0.4 has no public explicit resource-consent command; keep the version pinned and rerun tests before any upgrade.

If you see **Need admin approval**, `AADSTS65001`, consent denied, an unverified publisher concern or Conditional Access restrictions, stop. Ask your administrator to review the named CLI enterprise application, the two scopes, the tenant, and your authorized test purpose. An administrator can inspect **Entra ID > Enterprise applications > the CLI application > Permissions**, and use their normal approved admin-consent workflow. Do not use another tenant/account as a policy workaround. Run preflight again only after approval.

**Never paste passwords, secret values, MFA codes, access tokens, refresh tokens or device-login codes into assistant chat.** Type credentials only in the normal Microsoft browser sign-in UI or directly in your terminal when legitimately prompted. Do not enable transcript/verbose HTTP logging while working with credentials.

## 3. Verify Teams Custom-App Permissions

Ask the Teams administrator to review these settings for your specific test users:

1. [Teams admin center](https://admin.teams.microsoft.com/) > **Teams apps > Manage apps > Actions > Org-wide app settings > Custom apps**. Depending on the current UI, find **Let users interact with custom apps in preview** and relevant custom-app access controls.
2. **Teams apps > Setup policies**: inspect the policy assigned to the test user and whether **Upload custom apps** is enabled.
3. **Users > Manage users > your user > Policies**: confirm the intended app setup policy is actually assigned.
4. Confirm the custom app is not blocked by app availability/permission settings. Prefer a policy restricted to consenting testers, not a global policy change.
5. After an approved change, allow for Microsoft propagation time; documentation notes that some settings can take up to 24 hours. Sign out/in if needed, then run preflight again.

In Teams itself, **Apps > Manage your apps > Upload an app > Upload a custom app** is a useful UI check. A missing option is not fixed by creating an Entra directory. The automated preflight checks Developer Portal access plus both tenant-wide and user upload flags; it stops on missing/unknown values. Read-only preflight cannot guarantee that every later creation or installation will succeed.

Official references: [custom app policies and settings](https://learn.microsoft.com/en-us/microsoftteams/teams-custom-app-policies-and-settings), [upload custom apps](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload).

## 4. Prepare the Three Terminals

In VS Code, select **Terminal > New Terminal** three times. Choose Windows PowerShell. Rename terminals using the terminal dropdown/context menu:

| Name | Keep running what? |
| --- | --- |
| **SERVER** | `npm.cmd start`, the Node backend |
| **TUNNEL** | `devtunnel host ...`, the persistent HTTPS tunnel |
| **COMMANDS** | Installation, setup, tests, alias listing, preview and sends |

In each terminal, enter the project directory:

```powershell
Set-Location 'C:\work\argus'
```

For this existing workspace, activate the already downloaded portable Node in **each** terminal:

```powershell
$env:Path = "$PWD\.local\node-v22.23.3-win-x64;C:\Program Files\nodejs;$env:Path"
node --version
npm.cmd --version
```

Expected here: `v22.23.3` and `10.9.9`. The original system Node was `v20.11.1`, which is unsupported by both selected Microsoft packages.

`npm.cmd start` now automatically uses the existing portable Node 22.23.3 if the terminal's Node is too old. Other commands still require the PATH activation above. The launcher inherits credentials from the terminal where it is started; another terminal or VS Code task cannot see variables set only in your SERVER terminal. Missing AI configuration produces an explicit error, never a simulated AI reply.

On another computer, use [official Node.js downloads](https://nodejs.org/en/download) to install a supported LTS version >=22.12 using the Windows installer, then reopen VS Code terminals. Do not run this project on Node 20. If software installation requires elevation, perform it yourself through the approved installer; do not change execution policy, TLS checks or security settings to make installation pass.

Use `npm.cmd` instead of `npm` in PowerShell to avoid the npm.ps1 execution-policy issue without weakening policy. Commands below assume the working directory is the project root. `$endpoint` is a public URL, not a secret.

## 5. Install and Initialize Locally

In **COMMANDS**:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run setup -- init
npm.cmd run doctor
```

Expected: dependencies install, tests pass, initialization prints `initialized: true` and `secretsPrinted: false`. Doctor initially says configuration is incomplete, credentials are `NOT_VERIFIED`, and Teams delivery is `NOT_TESTED`. That is correct before registration.

Initialization creates `.private/config.json`, a 32-byte cryptographic random operator token encoded as 64 hex characters, and original 192x192 color / 32x32 white-transparent outline PNG icons. It does not overwrite existing values. Windows ACL initialization removes inherited access and grants the current Windows user access. If it fails, no new secret should be generated; stop and resolve private-folder access, without running as administrator as a workaround.

Do not place this workspace in a shared directory or automatic cloud sync. File permissions are not encryption: use laptop disk encryption and protect backups. Never commit `.private`, `.local`, `node_modules`, tool dependencies, ZIPs, logs or credential files. Those locations are ignored by Git. Local tests use temporary directories and synthetic credentials only.

Install the isolated official CLI next:

```powershell
npm.cmd run tools:install
npm.cmd run teams -- --version
npm.cmd run teams -- app create --help --json
```

Expected CLI version: `3.0.4`. Runtime uses `@microsoft/teams.apps` `2.1.0`. CLI packages are under `tools`, not runtime dependencies. The wrapper always supplies `--disable-auto-update`.

If the native secure-storage dependency fails to install, the runtime and offline tests remain usable. Inspect the local installation error, use supported Node/Windows architecture, and install approved native build prerequisites if needed. Do not use `--ignore-scripts` and call that a working CLI install. Do not disable TLS verification, use a plaintext credential-cache fallback, or bypass policy. `node tools/bridge.js storage` checks native secure storage without logging in or calling Microsoft; expected output is `{"secureStorage":true}`. If it fails, stop provisioning until fixed.

## 6. Sign In and Obtain Approved Consent

In **COMMANDS**, run this yourself:

```powershell
npm.cmd run teams -- login
```

It may open your normal browser; otherwise follow the official CLI prompt directly in the terminal. Choose the correct work/school account and tenant. Complete password/MFA only in the Microsoft sign-in UI. If device login is used, handle its code yourself; never send it to an assistant.

Then:

```powershell
npm.cmd run teams -- status --json
```

Look for `loggedIn: true`, the intended `tenantId`, and `userObjectId`. `tdp.connected` may still be false because resource consent is separate. Username/IDs are not secrets but can be identifying; do not share unnecessary output.

After reading section 2 and getting administrator approval where required:

```powershell
npm.cmd run setup -- consent --confirm
npm.cmd run setup -- preflight
```

Consent opens up to two browser flows, one for Graph and one for Developer Portal. Verify the correct tenant, account and requested permissions in each. If admin approval is required, stop and follow the tenant's approval process. Repeating login or consenting as an unrelated account is not a fix.

Successful preflight prints only the tenant and signed-in human user IDs. It requires login, matching configured identity if any, Developer Portal connection, tenant upload enabled, user upload enabled, both silent resource tokens and a read-only Graph applications query. It creates nothing. Creation rights can still be constrained by tenant policy; a granted scope does not bypass user-role restrictions.

Wrong account? In **COMMANDS**, use `npm.cmd run teams -- logout`, switch the browser profile/account, and log in again. Once a registration is saved, setup intentionally rejects another human/tenant identity rather than silently changing ownership.

Checkpoint: preflight succeeds. Otherwise do not run create.

## 7. Install and Approve a Persistent Microsoft Dev Tunnel

Use a tunnel only if permitted by your organization. It makes the bot webhook publicly reachable, while SDK JWT validation remains enabled.

In **COMMANDS**, install the official CLI yourself:

```powershell
winget install Microsoft.devtunnel
```

Review any installer/license prompt yourself. If winget is unavailable, follow [Microsoft's Dev Tunnels installation instructions](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started). Reopen **TUNNEL** after installation if the command is not found. In **TUNNEL**:

```powershell
devtunnel --version
devtunnel user login
devtunnel create argus-mvp --allow-anonymous
devtunnel port create argus-mvp -p 3978 --protocol http
devtunnel port list argus-mvp
devtunnel host argus-mvp
```

Create/port setup is one-time. If `argus-mvp` already exists, inspect `devtunnel show argus-mvp` and its port list instead of blindly creating another tunnel. Reuse the actual persistent ID returned by Microsoft if it differs. If a name is unavailable, choose a unique ID and use it consistently.

Expected host output resembles `Hosting port 3978 at https://ACTUAL-ID-3978.REGION.devtunnels.ms/`. Use **that real public HTTPS forwarding address**, not an inspection/traffic/debug URL. The local forwarding protocol must be `http`, because Node listens with HTTP; the external address is HTTPS.

Only port **3978** should be listed. **Never add or forward 3979.** It is the private operator interface. Anonymous tunnel access permits Microsoft to connect; it does not permit unsigned activities through the SDK. Do not set any skip-auth flag. Even `DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS=true` is overridden to false in this project.

Keep **TUNNEL** running. A 502 before the server starts is normal. Tunnel management login can use its own permitted account; that does not provide a Teams tenant/license. Do not use a temporary `devtunnel host -p ...` flow for this setup.

Official references: [SDK local tunnels](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/developer-tools/local-tunnels), [Dev Tunnels CLI reference](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands).

## 8. Preview and Create the Bot Once

In **COMMANDS**, replace the example with the public forwarding URL from **TUNNEL**:

```powershell
$endpoint = 'https://YOUR-ACTUAL-HOST/api/messages'
npm.cmd run setup -- preview $endpoint
```

Preview is completely offline. Expected: Teams-managed, `myOrg`, your HTTPS `/api/messages` endpoint, private credential-file output, JSON flags, final personal/group scopes. Review it before creating anything.

The creation endpoint should be reachable once SERVER starts. There is a bootstrap dependency: the SDK needs bot credentials, which creation generates. Keep the tunnel hosting during creation; start SERVER immediately after successful creation. Do not install or test the bot until both are running. A transient 502 during this one-time bootstrap is not a reason to disable authentication.

When you explicitly authorize creating one app identity and one Teams-managed bot/app registration:

```powershell
npm.cmd run setup -- create $endpoint --confirm
```

There is no Azure Bot resource or Azure CLI subscription step. This command:

1. Acquires a one-process lock and repeats Microsoft access checks.
2. Saves `.private/create-attempt.json` **before** the first cloud create call.
3. Executes pinned CLI create with `--teams-managed --sign-in-audience myOrg --endpoint ... --env ... --json`.
4. Writes returned credentials privately, without printing them in JSON.
5. Verifies saved tenant/user, bot client ID, management app ID, external manifest ID, single-tenant audience, managed bot registration and endpoint against Microsoft metadata.
6. Immediately updates the existing app to `personal,groupChat` because this CLI has no create-time scope flag and its initial default includes `team`. Runtime rejects team channels throughout. It re-reads and verifies the final scopes before returning an installation link.
7. Imports credentials into private runtime configuration and automatically allowlists the signed-in human Object ID.

Expected output: `registered: true`, four separately named IDs, and `installLink`. No secret value is printed. Do not create another bot on subsequent days.

### Test-Only Bot Metadata Exception

If the existing Teams-managed registration reports `isSingleTenant: false` while its verified Entra app reports `AzureADMyOrg`, normal setup deliberately stops. Do not recreate the bot or change its secret. With the test owner's explicit approval, resume that same registration using:

```powershell
npm.cmd run setup -- finish --confirm --test-only-allow-bot-metadata-mismatch
```

This is a test-only exception, not proof that the bot service is single-tenant or that Teams delivery works. Setup still verifies the Entra app and bot resource IDs, tenant, signed-in user, endpoint and final personal/group scopes. It records `testOnlyBotMetadataException: true` in private configuration and displays a warning. SDK authentication, runtime tenant checks and the user allowlist remain enabled. Normal finish, recovery and endpoint updates do not silently inherit this exception. Do not use it for production without resolving the registration metadata discrepancy.

### The Four IDs Are Different Concepts

| Config name | Meaning | Used for |
| --- | --- | --- |
| `botClientId` | Entra application client ID | SDK bot authentication |
| `managementAppId` | Developer Portal management `teamsAppId` | CLI get/update, installation-link construction |
| `manifestId` | External Teams manifest ID (`appId` in Portal details) | Optional manifest ZIP `id` |
| `humanUserObjectId` | Signed-in user's tenant Object ID | Allowlist and setup identity binding |

The CLI currently initializes the external manifest ID from the bot client ID, so two values may happen to match. ARGUS still reads, verifies and stores each role separately. Never substitute the human ID, management ID, Entra application's directory Object ID, or a secret ID for the bot client ID.

### If Creation Fails or the Response Is Lost

Do not repeat create or delete the attempt marker. CLI creation is multi-step and can leave partial resources even when the local command fails. It writes the secret file only when its overall create call returns, so some failures leave **no recoverable secret value** locally.

If `.private/create-attempt.json` has known management/bot IDs and original credentials exist:

```powershell
npm.cmd run setup -- finish --confirm
```

Finish verifies the same existing registration and credentials and applies scopes if needed. It never invokes create.

If the response was lost but original credentials were saved, inspect your **own** ARGUS app in [Developer Portal](https://dev.teams.microsoft.com/), verify its bot client ID/tenant/endpoint and find its management ID. Then run, substituting the verified management ID:

```powershell
npm.cmd run setup -- recover 'VERIFIED-MANAGEMENT-APP-ID' '.private/bot.credentials.json' --confirm
```

Recover requires the existing attempt marker, same signed-in user/tenant, original credential **value**, and matching remote managed/single-tenant registration. It cannot overwrite a different existing identity or silently replace an existing secret. If metadata or credentials do not match, it stops before importing anything.

If the secret value was never saved, it cannot be recovered from a secret ID or from Entra after the one-time display. Stop. An authorized owner/admin must inspect and resolve the partial resources, and if appropriate issue a new secret for the **same verified app** using the normal browser process. Do not create an unrelated bot or erase the marker to evade duplicate protection. If the partial app/bot itself is incomplete, manual administrator repair/cleanup is required; this MVP intentionally does not guess missing resources.

## 9. Start SERVER

Before starting, configure new/rotated Gemini and Atlassian credentials in the **SERVER** PowerShell session only. The keys previously pasted into chat must be revoked and replaced; do not reuse them. These commands prompt without echoing the key values and keep credentials out of the repository and `.private/config.json`:

```powershell
$secureGemini = Read-Host "New Gemini API key" -AsSecureString
$env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new('', $secureGemini).Password
$env:GEMINI_MODEL = 'gemini-2.5-flash-lite'
$env:ATLASSIAN_MCP_EMAIL = Read-Host "Atlassian account email"
$secureAtlassian = Read-Host "New Atlassian personal API token" -AsSecureString
$env:ATLASSIAN_API_TOKEN = [System.Net.NetworkCredential]::new('', $secureAtlassian).Password
```

Gemini defaults to `gemini-2.5-flash-lite` for inexpensive testing. `GEMINI_MODEL` overrides that default for both the server and the standalone Gemini diagnostic. Changing it requires restarting the server; an older value in the launching terminal still takes precedence.

The Atlassian organization must permit API-token authentication for its [Rovo MCP server](https://support.atlassian.com/atlassian-ai-gateway/docs/configure-authentication-via-api-token/). Create a narrowly scoped token for an approved account with only the Jira read access Argus needs. This account's Jira permissions are shared by every allowlisted Argus user; do not use a broad administrator account. If an administrator disables API-token MCP auth, stop and use an approved OAuth integration rather than trying to bypass policy.

Use Atlassian's [MCP-specific personal token creation flow](https://id.atlassian.com/manage-profile/security/api-tokens?autofillToken&expiryDays=max&appId=mcp-v2&selectedScopes=all). The link preselects all scopes: use **Back** to review them and select `read:jira:agent-interface` and, for issue searches, `search:jira:agent-interface`. Choose an appropriate short expiry, record the token owner's Atlassian account email, and save the token only in an approved secret store. Do not grant write, delete or manage scopes for this read-only MVP. The organization administrator must also review **Connectors > Atlassian MCP server > Permissions > Read/Search > Edit details** and allow the required Jira permissions. Do not enable unrelated apps or automatic access to future permissions just to troubleshoot. IP allowlists and the account's Jira permissions still apply.

Before starting or restarting Teams, test MCP separately in the terminal containing the credentials:

```powershell
node .\scripts\check-atlassian-mcp.js
```

Use supported Node (or its approved full executable path). This script does not require the server or tunnel, does not acquire a process lock, and does not call Gemini or read an issue. It prints the authentication mode, initialization status, presence of site/issue tools, and the stage at which a failure occurs. It calls the read-only site-discovery tool but does not print site data, response bodies or credentials. A successful site-discovery call is not proof that an issue is readable, or that the account has any accessible Jira sites. `AUTHORIZATION_OVERRIDE` means the optional header overrides the email/token pair. `ATLASSIAN_RESOURCE_DISCOVERY_MISSING` means the server's discovered tools did not include the required site tool; inspect scopes and organization permissions rather than guessing a cloudId.

If Teams reports `ATLASSIAN_MCP_HTTP_401`, check the token owner's email, expiry and MCP token scopes. For `ATLASSIAN_MCP_HTTP_403`, ask the administrator to check MCP API-token policy, permissions and IP allowlists. `ATLASSIAN_MCP_HTTP_429` indicates rate limiting; wait before retrying. Other `HTTP_...` codes identify HTTP failures; `ATLASSIAN_MCP_RPC_...` identifies a protocol error. These codes do not contain response bodies or credentials. A token that works with the Jira REST API does not by itself prove Rovo MCP access. The optional `ATLASSIAN_MCP_AUTHORIZATION` variable overrides the email/token pair; remove it if you intend to use the pair.

Keep these environment variables in the same terminal used to start the server. They are not saved by Argus. After stopping the server, clear them from that terminal:

```powershell
Remove-Item Env:GEMINI_API_KEY, Env:GEMINI_MODEL, Env:ATLASSIAN_MCP_EMAIL, Env:ATLASSIAN_API_TOKEN -ErrorAction SilentlyContinue
```

For Gemini-only testing, omit the Atlassian values. For a service-account API key or another approved auth format, set `ATLASSIAN_MCP_AUTHORIZATION` to the documented authorization header. Never send a key through Teams, source control, screenshots, logs or an assistant conversation.

In **SERVER**, with supported Node activated:

```powershell
npm.cmd run doctor
npm.cmd start
```

Expected:

```text
ARGUS: Teams POST /api/messages on port 3978; JWT validation ON.
ARGUS: operator API http://127.0.0.1:3979 (never tunnel this port).
ARGUS: Gemini configured; Atlassian MCP configured (read-only tools only).
```

Doctor's `configurationShape: valid` means required fields have valid shapes, not that the secret has authenticated successfully. Metadata verification during setup also does not prove the secret works. Only an actual controlled message flow tests delivery end to end.

The integration status line reports whether Gemini/Atlassian credentials are configured, but does not validate or display their values. If startup reports incomplete registration, finish registration first. If a port is occupied, stop the previous authorized ARGUS instance rather than changing fixed ports/tunneling the operator. Only one backend is supported.

Optional transport/auth check in **COMMANDS**:

```powershell
curl.exe -i -X POST $endpoint -H 'Content-Type: application/json' --data '{"type":"message"}'
```

Expected: HTTP 401 because there is no Teams bearer token. This verifies tunnel reachability plus rejection of unsigned input, **not Teams delivery**. A GET may return 404 and is not an auth test. A 502 means SERVER/TUNNEL/port protocol/address is wrong. Never solve a 401 by disabling authentication.

## 10. Install Personal ARGUS and Register the Destination

1. Keep SERVER and TUNNEL running.
2. Open the generated `installLink` in the browser signed into the same test tenant. If lost, use `npm.cmd run teams -- app get 'MANAGEMENT-APP-ID' --install-link` in COMMANDS to retrieve it.
3. In the Teams app dialog, verify ARGUS, choose **Add** for personal use, then **Open**. If asked which organization, choose the registered tenant.
4. Open ARGUS's personal **Chat**. Do not send this to a self-chat or a colleague chat; it must be the installed bot conversation.
5. Send exactly:

```text
REGISTER alice
```

Expected: `ARGUS : inscription confirmée (alice).`

Alias rules: lowercase letter first, then lowercase letters/digits/underscore/hyphen, 1-32 characters. An alias belongs permanently to its original human and chat. Choose a new alias for a different destination. REGISTER with an email, URL, pasted chat ID, or uppercase alias is not accepted. Repeating your own registration is idempotent and cannot clear send uncertainty/cooldown.

If nothing happens: check running terminals, exact tenant, app installation, signed-in human Object ID and current allowlist. Wrong tenants/users/scopes are silently rejected to avoid disclosing authorization information. A personal account with the same email is not the same tenant identity.

## 11. List, Preview and Explicitly Send

In **COMMANDS**:

```powershell
npm.cmd run targets
npm.cmd run preview -- alice
```

Expected: alias `alice`, scope `personal`, active true, then the fixed French DEMO-123 message. Preview does not contact Teams or reserve/send anything. The operator tool reads the private random token itself; you never paste a token into a command or browser.

To explicitly authorize one real message to that registered chat:

```powershell
npm.cmd run send -- alice --confirm
```

Expected on confirmed success: `status: sent` and a nonempty `messageId`. Inspect Teams for:

```text
[ARGUS — SIMULATION / données fictives]
Concernant DEMO-123 (ticket fictif), pouvez-vous confirmer la dépendance réseau fictive entre le service Alpha et le service Bêta ? Aucun Jira, MCP ou LLM n’a été contacté.
```

The interface cannot accept arbitrary message text or outbound URLs. Omitting `--confirm` is an error, not an implicit send. Wait at least 30 seconds after success before another proactive message to the same chat. Another alias in that chat cannot bypass cooldown.

`sent` means Teams returned an ID, not that a human read it. If the command reports unknown or is interrupted after beginning delivery, **do not retry**. Follow section 16.

## 12. AI Replies, Conversation Memory and STOP

To isolate Gemini from Teams and Jira without restarting the server, run `& '.\.local\node-v22.23.3-win-x64\node.exe' '.\scripts\check-gemini-network.js' --generate` in the terminal containing your Gemini environment variables. This makes one real generation request with the fixed prompt "Reply with only OK." (quota/billing may apply), sends no chat history, and prints only success or a safe error code plus elapsed time. `GEMINI_CONNECT_TIMEOUT` means the connection could not be established in time; `GEMINI_TIMEOUT` means the request deadline was reached. Neither proves the key is invalid.

In the personal bot chat, send a non-sensitive test question. Argus sends the message and recent context to Gemini. If Atlassian MCP is configured, Gemini can use the read-only Jira tools to answer issue questions; otherwise it must say it cannot access Jira. Jira text is untrusted input to the model, and the model is not allowed to call Jira write tools.

If MCP discovery or a Jira read fails, Gemini can still answer general questions. Argus logs only the safe Atlassian error code and prefixes the answer with a Jira-unavailable warning. Failed Jira calls are passed to Gemini as errors, not as issue data, and further Jira tools are disabled for that turn. Gemini errors still fail explicitly. Restart SERVER after code changes, then ask a general question to test this without fixing the Jira credentials first.

For Jira reads, Argus also exposes the read-only `getAccessibleAtlassianResources` tool so Gemini can discover the site's `cloudId` before calling issue tools. Tool discovery follows paginated MCP results and reserves a slot for site discovery. Include your Jira site URL and an issue key in the question; if several sites are accessible, Argus should ask which one to use rather than guess. An `ATLASSIAN_TOOL_FAILED` warning means a tool returned an error, not necessarily an invalid token. After updating this code, restart SERVER and send `FORGET` to remove earlier failed assumptions, then ask: `On https://YOUR-SITE.atlassian.net, discover the site and read PROJECT-123.` If site discovery is still absent, check the token's MCP scopes and the tools actually offered by the server; rotating the token alone is not a verified fix.

For Gemini failures, `GEMINI_HTTP_400/403` requires checking API-key restrictions, API access and request configuration; `GEMINI_HTTP_404` can indicate an unavailable model; `GEMINI_HTTP_429` indicates quota/rate limits. `GEMINI_TIMEOUT`, `GEMINI_DNS_FAILED`, `GEMINI_TLS_FAILED`, and `GEMINI_CONNECTION_FAILED` indicate transport failures, not a proven invalid key. Do not disable TLS verification. `GEMINI_INVALID_KEY_FORMAT` means the pasted value contains internal whitespace or non-ASCII characters: re-enter the key without labels or quotes. To test connectivity without sending any credentials, run `node scripts/check-gemini-network.js` using supported Node; an HTTP error from this credential-free probe still proves that Google responded.

For `GEMINI_HTTP_404`, do not rotate a key or assume a model was retired without checking. Run `node .\scripts\check-gemini-network.js --list-models` in the terminal containing `GEMINI_API_KEY` to list generation-capable model IDs advertised by Google. Set `GEMINI_MODEL` to an exact returned ID, then run `node .\scripts\check-gemini-network.js --generate`; this prints the effective model and makes one small real generation request. Listing alone does not prove generation or tool-calling access. Restart SERVER in the same configured terminal only after the direct test passes.

Conversation turns are saved in `.private/conversation-memory.json`, separately for each Teams chat. The most recent 12 user/assistant exchanges are retained. To clear context after a decision or whenever needed, send exactly:

```text
DECISION DONE
```

`FORGET` also clears the current chat's memory. `STOP` opts out and clears memory too. This is bounded local conversation context, not a database of decisions: Argus does not infer that a decision is final or clear memory automatically. Protect the `.private` directory and backups; filesystem ACLs are not encryption.

Only test with content participants are allowed to send to Google Gemini and, when connected, Atlassian. Gemini API usage may be billed or subject to quota. Jira results can expose information available to the configured Atlassian account, so validate those account permissions before inviting colleagues. Teams itself also retains chat under organizational policies.

Send:

```text
STOP
```

Expected confirmation that the current chat is unregistered, with a warning about in-flight sends. `targets` shows active false. Preview/send for that chat is blocked. STOP disables all aliases for this chat and clears its AI memory; other chats are unaffected. It cannot cancel an HTTP request that was already in flight. A fresh legitimate REGISTER can opt the chat back in, without clearing old delivery uncertainty or cooldown.

## 13. Add One Consenting Colleague

1. Obtain explicit consent for AI processing and Jira access, and use non-sensitive test questions. Keep the colleague in the same registered tenant for this MVP; external/federated users and channels are outside scope.
2. An authorized administrator finds the colleague in **Entra ID > Users > All users > colleague > Object ID**. Use the tenant user Object ID, not their email/UPN and not the bot application ID.
3. In SERVER press Ctrl+C and wait for shutdown. In COMMANDS:

```powershell
npm.cmd run setup -- allow 'COLLEAGUE-USER-OBJECT-ID' --confirm
```

4. Restart SERVER using `npm.cmd start`. Keep the same TUNNEL and app.
5. The colleague opens the same installation link, installs ARGUS in their own personal scope, and sends `REGISTER colleague` from that bot chat.
6. You can list and preview `colleague`. Send only after agreeing with them and explicitly running `npm.cmd run send -- colleague --confirm`.

Allowlisting a user does not create a destination. They must install and register their authenticated chat. Do not derive an address from their email. To remove authorization later, stop SERVER, remove their Object ID from `allowedUserIds` using the local editor, preserve every other configuration value, restart, and ask them to STOP/uninstall where appropriate. Do not paste private config contents into assistant chat.

## 14. Repeat in an Existing Group Chat

1. Choose an existing normal Teams group chat with consenting test participants. Do not use a team/channel, meeting chat or cross-tenant chat as a substitute.
2. Install the **same** ARGUS app into that **exact** group. The personal install does not install it in the group. From the ARGUS app dialog use the dropdown beside Add / **Add to a chat**, select the existing chat and confirm. Depending on Teams version, the group header's **Apps/Add apps** UI can open the same flow.
3. Verify the group member/app UI shows ARGUS. If the target chat is not offered, stop and check the final groupChat scope, app availability and tenant policy; do not register a different conversation and assume it routes here.
4. As an allowlisted human in that group, type `@ARGUS`, **select ARGUS from the mention picker**, then add a space and `REGISTER project`.

Conceptual display:

```text
@ARGUS REGISTER project
```

The selected mention is essential. Pasting that text or an HTML `<at>` tag is not a real mention entity. Group commands **and ordinary replies** require a mention addressed to this bot.

5. Confirm registration in the group. In COMMANDS:

```powershell
npm.cmd run targets
npm.cmd run preview -- project
npm.cmd run send -- project --confirm
```

6. The fixed proactive simulation should appear in that existing group. Ask a non-sensitive question using a real selected mention: `@ARGUS What is ARG-7's status?`. The group shares its conversation memory; any member who can see the group may see the answer, and Jira access uses the configured Atlassian account. Only allowlisted users receive ordinary replies.
7. Any authenticated same-tenant group member can select the bot mention and send `STOP`, even if they are not allowlisted. This opts out the whole group, not their personal chat. A member without a usable tenant Object ID or a wrong-tenant activity is rejected.

Do not use a group alias already owned by another chat/user. Alias takeover is rejected silently. Installing or registering the app in a different group does not redirect an existing alias.

## 15. Restart and Endpoint Changes

### Normal Daily Restart

1. Stop SERVER and TUNNEL using Ctrl+C when finished.
2. Later, open/reuse the three terminals, enter the same directory and activate supported Node as in section 4.
3. In TUNNEL run `devtunnel host argus-mvp` using the same persistent ID.
4. In SERVER run `npm.cmd start`.
5. In COMMANDS run `npm.cmd run targets` and review prior send state.

Reuse the same `.private` files, app and tunnel. Do not rerun create, generate new tokens or reset the store. The addresses include authenticated regional Teams service URLs; proactive sends clone the SDK API client with each saved URL, not the app-wide default. A registered chat whose authenticated route changes is rejected for review rather than silently redirected by REGISTER.

### If the Public Tunnel Host Changes

Use persistent hosting to avoid this. If a legitimate URL change is required, keep the same app:

1. Stop SERVER. Keep/start TUNNEL with the approved new public host.
2. In COMMANDS, after reviewing the URL:

```powershell
$endpoint = 'https://YOUR-NEW-ACTUAL-HOST/api/messages'
npm.cmd run setup -- endpoint $endpoint --confirm
```

3. Expected: `endpointUpdated: true`, `createdAnotherBot: false`. The command verifies the existing app/bot identity before updating and verifies the resulting endpoint afterward.
4. Restart SERVER. If Teams prompts to update the installed app after a manifest version bump, approve that update in the intended test scope. Reopen the existing installation link if needed; do not create a new bot.

If an update response is lost, inspect the same app in Developer Portal. Repeating the **same endpoint update** targets the existing app, not create. Do not run finish while a locally stale endpoint differs from Microsoft; reconcile the intended URL with the endpoint command first.

## 16. Unknown Outcomes and Process Locks

Before contacting Teams, ARGUS atomically persists `sending`. On success with a nonempty message ID it persists `sent`. A delivery error, timeout or missing ID persists `unknown`. A crash can leave `sending`. Either unresolved state blocks all further proactive sends globally, even across restarts or another alias/chat. No automatic retry runs after an error or restart.

If a request timed out, Microsoft may still process it. STOP cannot recall it. A late success is not automatically converted to sent because ARGUS deliberately does not guess delivery after its timeout.

1. Do not retry. Run `npm.cmd run targets` and note the alias/attemptId/status.
2. Inspect the **exact** intended Teams chat and consult participants. Wait for outstanding requests to settle; when investigating a live timeout, stop SERVER, allow it to shut down, then restart so no old local request is still in flight.
3. If you conclusively verify that the fixed message arrived, record that manual conclusion in COMMANDS:

```powershell
node scripts/operator.js reconcile alice delivered 'EXACT-ATTEMPT-ID' --confirm
```

4. Only if you conclusively verify nondelivery and no outstanding send remains:

```powershell
node scripts/operator.js reconcile alice not-delivered 'EXACT-ATTEMPT-ID' --confirm
```

This is a human assertion, not a Microsoft receipt. A delivered reconciliation records `operator-verified-delivery`, not a claimed actual Teams ID, and applies a fresh cooldown. Neither reconciliation sends anything. Only a later separate confirmed send can deliver another message. If you cannot establish the outcome, **leave it unknown and do not send again**. Absence of an immediately visible message is not proof of nondelivery. Do not delete the store or re-register to bypass the guard.

### Process Lock After a Crash

One backend/setup writer is allowed. A lock also prevents setup edits while SERVER is running. The launcher runs the server directly when Node is supported; when selecting the portable runtime, it forwards shutdown over IPC instead of blocking in a synchronous child launch. Press Ctrl+C once and wait for `ARGUS: SERVER_STOPPED` and the terminal prompt before restarting. The owner also removes its own unchanged lock on normal process exit. Shutdown failures report `SERVER_SHUTDOWN_FAILED` and exit unsuccessfully; verify the server has exited before restarting. Forced termination, closing a terminal, or power loss can still leave a lock; locks are not automatically deleted based only on a PID. If `.private/process.lock` survives a crash:

1. Read only that lock file locally to identify its PID; it contains no credential. Do not display the config/credential files.
2. Use Task Manager or `Get-Process -Id PID` to determine whether that specific ARGUS process is still alive. Verify its command and purpose; do not kill arbitrary Node processes.
3. Stop the known previous instance normally if possible. If necessary, terminate it yourself only after verifying its identity. PID reuse is possible.
4. Only when you have proved no backend/setup process is running, remove just the stale lock with `Remove-Item .private/process.lock`.
5. Restart and review any `sending` attempt as unresolved. Removing a stale process lock is not permission to clear a create marker or send history.

Corrupt JSON/state causes a startup stop. Do not replace it with an empty file, rerun initialization as a reset, or discard uncertain attempts. Restore a trustworthy private backup and investigate with the operator/admin. Atomic replacement and file fsync reduce partial writes; this MVP is not a database, distributed lock or power-loss guarantee.

## 17. Credential Expiry and Safe Rotation

Secrets expire. Setup stores metadata expiry dates when Microsoft returns them; verify actual dates in Entra rather than relying on a guessed two-year lifetime. Tenant policy can shorten or disallow secrets. Doctor does not validate secret freshness or acquire a bot token.

If bot authentication starts failing, do not repeatedly send. The first proactive error becomes unknown because transport outcome is conservatively treated as ambiguous; review it as above.

For an authorized same-app rotation:

1. Stop SERVER. In a private browser open **Entra ID > App registrations**, find the app by the saved **botClientId**, and verify the intended tenant/client ID. Do not create a new registration.
2. Open **Certificates & secrets > Client secrets > New client secret**, review the allowed expiration, and create it only with authorization.
3. Microsoft displays the **Value** once. Transfer it directly into the local private files using VS Code's editor, never chat, command-line arguments, screenshots, logs or source-controlled files.
4. Replace only `botClientSecret` in `.private/config.json` and `Teams.ClientSecret` in `.private/bot.credentials.json` with that same new value. Preserve all IDs, endpoint, token, allowlist, state and attempt marker. Keep JSON syntactically valid. This deliberate local rotation is not performed by finish/recover, which intentionally refuse silent secret replacement.
5. Restart SERVER, verify controlled authenticated interaction, reconcile any previous unknown before considering a new send. Revoke the old credential only after the new one is verified through your approved process.

A secret ID is an identifier, not the secret value. Neither this tool nor an administrator can recover the old secret value from its ID. If it was lost, create a new same-app credential under the normal approved process; never invent a secret or silently switch app identity.

## 18. Optional ZIP Packaging

The installation link is the simplest path. No ZIP is needed for the main flow. If an approved workflow needs a ZIP, after successful finish run in COMMANDS:

```powershell
npm.cmd run package
```

Expected: `dist/ARGUS.zip`. It contains exactly `manifest.json`, `color.png` and `outline.png` at ZIP root. The original generated 192x192 and 32x32 icons are copied unchanged. There are no credentials, conversation addresses, backend source or dependencies inside. Tests inspect the archive and decompress the PNG pixel data.

The package uses the saved external manifest ID, **not** an assumed management ID. It has only personal/groupChat scopes and no Graph chat permissions. The example developer, website, privacy and terms URLs are placeholders. Review and replace them appropriately in the packaging source **and the managed app's Developer Portal metadata** before distribution; run required Teams manifest validation. Do not represent example.com pages as your actual privacy/legal policy.

If uploading is needed: Teams **Apps > Manage your apps > Upload an app > Upload a custom app**, choose the ZIP and select personal or the exact consenting group. Follow your tenant policy and do not publish to the organization/Teams Store as part of this MVP. Updating app configuration may require consenting to an app update; changing backend code alone does not require another bot registration.

## 19. Troubleshooting Checkpoints

| Symptom/code | Meaning and action |
| --- | --- |
| Node 20 / engine warning | Activate supported Node in that terminal; reopen terminal after installation. |
| npm.ps1 policy error | Use `npm.cmd`; do not relax execution policy. |
| CLI native install/storage failure | Fix supported native prerequisites normally; runtime/tests remain independent. No skipped scripts/plaintext/TLS bypass. |
| Login works, Portal/Graph consent missing | Login used no resource scopes. Run approved explicit consent, or contact tenant admin. |
| `UPLOAD_PERMISSION_REQUIRED...` | Tenant/user upload flag disabled or unknown; ask Teams admin to inspect assigned policy and propagation. |
| `SIGNED_IN_TENANT_MISMATCH` / user mismatch | Log in as the original authorized setup user/tenant. Do not overwrite saved identity. |
| `CREATE_ALREADY_ATTEMPTED...` | A cloud attempt exists. Inspect same resources; use finish or verified recover, never blind create. |
| `REMOTE_IDENTITY_OR_ENDPOINT_MISMATCH_STOP` | Same IDs, audience, tenant, managed registration and endpoint could not be verified. Inspect Portal/Entra, don't substitute IDs. |
| `EXISTING_IDENTITY_OR_SECRET_PRESERVED` | Import would overwrite identity/credential. Investigate; use deliberate same-app rotation only if authorized. |
| Tunnel 502 | Start SERVER, verify only 3978 with local protocol HTTP, verify real public forwarding URL. |
| Unsigned POST gives 401 | Correct. It must never register a chat or invoke bot behavior. |
| Teams install fails | Correct tenant/license, app not blocked, custom upload allowed, final scopes verified, public endpoint running. |
| No group response | Ensure exact group install and select bot from real mention picker; verify user allowlist. |
| `TARGET_NOT_FOUND` | Register from installed authenticated bot chat first; never paste a conversation ID into operator inputs. |
| `TARGET_STOPPED` | Chat opted out; don't send. A permitted owner may REGISTER again with consent. |
| `COOLDOWN_30_SECONDS` | Wait after last successful send or delivered reconciliation. |
| `DELIVERY_UNKNOWN...` / unresolved | Do not retry. Review exact chat and attempt; reconcile only a conclusive outcome. |
| `PROCESS_LOCK_EXISTS...` | Stop other backend/setup process, or verify stale lock carefully as above. |
| `CORRUPT_STATE...` | Fail closed. Preserve files, investigate and restore trusted backup; never reset uncertain history. |

Errors are deliberately sanitized. Do not enable full HTTP/token/body logging to troubleshoot. Local readiness can prove configuration shape; setup can verify metadata/access; only an authorized live personal/group workflow can prove Microsoft delivery.

## 20. Cleanup

All cloud deletion/permission changes are deliberate user/admin actions, not automated here:

1. Send STOP in each personal chat and a real mentioned STOP in each group, while SERVER/TUNNEL are still up. Review any in-flight/unknown attempts.
2. Uninstall ARGUS from each exact chat/app scope. In Teams use app/chat management and **Remove**. Removing the personal app does not necessarily erase its old chat history.
3. Stop SERVER and TUNNEL with Ctrl+C.
4. If permanently finished, run `devtunnel delete argus-mvp` yourself, verifying the tunnel ID. Do not use delete-all.
5. In Developer Portal inspect and delete only the verified ARGUS management app and managed bot if no longer needed. In Entra inspect the saved botClientId and remove only that test app/credentials after confirming nothing else depends on them. Portal app deletion alone may not remove all associated identities; inspect the remaining resources.
6. Ask the administrator to review/revoke CLI delegated consent if it is no longer needed and is not used by other authorized tools/users. Do not remove broad organizational permissions casually.
7. Run `npm.cmd run teams -- logout` and `devtunnel user logout` to clear the tools' cached sign-ins where appropriate. Browser cookies/sign-ins may remain; manage those normally in the browser.
8. Retain needed private attempt records only under your approved test-data retention policy, then securely remove private files/backups and generated ZIPs. Never publish private state as a debugging artifact.
9. For any trial/subscription you chose separately, review recurring billing and cancel through the official Microsoft billing interface if desired. Stopping this bot does not cancel a subscription.

## 21. What Has and Has Not Been Verified Here

The implementation was exercised with offline synthetic tests, fake CLI responses and real local HTTP receivers. The actual SDK server rejected unsigned activities with the unsafe environment flag enabled. Dependencies, CLI help/version and native Windows secure storage were checked locally.

No human Microsoft login, consent, tenant policy change, cloud bot registration, tunnel creation or real Teams send was executed by the assistant. Your first real delivery checks are sections 10-14, after your approved account/permission prerequisites are satisfied. Do not mistake passing offline tests or a valid doctor report for a tenant integration test.