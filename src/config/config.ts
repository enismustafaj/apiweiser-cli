export interface LlmConfig {
  apiKey: string;
  url: string;
  model: string;
}

// Which coding agent CLI CodingAgentService shells out to (see
// docs/change-requests.md). `args` are whatever flags put that CLI into
// non-interactive/headless mode (e.g. Claude Code's `-p`, Codex's `exec`)
// - the prompt itself is appended as the final argument.
export interface CodingAgentConfig {
  command: string;
  args: string[];
}

// A PAT with repo/pull-request write access - PullRequestService uses it to
// call the GitHub REST API directly (see docs/github.md). Pushing the
// branch itself goes through the local `git` CLI, which is assumed to
// already have push access configured (same assumption RenovateTool/
// SbomTool make about `npm`/`git` being usable on PATH).
export interface GithubConfig {
  token: string;
}

export interface AppConfig {
  llm: LlmConfig;
  codingAgent: CodingAgentConfig;
  github: GithubConfig;
}
