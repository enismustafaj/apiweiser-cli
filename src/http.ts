// Every direct fetch() call in this codebase goes through here instead of
// calling fetch() directly. Found the hard way, reproduced in isolation:
// a real OpenRouter summarization call once sat open with zero response
// and zero CPU activity indefinitely, after several earlier calls in the
// same run had already been getting progressively slower (10s, 17s, 26s,
// 29s) - fetch() has no default timeout, so a non-responding endpoint
// blocks the entire pipeline forever instead of failing like any other
// error. TIMEOUT_MS is set above the slowest real successful call seen
// (29s) with real headroom, not just above what looked reasonable.
export const TIMEOUT_MS = 60_000;

// timeoutMs is a parameter (defaulting to TIMEOUT_MS), not a closed-over
// constant, so tests can exercise a real abort without waiting out the
// real production timeout.
export function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
