// Minimal shape of Renovate's `--report-type=file` output, as produced by
// the `renovate` CLI. Only the fields RenovateTool actually reads.

export interface RenovateReportDepUpdate {
  updateType: string;
  newVersion?: string;
  newValue: string;
}

export interface RenovateReportDep {
  depName: string;
  depType: string;
  datasource: string;
  currentValue: string;
  currentVersion?: string;
  sourceUrl?: string;
  updates: RenovateReportDepUpdate[];
}

export interface RenovateReportPackageFile {
  packageFile: string;
  deps: RenovateReportDep[];
}

export interface RenovateReport {
  repositories: Record<string, { packageFiles: Record<string, RenovateReportPackageFile[]> }>;
}
