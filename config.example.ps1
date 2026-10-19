# Copy to .private\session.ps1 after setup init, edit the switches, then dot-source it.
$enableAtlassian = $false
$enableGitLab = $false

function Read-ArgusSecret([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    return [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
}

$env:GEMINI_API_KEY = Read-ArgusSecret 'Gemini API key'
$env:GEMINI_MODEL = (Read-Host 'Gemini model ID (verify using check:gemini -- --list-models)').Trim()
if (-not $env:GEMINI_MODEL) { throw 'A Gemini model ID is required; do not guess model availability.' }

Remove-Item Env:ATLASSIAN_MCP_AUTHORIZATION, Env:ATLASSIAN_MCP_EMAIL, Env:ATLASSIAN_API_TOKEN,
    Env:GITLAB_MCP_URL, Env:GITLAB_MCP_ACCESS_TOKEN -ErrorAction SilentlyContinue

if ($enableAtlassian) {
    $env:ATLASSIAN_MCP_EMAIL = (Read-Host 'Atlassian token owner email').Trim()
    $env:ATLASSIAN_API_TOKEN = Read-ArgusSecret 'Atlassian MCP personal API token'
}
if ($enableGitLab) {
    $env:GITLAB_MCP_URL = (Read-Host 'Approved GitLab MCP HTTPS URL, ending in /api/v4/mcp').Trim()
    $env:GITLAB_MCP_ACCESS_TOKEN = Read-ArgusSecret 'GitLab MCP access token (not a legacy PAT)'
}
Remove-Item Function:Read-ArgusSecret
