# Run Argus on your own Windows PC

This is a local, single-process development bot, not a production deployment. Each developer uses their own approved Teams registration, tunnel and credentials. Never copy another developer's `.private` directory, Microsoft token cache or provider keys.

## 1. Check permissions before creating anything

| Check | How to verify | If blocked |
| --- | --- | --- |
| Work/school Teams account and license | Sign in at [Teams](https://teams.microsoft.com) and open chat in the intended organization | Ask the Microsoft 365 administrator; a personal Microsoft account or Entra directory alone is not enough |
| Install custom Teams apps | Teams > Apps > Manage your apps > Upload an app (UI varies); administrator checks assigned custom-app policies | Ask for permission restricted to the consenting test users |
| Create/manage the bot identity | Ask the Entra/Teams administrator; login alone does not establish this right | Obtain administrator-assisted provisioning; do not bypass policies |
| Provisioning consent | This pinned CLI requires delegated Graph `Application.ReadWrite.All` and Developer Portal `AppDefinitions.ReadWrite` | Have an administrator review these substantial provisioning scopes; they are not runtime chat permissions |
| Development tools and tunnel | Company permits Node, npm dependencies, native CLI secure storage, Dev Tunnels and public HTTPS webhook | Use an approved environment; do not disable security controls |
| External AI and integrations | Company permits test content to be sent to Gemini and optional Jira/GitLab tools | Use synthetic data or keep external integrations disabled |

Use a commercial-cloud tenant. No Copilot Studio license is required by this implementation. The Teams-managed registration path does not require manually creating an Azure Bot resource, but it still requires tenant approval and does not provide hosting.

**Administrator request:** "Please approve a local Argus Teams bot for consenting test users: work/school Teams access, custom-app upload/install/use, creation and management of a single-tenant Teams-managed bot/app, the pinned CLI's provisioning scopes above, and an approved HTTPS Dev Tunnel forwarding only port 3978. Runtime validates bot JWTs and restricts tenant and user IDs. No Graph chat read/send permissions are requested. Test messages and tool results may be sent to Gemini. If self-service provisioning is not permitted, please arrange an approved administrator-assisted workflow."

If cloud permissions are unavailable, complete step 2 and run offline tests. Do not keep trying app creation or copy someone else's bot secret. This project does not have a generic import wizard for arbitrary administrator-created registrations: coordinate the supported workflow in the [full guide](BEGINNER.md#2-understand-provisioning-consent-versus-bot-permissions).

## 2. Get and test the source

Install an approved supported Node LTS (>=22.12), Git and VS Code. Reopen terminals after installation. Windows setup is native Windows, not WSL. Use `npm.cmd` in PowerShell; do not change execution policy.

After the repository is published, clone its actual URL:

```powershell
git clone https://github.com/YOUR-OWNER/argus.git
Set-Location .\argus
node --version
npm.cmd ci
npm.cmd test
npm.cmd run setup -- init
npm.cmd run doctor
```

No login or real API calls are needed for the tests. Doctor initially reports incomplete configuration; this is expected. `.local` and `node_modules` are not distributed. Store the workspace outside shared/cloud-synced folders and use disk encryption.

## 3. Approve and register Teams once

```powershell
npm.cmd run tools:install
npm.cmd run teams -- login
npm.cmd run setup -- consent --confirm
npm.cmd run setup -- preflight
```

Only approve scopes after review. **Need admin approval**, a failed preflight, or a native secure-storage failure is a stop condition, not a reason to disable policy or use a plaintext cache. Preflight checks known consent/upload settings; it cannot guarantee every organization policy permits provisioning.

Install [Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started) with approval. In a separate **TUNNEL** terminal:

```powershell
devtunnel user login
devtunnel create YOUR-UNIQUE-ARGUS-ID --allow-anonymous
devtunnel port create YOUR-ACTUAL-TUNNEL-ID -p 3978 --protocol http
devtunnel host YOUR-ACTUAL-TUNNEL-ID
```

Use the actual ID returned by create, including a region suffix if present. Keep hosting. Create the tunnel/port only once; subsequent sessions only host the same ID. Anonymous tunnel access lets the bot service reach the webhook; Argus still requires signed activities. **Never forward port 3979.** If login expires, sign in normally and host the same tunnel again. If `devtunnel` is not found, reopen the terminal or use its approved installed executable path.

In **COMMANDS**, use the actual forwarding URL printed by the tunnel:

```powershell
$endpoint = 'https://YOUR-ACTUAL-FORWARDING-HOST/api/messages'
npm.cmd run setup -- preview $endpoint
npm.cmd run setup -- create $endpoint --confirm
```

This creates cloud resources. Successful setup returns `registered: true` and an `installLink`, saves private credentials and allowlists the signed-in user. A temporary 502 is expected until SERVER starts. If create fails or its response is lost, **do not repeat create**: follow [finish/recovery](BEGINNER.md#8-preview-and-create-the-bot-once). Never delete the attempt marker to retry.

## 4. Configure Gemini in SERVER

Open a **SERVER** PowerShell terminal in the project root. Copy the non-secret template after initialization:

```powershell
Copy-Item .\config.example.ps1 .\.private\session.ps1
. .\.private\session.ps1
npm.cmd run check:gemini -- --list-models
npm.cmd run check:gemini -- --generate
```

The script prompts for a key without echoing it and for a model ID. It does not save entered keys. Use an exact available text/function-calling model ID, not an image/audio-only model. If unsure of the ID, list models after entering the key, then set `$env:GEMINI_MODEL = 'EXACT-VERIFIED-ID'` and rerun generation. A listed model is not proof of generation or tool support. Model availability/pricing changes; no particular cheap model is guaranteed. The current code default is a convenience, not an availability guarantee.

If a test returns 404, verify the model ID and API availability. For 503, check service status and retry later with bounded backoff, not a new key. Never paste keys into Teams, chat, source or screenshots. Obtain Gemini keys through [Google AI Studio](https://aistudio.google.com/api-keys), with organizational approval; billing and data-use terms apply.

## 5. Start and test in order

```powershell
npm.cmd start
```

Keep **SERVER** and **TUNNEL** running, one instance of each. In **COMMANDS**:

```powershell
curl.exe -i --max-time 15 -X POST $endpoint -H 'Content-Type: application/json' --data '{}'
```

Expected **401**: connectivity plus rejection of unsigned input, not proof of Teams delivery. Timeout means a network/tunnel issue; 502 usually means forwarding/backend unavailable. Do not disable authentication.

1. Open `installLink`, install Argus for personal use in the intended tenant, and open its bot chat.
2. Send `REGISTER alice`. Expect registration confirmation, even without working AI.
3. Ask a synthetic general question. Expect a Gemini answer.
4. Say "Remember the test color is Blue", then ask the color. Send `FORGET`, then check that Argus no longer has that context.
5. `DECISION DONE` also clears memory. `STOP` opts out of proactive sends and clears current memory; it does not cancel an in-flight request.
6. Add optional integrations only after these checks pass. Use [the integration guide](INTEGRATIONS.md).

Do not test in a group until personal chat works. Group installation must be in the exact chat; commands/replies require a real selected bot mention. Group memory and replies are shared.

## 6. Daily use and restart

- TUNNEL: `devtunnel host YOUR-ACTUAL-TUNNEL-ID`; renew human login if requested.
- SERVER: dot-source `. .\.private\session.ps1`, then `npm.cmd start`.
- Commands in different terminals do not share process environment variables.
- To restart SERVER, press Ctrl+C once; wait for `ARGUS: SERVER_STOPPED` and the prompt before starting again. Leave the tunnel running.
- A forced stop can leave a lock. Follow the [safe recovery procedure](BEGINNER.md#16-unknown-outcomes-and-process-locks); never delete a live owner's lock or conversation/delivery state.
- Moving the folder while a server or CLI operation is running is unsupported. Stop them, move the whole private local workspace without publishing private files, reopen VS Code in the new path and re-enter session credentials.

For explicitly confirmed synthetic proactive tests, endpoint updates, adding colleagues and cleanup, use the [complete guide](BEGINNER.md). Production needs stable HTTPS hosting, managed secrets and durable transactional storage; this local MVP is not multi-instance.
