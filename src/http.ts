export const TIMEOUT_MS = 60_000;

export function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
