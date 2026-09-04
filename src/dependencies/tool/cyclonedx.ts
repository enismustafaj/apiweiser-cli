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
