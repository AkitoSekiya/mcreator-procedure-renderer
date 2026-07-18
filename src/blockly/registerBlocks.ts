/**
 * Registers block definitions from blocks_render.json (SPEC.md §5.1).
 * Builtin blocks (controls_if, text_join, etc.) come from `blockly/blocks`
 * (imported once in main.tsx) and need no registration here.
 */
import * as Blockly from 'blockly/core';
import type { RenderReferenceData, BlocklyJsonBlockDef, BlocklyJsonArg } from '../lib/referenceTypes';
import { registerCustomFields } from './fields';

let registered = false;

/** Prefixes every field_image's `src` with the app's BASE_URL so it resolves
 * correctly under a GitHub Pages subpath (SPEC.md §5.1). */
function rewriteFieldImageSrc(def: BlocklyJsonBlockDef, baseUrl: string): BlocklyJsonBlockDef {
  if (!Array.isArray(def.args0)) return def;
  const args0: BlocklyJsonArg[] = def.args0.map((arg) => {
    if (arg.type === 'field_image' && typeof arg.src === 'string') {
      return { ...arg, src: baseUrl + arg.src };
    }
    return arg;
  });
  return { ...def, args0 };
}

/**
 * Blockly v11's jsonInit is expected to honor a top-level `"hat": "cap"` key
 * (used only by event_trigger) by setting `block.hat = 'cap'`. As a safety
 * net in case a given build ignores it, wrap the registered block's `init`
 * so the hat is force-set afterwards regardless (SPEC.md §5.1).
 */
function applyHatFallback(blockType: string): void {
  const def = Blockly.Blocks[blockType] as { init?: (this: Blockly.Block) => void } | undefined;
  if (!def || typeof def.init !== 'function') return;
  const originalInit = def.init;
  def.init = function (this: Blockly.Block): void {
    originalInit.call(this);
    if (this.hat !== 'cap') {
      this.hat = 'cap';
    }
  };
}

/** Registers all blocks_render.json definitions plus the custom field types
 * they rely on. Idempotent — safe to call more than once. */
export function registerBlocks(render: RenderReferenceData, baseUrl: string): void {
  if (registered) return;
  registered = true;

  // Custom field types must be registered before defineBlocksWithJsonArray,
  // otherwise any definition referencing them throws during registration
  // and takes every other definition down with it (SPEC.md §5.2).
  registerCustomFields();

  const defs = render.definitions.map((def) => rewriteFieldImageSrc(def, baseUrl));
  Blockly.defineBlocksWithJsonArray(defs);

  applyHatFallback('event_trigger');
}
