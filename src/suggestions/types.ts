// Shared types for the suggestions module.

export interface RenovateUpdate {
  dependency: string;
  packageFile: string;
  depType: string;
  currentVersion: string;
  newVersion: string;
  updateType: string;
  datasource: string;
  sourceUrl?: string;
}
