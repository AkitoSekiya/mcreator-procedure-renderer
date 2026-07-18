import type { InputMode } from './resolvedTypes';

/** The validated + normalized form of a procedure, ready for XML generation. */
export interface NormalizedNode {
  nodeId: string;
  blockId: string;
  /** field name -> string value, as given in the input JSON. */
  fields: Record<string, string>;
  /** value input name -> connected child node. */
  valueInputs: Record<string, NormalizedNode>;
  /** statement input name -> ordered list of child nodes (next-chains flattened). */
  statementInputs: Record<string, NormalizedNode[]>;
}

export interface NormalizedProcedure {
  procedureName: string;
  trigger: string | null;
  /**
   * Independent, next-chain-flattened statement stacks (SPEC.md v1.2 §5
   * "ルート自動分類"). `stacks[0]` is the main sequence, connected after the
   * trigger (or rendered as the sole root when there's no trigger).
   * `stacks[1..]` are additional stacks that weren't reachable from the main
   * sequence — each produces a W004 warning and is still rendered as its own
   * independent top-level block group.
   */
  stacks: NormalizedNode[][];
  /** Which input-format mode normalizeInput detected ('graph' vs 'legacy',
   * see resolvedTypes.ts's InputMode) — a debugging aid, not surfaced in the UI. */
  mode: InputMode;
}
