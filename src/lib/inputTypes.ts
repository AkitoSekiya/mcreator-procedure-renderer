/**
 * Types for the "MCreator procedure structured JSON" input format described
 * in SPEC.md §3 (v1.2). These describe the *raw*, not-yet-normalized input as
 * parsed from user-supplied JSON — either the original nested-object form or
 * the newer flat graph form (node_id string references), or a mix of both.
 * See src/lib/normalizeInput.ts for the code that reconciles both shapes into
 * a single internal representation.
 */

/** Raw BlockNode as it may appear in user input (before normalization). In
 * the flat graph form, `value_inputs`/`statement_inputs`/`next` values may be
 * node_id strings instead of nested objects — see normalizeInput.ts. */
export interface RawBlockNode {
  node_id?: unknown;
  block_id?: unknown;
  fields?: unknown;
  value_inputs?: unknown;
  statement_inputs?: unknown;
  next?: unknown;
  // Accepted metadata keys (SPEC §3, v1.2 rule 8): type, parent, previous,
  // children. Silently accepted; only flagged (W007) when they contradict
  // the resolved graph.
  type?: unknown;
  parent?: unknown;
  previous?: unknown;
  children?: unknown;
  [key: string]: unknown;
}

/** Raw top-level procedure document as parsed from JSON.parse. `trigger` may
 * be a string, null, or (v1.2) an object `{type, dependencies?}`. */
export interface RawProcedureDoc {
  format_version?: unknown;
  mcreator_version?: unknown;
  procedure_name?: unknown;
  description?: unknown;
  trigger?: unknown;
  blocks?: unknown;
  [key: string]: unknown;
}

/** All keys a BlockNode is ever expected to carry. Anything else is a truly
 * unknown key, aggregated into a single document-wide I001 (SPEC §3 v1.2
 * rule 8) rather than one message per node. */
export const KNOWN_NODE_KEYS = new Set([
  'node_id',
  'block_id',
  'fields',
  'value_inputs',
  'statement_inputs',
  'next',
  'type',
  'parent',
  'previous',
  'children',
]);

/** Metadata keys accepted but never load-bearing on their own — only
 * flagged (W007) if they contradict the resolved graph (SPEC §3 v1.2 rule 8). */
export const METADATA_NODE_KEYS = ['type', 'parent', 'previous', 'children'] as const;
