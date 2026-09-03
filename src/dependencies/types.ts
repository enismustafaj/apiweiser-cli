export interface Dependency {
  name: string;
  currentVersion: string;
  type: "direct" | "transitive";
}

export interface CallSite {
  dependency: string;
  file: string;
  line: number;
  snippet: string;
  apiSurface: string;
}
