// Minimal shape of a CycloneDX SBOM document, as produced by `npm sbom`.
// Only the fields SbomTool actually reads.

export interface CycloneDxComponent {
  "bom-ref": string;
  name: string;
  version: string;
}

export interface CycloneDxDocument {
  metadata: { component: { "bom-ref": string } };
  components: CycloneDxComponent[];
  dependencies: { ref: string; dependsOn: string[] }[];
}
