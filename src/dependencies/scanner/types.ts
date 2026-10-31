import type { Node } from "ts-morph";

// One place the code uses something - a call, a JSX element, a class
// heritage or a type reference - before it's known which package owns it.
export interface Usage {
  nameNode: Node;
  node: Node;
  apiSurface: () => string;
}
