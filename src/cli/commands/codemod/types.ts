export interface CodemodOptions {
  path: string;
  group: string;
}

export interface PackageCodemod {
  name: string;
  from: string;
  to: string;
  callSites: number;
  remote: string | null;
  codemodDir: string | null;
  hasCodemod: boolean;
  error?: string;
}

export interface CodemodCommandResult {
  repo: string;
  packages: PackageCodemod[];
}
