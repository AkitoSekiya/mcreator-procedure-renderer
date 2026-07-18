/**
 * Maps each `field_dropdown`'s real Blockly *machine values* (not display
 * labels) per block/field, sourced from blocks_render.json's actual Blockly
 * JSON block definitions.
 *
 * Why this exists: blocks_full.json's `fields[].options` are, for many
 * blocks, *display labels* rather than machine values — e.g.
 * `math_binary_ops.OP` declares `["=","≠","<","≤",">","≥"]`, but the actual
 * Blockly field (see blocks_render.json) only accepts `"EQ"/"NEQ"/"LT"/...`.
 * A correct input JSON must use the machine value (that's what ends up in
 * the `<field>` XML Blockly parses), so validate.ts's W002 check has to be
 * based on this map, not blindly on blocks_full.json's `options`.
 *
 * Kept as a pure, data-only module (no Blockly import) so it stays usable
 * from plain Node scripts/tests, same as validate.ts.
 */
import type { RenderReferenceData } from './referenceTypes';

/** `[displayLabel, machineValue]`, matching Blockly's field_dropdown JSON option shape. */
export type DropdownOption = [label: string, value: string];

/** block_id -> field name -> ordered [label, value] options. */
export type DropdownOptionsMap = Record<string, Record<string, DropdownOption[]>>;

/**
 * Builtin blocks (from `blockly/blocks`) have no entry in blocks_render.json's
 * `definitions` array (see its `builtin_blocks` list) — Blockly supplies
 * their JSON definitions internally. Of the 9 builtin blocks, only
 * `logic_boolean.BOOL` is a field_dropdown, and its real machine values
 * ("TRUE"/"FALSE") must be hardcoded here since there's no reference JSON to
 * read them from.
 */
const BUILTIN_DROPDOWN_OPTIONS: DropdownOptionsMap = {
  logic_boolean: {
    BOOL: [
      ['true', 'TRUE'],
      ['false', 'FALSE'],
    ],
  },
};

/** Builds the block_id -> field -> [label,value][] map from
 * blocks_render.json's definitions, merged with the builtin-block hardcoded
 * fallback above. */
export function buildDropdownOptionsMap(render: RenderReferenceData): DropdownOptionsMap {
  const map: DropdownOptionsMap = {};
  for (const [blockId, fields] of Object.entries(BUILTIN_DROPDOWN_OPTIONS)) {
    map[blockId] = { ...fields };
  }

  for (const def of render.definitions) {
    if (!Array.isArray(def.args0)) continue;
    for (const arg of def.args0) {
      if (arg.type !== 'field_dropdown' || typeof arg.name !== 'string') continue;
      const rawOptions = arg.options;
      if (!Array.isArray(rawOptions)) continue;
      const pairs: DropdownOption[] = [];
      for (const o of rawOptions) {
        if (Array.isArray(o) && o.length === 2 && typeof o[0] === 'string' && typeof o[1] === 'string') {
          pairs.push([o[0], o[1]]);
        }
      }
      if (pairs.length === 0) continue;
      if (!map[def.type]) map[def.type] = {};
      map[def.type][arg.name] = pairs;
    }
  }

  return map;
}

/** Looks up the [label,value] options for a given block_id/field name, if known. */
export function findDropdownOptions(
  map: DropdownOptionsMap,
  blockId: string,
  fieldName: string,
): DropdownOption[] | undefined {
  return map[blockId]?.[fieldName];
}
