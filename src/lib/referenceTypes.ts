/**
 * TypeScript types describing the shape of `public/reference/blocks_full.json`
 * and `public/reference/blocks_render.json`.
 *
 * These mirror the *actual* JSON structures (verified by directly reading the
 * files) rather than a guessed/idealized shape. See SPEC.md §2.
 */

/** A single value input declared on a block: `{name, check}`. */
export interface FullValueInput {
  name: string;
  /** Blockly "check" type. Can be a single type, a list of types (union), or null (any). */
  check: string | string[] | null;
}

/** A single field declared on a block. */
export interface FullField {
  name: string;
  type: string;
  /** Machine values for field_dropdown, e.g. ["SUCCESS","CONSUME",...]. */
  options: string[] | null;
  /** Name of a datalist this field draws from (e.g. "particles"), if any. */
  datalist: string | null;
}

export type BlockShape = 'value' | 'statement' | 'hat';

/** One entry of `blocks_full.json`'s `blocks` map (block_id -> definition). */
export interface FullBlockDef {
  id: string;
  source: string;
  category: string;
  colour_hue: number | null;
  colour_hex: string | null;
  colour_name_ja: string | null;
  shape: BlockShape;
  output_type: string | string[] | null;
  output_type_ja: string | null;
  has_prev_next: boolean;
  inputs_inline: boolean;
  label_en: string | null;
  label_ja: string | null;
  label_rendered: string | null;
  tooltip_en: string | null;
  tooltip_ja: string | null;
  side: string | null;
  value_inputs: FullValueInput[];
  statement_inputs: string[];
  fields: FullField[];
  /** Strings of the form "name:type", e.g. "world:world". */
  dependencies: string[];
  required_apis: string[] | null;
  visual_description_ja: string | null;
  use_case_ja: string | null;
}

/** Root shape of `public/reference/blocks_full.json`. */
export interface FullReferenceData {
  mcreator_version: string;
  categories: string[];
  blocks: Record<string, FullBlockDef>;
}

/** Root shape of `public/reference/blocks_render.json`. */
export interface RenderReferenceData {
  mcreator_version: string;
  note: string;
  /** Block ids rendered using Blockly's own builtin block definitions (blockly/blocks). */
  builtin_blocks: string[];
  /** Custom field type names that must be registered via Blockly.fieldRegistry. */
  custom_field_types: string[];
  /** Blockly JSON block definitions, passable ~as-is to defineBlocksWithJsonArray. */
  definitions: BlocklyJsonBlockDef[];
}

/**
 * A Blockly JSON block definition. Kept loose (definitions vary widely in
 * which optional keys are present) but typed enough to let registerBlocks.ts
 * safely rewrite field_image src paths and detect the "hat" key.
 */
export interface BlocklyJsonBlockDef {
  type: string;
  message0?: string;
  args0?: BlocklyJsonArg[];
  colour?: string | number;
  previousStatement?: string | null;
  nextStatement?: string | null;
  output?: string | string[] | null;
  inputsInline?: boolean;
  tooltip?: string;
  /** MCreator-specific extension consumed by registerBlocks.ts fallback; not native Blockly JSON. */
  hat?: string;
  [key: string]: unknown;
}

export interface BlocklyJsonArg {
  type: string;
  name?: string;
  check?: string | string[];
  src?: string;
  width?: number;
  height?: number;
  [key: string]: unknown;
}
