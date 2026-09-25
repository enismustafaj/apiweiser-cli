export interface Dependency {
  id?: number;
  name: string;
  currentVersion: string;
  type: "direct" | "transitive";
  isDevDependency: boolean;
}

export interface CallSite {
  dependency: string;
  file: string;
  line: number;
  snippet: string;
  apiSurface: string;
}
