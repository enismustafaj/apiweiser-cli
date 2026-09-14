// `http.extraHeader`, GitHub's documented way to use a PAT over HTTPS git.
// Passed via GIT_CONFIG_KEY_0/VALUE_0 rather than `-c` on the command
// line - argv is visible to other processes via `ps`, env vars aren't. A
// no-op over SSH - git only applies http.extraHeader to HTTP(S) transport.
export function gitAuthEnv(token: string): NodeJS.ProcessEnv {
  const encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${encoded}`,
  };
}
