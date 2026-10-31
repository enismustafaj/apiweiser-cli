export interface ScanOptions {
  path: string;
}

export interface ScannedCallSite {
  api: string;
  file: string;
  line: number;
}

export interface ScannedPackage {
  name: string;
  version: string;
  dev: boolean;
  callSites: ScannedCallSite[];
}

export interface ScanResult {
  repo: string;
  packages: ScannedPackage[];
}
