export interface Vulnerability {
  id: string;
  summary: string | null;
  // GitHub's rating (LOW, MODERATE, HIGH, CRITICAL), when the advisory has one.
  severity: string | null;
  // The lowest version above the installed one that fixes it; null when
  // nothing does yet.
  fixedIn: string | null;
}

export interface PackageVersion {
  name: string;
  version: string;
}

// The fields OsvClient reads from POST /v1/querybatch.
export interface OsvBatchResponse {
  results: { vulns?: { id: string }[] }[];
}

// The fields OsvClient reads from GET /v1/vulns/{id}.
export interface OsvAdvisory {
  id: string;
  summary?: string;
  database_specific?: { severity?: string };
  affected?: {
    package?: { name: string; ecosystem: string };
    ranges?: { type: string; events: { introduced?: string; fixed?: string }[] }[];
  }[];
}
