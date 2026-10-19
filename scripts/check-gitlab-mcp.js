import { pathToFileURL } from 'node:url';
import { GitLabMcpClient, gitlabSettings } from '../src/gitlab.js';
import { requireThat, safeCode } from '../src/foundation.js';

export async function checkGitLabMcp(client, log = console.log) {
  log('GITLAB_STAGE: INITIALIZE');
  await client.initialize();
  log('GITLAB_INITIALIZE: OK');
  log('GITLAB_STAGE: TOOLS_LIST');
  const tools = await client.tools();
  log(`GITLAB_READ_TOOL_COUNT: ${tools.length}`);
  for (const tool of tools) log(`GITLAB_TOOL: ${tool.name}`);
  log('GITLAB_DISCOVERY: OK (project/issue/MR reads not yet tested)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const settings = gitlabSettings();
    requireThat(settings, 'GITLAB_CREDENTIALS_NOT_CONFIGURED');
    await checkGitLabMcp(new GitLabMcpClient(settings));
  } catch (error) {
    console.error(`GITLAB_FAIL: ${safeCode(error)}`);
    process.exitCode = 1;
  }
}
