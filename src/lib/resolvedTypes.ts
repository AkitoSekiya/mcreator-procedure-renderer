/**
 * Intermediate, structurally-resolved form produced by normalizeInput.ts.
 *
 * By the time a ResolvedNode exists, all *graph* concerns are already
 * settled: node_id string references have been followed to their target
 * (or reported as E008/E009/W006), `next`-chains are real object links, and
 * statement_inputs values are always arrays. What's NOT yet checked is
 * anything that requires blocks_full.json's block-level semantics beyond
 * shape (does block_id exist at all, are these the right input/field names,
 * do types match) — that's validate.ts's job.
 */

export interface ResolvedNode {
  nodeId: string;
  blockId: string;
  /** Passed through as-is; validate.ts still does all field name/value
   * validation (E005, W002, checkbox/dropdown normalization). */
  fieldsRaw: Record<string, unknown>;
  valueInputs: Record<string, ResolvedNode>;
  statementInputs: Record<string, ResolvedNode[]>;
  /** Resolved `next` pointer; null if absent or if following it would have
   * created a cycle (E009 already recorded when that happens). */
  next: ResolvedNode | null;

  /** Raw `type` metadata key, if it was a string (SPEC v1.2 rule 8). */
  rawType: string | undefined;
  /** Raw `parent`/`previous`/`children` metadata keys, passed through
   * unexamined — validate.ts compares them against the *Ids below. */
  rawParent: unknown;
  rawPrevious: unknown;
  rawChildren: unknown;

  /** The node_id that "owns" this node via a winning value_inputs/
   * statement_inputs edge (not `next`), if any. */
  actualParentId: string | undefined;
  /** The node_id whose winning `next` edge points at this node, if any. */
  actualPreviousId: string | undefined;
  /** node_ids this node owns via its own value_inputs/statement_inputs
   * winning edges (not `next`), sorted for stable comparison. */
  actualChildrenIds: string[];
}

export interface ResolvedTrigger {
  /** The trigger name (string form), or null if there is none. */
  name: string | null;
  /** Dependency *names* (the part before ':') the trigger is declared to
   * provide (SPEC v1.2 rule 2's object form). Empty for string/null triggers. */
  providedDeps: Set<string>;
}

/**
 * Which input-format mode normalizeInput detected for this document
 * (SPEC.md v1.2 mode-detection rule, added for v1 backward compatibility):
 *
 * - 'graph': at least one node_id string reference exists anywhere in
 *   value_inputs/statement_inputs/next. Connections are only ever explicit;
 *   blocks-array order carries no meaning. Multiple unreferenced
 *   statement/hat roots become independent stacks (W004 on the extras).
 * - 'legacy': zero node_id string references anywhere — a pure v1-style
 *   nested document. blocks-array order *is* the main sequence (v1's public
 *   contract), so every unreferenced root is auto-chained, in array order,
 *   into a single main stack. No W004 in this mode.
 *
 * Purely informational (debugging aid) — not surfaced in the UI.
 */
export type InputMode = 'graph' | 'legacy';

export interface ResolvedDoc {
  procedureName: string;
  mcreatorVersion: string | undefined;
  trigger: ResolvedTrigger;
  /**
   * Independent statement stacks after root auto-classification (SPEC v1.2
   * rule 5). In 'graph' mode, stacks[0] is the main sequence (blocks-array
   * order) and stacks[1..] are extra disconnected stacks (each warrants a
   * W004 from normalizeInput). In 'legacy' mode there is always at most one
   * stack — every unreferenced root got auto-chained into it.
   */
  stacks: ResolvedNode[][];
  /** Which mode normalizeInput detected for this document (see InputMode). */
  mode: InputMode;
}
