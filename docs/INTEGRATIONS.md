# Optional Jira and GitLab MCP

Configure only approved accounts. Both providers are optional; omit their variables for Gemini-only chat. A provider's discovery/read failure is reported explicitly but does not disable the other provider or general Gemini chat.

Keys are read from the launching terminal, not an automatically loaded `.env`. The [session template](../config.example.ps1) can be copied into ignored `.private\session.ps1`: change its enable switches and dot-source it in SERVER. It prompts for secrets on each use. Do not write actual secrets into the tracked template.

## Configuration

| Variable | Meaning |
| --- | --- |
| `GEMINI_API_KEY` | Gemini key, required for AI replies |
| `GEMINI_MODEL` | Exact available model ID; verify standalone generation before Teams |
| `ATLASSIAN_MCP_EMAIL` | Owner email for an Atlassian personal token |
| `ATLASSIAN_API_TOKEN` | MCP-scoped personal token |
| `ATLASSIAN_MCP_AUTHORIZATION` | Optional full auth header, overriding the email/token pair |
| `GITLAB_MCP_URL` | Approved official HTTPS MCP endpoint, e.g. `https://gitlab.com/api/v4/mcp` or your self-managed instance |
| `GITLAB_MCP_ACCESS_TOKEN` | Supported GitLab MCP token, sent as a Bearer header |

GitLab is disabled when both GitLab values are absent. Configuring only one value or a malformed/insecure URL fails startup explicitly. No token is put in a URL and credential-bearing redirects are refused. Verify the host before entering credentials: Argus sends the configured GitLab token to that host. Self-managed instance version and policy determine availability; a URL alone does not establish support.

## Atlassian Jira

1. Sign into the Atlassian account that can open the intended site and test issue.
2. An organization administrator reviews **Connectors > Atlassian MCP server > Authentication > API token**, then the separate **Permissions** tab for Jira **Read/Search**. IP restrictions and normal issue permissions still apply.
3. Use the [MCP token creation flow](https://id.atlassian.com/manage-profile/security/api-tokens?autofillToken&expiryDays=max&appId=mcp-v2&selectedScopes=all). It preselects all scopes/maximum expiry: use Back to review and choose a short appropriate expiry and `read:jira:agent-interface`, plus `search:jira:agent-interface` for search. Do not grant write/delete/manage for this MVP.
4. Enter locally:

```powershell
Remove-Item Env:ATLASSIAN_MCP_AUTHORIZATION -ErrorAction SilentlyContinue
$env:ATLASSIAN_MCP_EMAIL = (Read-Host 'Atlassian email').Trim()
$secure = Read-Host 'Atlassian MCP token' -AsSecureString
$env:ATLASSIAN_API_TOKEN = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
Remove-Variable secure
npm.cmd run check:jira
```

The diagnostic initializes MCP, discovers tools and calls read-only site discovery without printing site data. It does not read an issue. `getAccessibleAtlassianResources` discovers `cloudId`; include your Jira site URL and issue key in the Teams question so the model can select the right site.

`401` does not uniquely identify a bad token; review email, expiry, scopes and policy. `403` can involve policy, permissions or IP restrictions. `ATLASSIAN_TOOL_FAILED` means a tool returned an error, not necessarily invalid authentication. Do not infer current issue facts from earlier conversation when reads fail.

OAuth 2.1 is Atlassian's recommended per-user interactive path; personal tokens are permitted for approved backend/bot usage. Argus supports configured headers, not an OAuth login/refresh lifecycle. VS Code's MCP login does not authenticate Argus automatically.

Sources: [authentication](https://support.atlassian.com/atlassian-ai-gateway/docs/configure-authentication-via-api-token/), [tools/scopes and flat endpoint](https://support.atlassian.com/atlassian-ai-gateway/docs/supported-tools/), [permissions](https://support.atlassian.com/security-and-access-policies/docs/configure-atlassian-mcp-server-permissions/).

## GitLab (can be filled in later)

GitLab defaults to **off**. Do not use an unapproved third-party MCP server or treat a REST token as proof of MCP authentication.

1. Ask the GitLab administrator whether the installed version supports the [official MCP server](https://docs.gitlab.com/user/model_context_protocol/mcp_server/).
2. Confirm access is enabled for the top-level group on GitLab.com, or for the instance on Self-Managed/Dedicated. Requirements changed across releases; use documentation matching the installed version.
3. Obtain a supported token through an approved process:
   - OAuth access token with `mcp` scope, obtained through a supported authorization flow. Argus does not currently implement that login or automatic refresh.
   - Where supported, a **fine-grained personal access token** with the **MCP tool** resource and **Execute** permission, plus the resource permissions required by the chosen read tools. Restrict its accessible groups/projects and expiry.
   - **Legacy PATs, project access tokens and group access tokens are not accepted by the currently documented official MCP endpoint**, even with `api` scope. Do not broaden one to try to make it work.
4. For fine-grained tokens, the current UI path is avatar > **Edit profile > Access > Personal access tokens > Generate token > Fine-grained token**. Select only necessary resource boundaries/permissions; follow your instance's actual UI and [token documentation](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens/). If MCP permission is not available, stop and check version/support with the administrator.
5. Enter the URL and token in the same SERVER terminal:

```powershell
$env:GITLAB_MCP_URL = (Read-Host 'Approved GitLab MCP HTTPS URL').Trim()
$secure = Read-Host 'GitLab MCP access token' -AsSecureString
$env:GITLAB_MCP_ACCESS_TOKEN = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
Remove-Variable secure
npm.cmd run check:gitlab
```

The diagnostic lists allowed read tools only. No project, issue or merge request is read or changed. Success is discovery, not proof of data access.

6. Restart SERVER, then ask a narrow question with an exact project path or URL:
   - "Get the project metadata for group/project on our configured GitLab instance."
   - "Read issue #12 in group/project."
   - "Summarize merge request !34 in group/project with its source link."

Argus allows only discovered `get_project`, `get_issue` (older instances), `get_work_item`, `get_merge_request`, `list_merge_requests`, and `search`. Actual availability depends on the instance. Gemini sees these with the `gitlab_` prefix to avoid Jira collisions. Unknown tools, generic execution tools, writes, commits, pipeline runs and Duo session launches are not exposed. This is a deliberately small MVP, not the entire GitLab MCP catalog.

Safe failures use `GITLAB_MCP_HTTP_<status>`, `GITLAB_TOOL_FAILED`, `GITLAB_NO_READ_TOOLS`, or protocol/network categories. Check expired tokens, enabled MCP access and permissions before changing anything. To disable GitLab:

```powershell
Remove-Item Env:GITLAB_MCP_URL, Env:GITLAB_MCP_ACCESS_TOKEN -ErrorAction SilentlyContinue
```

Restart SERVER after configuration changes. Do not automatically switch to a different host/provider on failure.

## Data and readiness boundaries

- The configured Atlassian/GitLab identities are shared with all allowlisted Argus users, not impersonations of each Teams user. Approve the audience and use narrow accounts/tokens.
- Tool output is untrusted. The model must not follow instructions embedded in issues/MRs.
- Tool results and recent chat context go to Gemini. Memory may persist summaries locally; filesystem permissions are not encryption. Group participants can see group replies.
- No Jira/GitLab writes or event-driven proactive automation are implemented. Existing proactive delivery remains an explicitly confirmed synthetic test.
- MCP transport supports bounded JSON/SSE responses, pagination, session/protocol headers and timeouts. Session expiry/OAuth refresh is not automatically recovered; restart after approved credential renewal. It is a small custom client, not full MCP feature coverage.
- Offline tests do not prove live authentication, correct citations or model decisions. Verify each provider with approved synthetic data.
