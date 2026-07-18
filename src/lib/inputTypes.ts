/**
 * Types for the "MCreator procedure structured JSON" input format described
 * in SPEC.md §3. These describe the *raw*, not-yet-validated input as parsed
 * from user-supplied JSON (hence liberal use of `unknown`/optional fields —
 * validation is what narrows this into a NormalizedProcedure).
 */

/** Raw BlockNode as it may appear in user input (before validation/normalization). */
export interface RawBlockNode {
  node_id?: unknown;
  block_id?: unknown;
  fields?: unknown;
  value_inputs?: unknown;
  statement_inputs?: unknown;
  next?: unknown;
  // Accepted-but-ignored keys (SPEC §3): type, parent, previous, children.
  [key: string]: unknown;
}

/** Raw top-level procedure document as parsed from JSON.parse. */
export interface RawProcedureDoc {
  format_version?: unknown;
  mcreator_version?: unknown;
  procedure_name?: unknown;
  description?: unknown;
  trigger?: unknown;
  blocks?: unknown;
  [key: string]: unknown;
}

/** Keys that are accepted on a BlockNode but always ignored (SPEC §3, I001). */
export const IGNORED_NODE_KEYS = ['type', 'parent', 'previous', 'children'] as const;
