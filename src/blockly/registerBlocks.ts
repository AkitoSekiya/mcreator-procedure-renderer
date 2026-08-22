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

/**
 * call_procedure's argument slots (`argN` value inputs + `nameN` name-label
 * fields — README/validate.ts's documented DYNAMIC_VALUE_INPUT_PATTERNS /
 * DYNAMIC_FIELD_PATTERNS) are, in real MCreator, added by a hand-written
 * Blockly mutator: blocks_full.json records call_procedure as
 * `"source": "js-imperative"`, meaning its actual argument-mutator logic
 * lives in MCreator's own imperative JS code, not a plain JSON block
 * definition — so it was never captured by blocks_render.json's JSON dump
 * (confirmed: that entry has no `mutator`/`extensions` key and no argN/nameN
 * in `args0`). Without *some* domToMutation, `<mutation inputs="N">` +
 * `<value name="argN">` + `<field name="nameN">` XML (which is exactly what
 * toXml.ts emits for this documented input shape) gets silently discarded by
 * Blockly on load — confirmed via a headless workspace: it logs "Ignoring
 * non-existent input/field" and drops the connected argument block entirely,
 * with zero validation warning, so a procedure call with arguments rendered
 * as if it had none.
 *
 * Since MCreator's real mutator shape isn't available to us, this installs
 * our own minimal domToMutation/mutationToDom directly on the block's shared
 * type definition (same technique as applyHatFallback above): read the
 * `inputs` count and append that many `argN` value inputs, each fronted by a
 * `nameN` text field. This is a rendering approximation — README already
 * documents call_procedure's argument display as simplified/approximate —
 * not a claim of matching MCreator's exact internal layout; the goal is
 * "arguments are visibly present and connected" instead of "silently gone".
 */
function applyCallProcedureArgsMutator(): void {
  const def = Blockly.Blocks['call_procedure'] as
    | {
        domToMutation?: (this: Blockly.Block, xml: Element) => void;
        mutationToDom?: (this: Blockly.Block) => Element;
      }
    | undefined;
  if (!def) return;

  def.domToMutation = function (this: Blockly.Block, xmlElement: Element): void {
    const raw = xmlElement.getAttribute('inputs');
    const count = raw !== null ? Math.max(0, parseInt(raw, 10) || 0) : 0;
    let i = 0;
    while (this.getInput(`arg${i}`)) {
      this.removeInput(`arg${i}`);
      i += 1;
    }
    for (let n = 0; n < count; n += 1) {
      this.appendValueInput(`arg${n}`).appendField(new Blockly.FieldTextInput(''), `name${n}`);
    }
  };

  def.mutationToDom = function (this: Blockly.Block): Element {
    const container = Blockly.utils.xml.createElement('mutation');
    let count = 0;
    while (this.getInput(`arg${count}`)) count += 1;
    container.setAttribute('inputs', String(count));
    return container;
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
  applyCallProcedureArgsMutator();
}
