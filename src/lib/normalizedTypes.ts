import type { InputMode } from './resolvedTypes';

/** The validated + normalized form of a procedure, ready for XML generation. */
export interface NormalizedNode {
  nodeId: string;
  blockId: string;
  /** field name -> string value, as given in the input JSON. For
   * variables_get_<type> / variables_set_<type> nodes, `fields.VAR` has
   * already been rewritten from the input's bare variable name to the real
   * Blockly field value ("local:name" or "global:name" — see validate.ts's
   * validateVariableNode). */
  fields: Record<string, string>;
  /** value input name -> connected child node. */
  valueInputs: Record<string, NormalizedNode>;
  /** statement input name -> ordered list of child nodes (next-chains flattened). */
  statementInputs: Record<string, NormalizedNode[]>;
  /** Set only for variables_get_<type> / variables_set_<type> nodes: whether
   * the referenced variable's scope is PLAYER_LIFETIME/PLAYER_PERSISTENT, i.e.
   * whether toXml.ts's mutationXml should emit
   * `<mutation is_player_var="true" ...>` (adding the "entity" input slot
   * when loaded into a real Blockly workspace — see
   * src/blockly/registerBlocks.ts's variable mutator). */
  isPlayerScopedVariable?: boolean;
}

/** One entry of `NormalizedProcedure.variables` — a validated `local`-scope
 * custom variable declaration, ready for the `<variables>` XML section.
 * GLOBAL_ and PLAYER_ declarations are validated the same way but
 * deliberately excluded here: real MCreator only ever embeds `<variable>`
 * elements for a
 * procedure's *own* local variables (confirmed via `javap` — see
 * tools/extract_mcreator_metadata.py); non-local ones live in a project-wide
 * file this renderer never sees, and since this app's "VAR" field is a plain
 * custom dropdown-style field rather than a real Blockly `field_variable`
 * (see registerBlocks.ts), nothing about loading/rendering actually requires
 * a `<variable>` declaration to exist for a reference to work either way. */
export interface NormalizedVariableDecl {
  name: string;
  /** Real Blockly variable type (e.g. "Number", "MCItem"), from
   * variable_types.json — NOT the internal type id ("number"/"itemstack"). */
  blocklyType: string;
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
  /** Validated custom variable declarations (top-level `variables` array),
   * rendered as a `<variables>` XML block ahead of the main content. Entries
   * that failed validation (unknown type/scope, duplicate name) are not
   * included here even though the document may still otherwise be `ok`. */
  variables: NormalizedVariableDecl[];
}
