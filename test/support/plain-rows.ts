// node:sqlite returns rows as null-prototype objects, which fails
// assert/strict's deepEqual against plain object literals even when the
// data matches. Strip the prototype for comparison.
export function plainRows<T>(rows: unknown[]): T[] {
  return rows.map((row) => ({ ...row })) as T[];
}
