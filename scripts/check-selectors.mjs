// Regression tests for MCreator 2025.1's block/item selector UI
// (`mcitem_allblocks` / `mcitem_all`, Blockly field `field_mcitem_selector`)
// support, added because blocks_full.json's js-imperative extraction
// (tools/extract.py) previously missed this field entirely — the block's
// `fields`/`value_inputs` came out empty and `output_type` came out "any",
// making it impossible to express a selected block (e.g. ICE,
// STAINED_GLASS#3) in JSON without every "value" field key being rejected
// as E005 (unknown field).
//
// Persistence format, confirmed from MCreator 2025.1 real data (not
// guessed) — see README and src/lib/validate.ts's MCITEM_SELECTOR_VALUE_
// PATTERN comment for the full chain of evidence:
//   - Field name: "value" (mcreator_blocks.js:
//     `.appendField(new FieldMCItemSelector("allblocks"), "value")`)
//   - Field class: FieldMCItemSelector extends Blockly.FieldImage,
//     SERIALIZABLE = true, no custom toXml/fromXml — plain text field value,
//     no mutation/extra_state needed.
//   - Value format for vanilla blocks: "Blocks.<NAME>" or
//     "Blocks.<NAME>#<index>" — the literal key format shared by BOTH
//     datalists/blocksitems.yaml (the selector dialog's data source) and the
//     generator's own mappings/blocksitems.yaml (confirmed byte-identical
//     key sets for ICE/STAINED_GLASS#0-15/AIR/VOID_AIR/CAVE_AIR), resolved
//     at codegen time via `NameMapper.getMapping(value, index)` which does a
//     direct `map.get(value)` lookup keyed by this exact string (confirmed
//     via `javap -c` on NameMapper.class/processMapping).
//   - Value format for custom mod elements: "CUSTOM:<ModElementName>" or
//     "CUSTOM:<ModElementName>.<suffix>" (confirmed via
//     GeneratorWrapper.getElementPlainName + MappableElement.
//     validateReference).
//   - "EXTERNAL:<literal>" — NameMapper's generic escape hatch, confirmed
//     for all mapping sources including "blocksitems".
//   - mcitem_allblocks output type is the array ["MCItemBlock",
//     "BlockStateProvider"] (mcreator_blocks.js: `setOutput(true,
//     ['MCItemBlock', 'BlockStateProvider'])`), not "any" as previously
//     recorded — this now also lets Blockly's own connection-check reject
//     e.g. a Number slot, which "any" incorrectly allowed.
//   - mcitem_all output type is the single string "MCItem" (was already
//     correct).
//   - Both block_ids share the exact same Java codegen handler
//     (net.mcreator.blockly.java.blocks.MCItemBlock.getSupportedBlocks()
//     returns exactly ["mcitem_all", "mcitem_allblocks"]) — confirming it's
//     safe (and correct) to give them one shared value-format rule.
//
// Run with: npm run check-selectors
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProcedure } from '../src/lib/validate.ts';
import { buildDropdownOptionsMap } from '../src/lib/dropdownOptions.ts';
import { procedureToXmlString, countExpectedBlocks } from '../src/blockly/toXml.ts';
// See scripts/check-compat.mjs's "Headless-Blockly section" comment for why
// this uses the default import form instead of the namespace form.
import Blockly from 'blockly/core';
import 'blockly/blocks';
import * as ja from 'blockly/msg/ja';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const full = JSON.parse(readFileSync(path.join(root, 'public/reference/blocks_full.json'), 'utf-8'));
const render = JSON.parse(readFileSync(path.join(root, 'public/reference/blocks_render.json'), 'utf-8'));
const dropdownOptions = buildDropdownOptionsMap(render);
const variableTypes = JSON.parse(readFileSync(path.join(root, 'public/reference/variable_types.json'), 'utf-8'));
const triggers = JSON.parse(readFileSync(path.join(root, 'public/reference/triggers.json'), 'utf-8'));
const iteratorProviders = JSON.parse(readFileSync(path.join(root, 'public/reference/iterator_providers.json'), 'utf-8'));
const entityTypes = JSON.parse(readFileSync(path.join(root, 'public/reference/entity_types.json'), 'utf-8'));
const extras = { variableTypes, triggers, iteratorProviders, entityTypes };

let failures = 0;
function fail(message) {
  failures += 1;
  console.log(`  FAIL: ${message}`);
}
function ok(name, condition, detail) {
  console.log(`${name}: ${condition ? 'OK' : 'FAIL'}${detail ? ` (${detail})` : ''}`);
  if (!condition) fail(name);
}
function validate(doc) {
  return validateProcedure(doc, full, dropdownOptions, extras);
}
function codes(result) {
  return result.messages.map((m) => m.code);
}

function numNode(id, value) {
  return { node_id: id, block_id: 'math_number', fields: { NUM: String(value) } };
}
function selectorNode(id, value) {
  return { node_id: id, block_id: 'mcitem_allblocks', fields: { value } };
}
function blockAdd(id, selector, x, y, z, next) {
  return {
    node_id: id,
    block_id: 'block_add',
    value_inputs: { block: selector, x: numNode(`${id}x`, x), y: numNode(`${id}y`, y), z: numNode(`${id}z`, z) },
    ...(next ? { next } : {}),
  };
}
function blockReplace(id, selector, x, y, z, next) {
  return {
    node_id: id,
    block_id: 'block_replace',
    fields: { state: 'TRUE', nbt: 'FALSE' },
    value_inputs: { block: selector, x: numNode(`${id}x`, x), y: numNode(`${id}y`, y), z: numNode(`${id}z`, z) },
    ...(next ? { next } : {}),
  };
}

// ============================================================================
// Headless-Blockly harness (mirrors scripts/check-compat.mjs's; see that
// file's "Headless-Blockly section" comment for why the default-import form
// is required here instead of `import * as Blockly`). Set up before any
// test that loads XML into a workspace.
// ============================================================================
Blockly.setLocale(ja);

function currentValueMenuGenerator() {
  const v = this.getValue();
  const value = typeof v === 'string' ? v : '';
  return [[value.length > 0 ? value : '(未設定)', value]];
}
class SingleValueDropdownField extends Blockly.FieldDropdown {
  constructor(value = '') {
    super(currentValueMenuGenerator);
    this.setValue(value);
  }
  doClassValidation_(newValue) {
    return typeof newValue === 'string' ? newValue : '';
  }
  getText_() {
    const v = this.getValue();
    return typeof v === 'string' ? v : '';
  }
  static fromJson() {
    return new SingleValueDropdownField('');
  }
}
class SimpleTextField extends Blockly.FieldTextInput {
  static fromJson(options) {
    return new SimpleTextField(typeof options.text === 'string' ? options.text : '');
  }
}
for (const name of render.custom_field_types) {
  const isDropdownLike = ['field_data_list_selector', 'field_data_list_dropdown', 'field_ai_condition_selector'].includes(name);
  Blockly.fieldRegistry.register(name, isDropdownLike ? SingleValueDropdownField : SimpleTextField);
}
Blockly.defineBlocksWithJsonArray(render.definitions);

// Mirrors registerBlocks.ts's buildVariableBlockDefs()/applyVariableEntityMutator()
// — needed because the Lesson 9 sample (test 8) uses local Number variables
// (r/h/a/b/x/y/z), same as scripts/check-mcreator-features.mjs.
{
  const defs = [];
  for (const t of variableTypes.types) {
    defs.push({
      type: `variables_get_${t.id}`,
      message0: '%1 %2',
      args0: [
        { type: 'field_label', text: t.label_ja_get ?? t.label_en_get ?? `Get ${t.id}` },
        { type: 'field_data_list_selector', name: variableTypes.field_name, datalist: 'variable' },
      ],
      output: t.blockly_type,
      colour: t.colour_hue,
      inputsInline: true,
    });
    defs.push({
      type: `variables_set_${t.id}`,
      message0: '%1 %2 = %3',
      args0: [
        { type: 'field_label', text: t.label_ja_set ?? t.label_en_set ?? `Set ${t.id}` },
        { type: 'field_data_list_selector', name: variableTypes.field_name, datalist: 'variable' },
        { type: 'input_value', name: variableTypes.set_value_input_name, check: t.blockly_type },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: t.colour_hue,
      inputsInline: true,
    });
  }
  Blockly.defineBlocksWithJsonArray(defs);

  for (const t of variableTypes.types) {
    for (const kind of ['get', 'set']) {
      const blockType = `variables_${kind}_${t.id}`;
      const def = Blockly.Blocks[blockType];
      def.domToMutation = function (xmlElement) {
        const isPlayerVar = xmlElement.getAttribute('is_player_var') === 'true';
        const hasEntity = this.getInput('entity') !== null;
        if (isPlayerVar && !hasEntity) {
          this.appendValueInput('entity').setCheck('Entity').appendField(new Blockly.FieldLabel('対象のエンティティ:'));
        } else if (!isPlayerVar && hasEntity) {
          this.removeInput('entity');
        }
      };
    }
  }
}

let blocklyFailures = 0;
function blocklyOk(name, condition, detail) {
  console.log(`${name}: ${condition ? 'OK' : 'FAIL'}${detail ? ` (${detail})` : ''}`);
  if (!condition) blocklyFailures += 1;
}

function loadIntoWorkspace(normalized) {
  const xml = procedureToXmlString(normalized);
  const expected = countExpectedBlocks(normalized);
  const workspace = new Blockly.Workspace();
  const dom = Blockly.utils.xml.textToDom(xml);
  Blockly.Xml.domToWorkspace(dom, workspace);
  const actual = workspace.getAllBlocks(false).length;
  return { workspace, xml, expected, actual };
}

// --- 1. Selector unit test: ICE-specified mcitem_allblocks loads cleanly ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'selector_unit_ice',
    blocks: [blockAdd('n1', selectorNode('sel_ice', 'Blocks.ICE'), 0, 64, 0)],
  };
  const result = validate(doc);
  ok('1a. ICE selector: 0 errors', result.ok, JSON.stringify(codes(result)));
  ok('1b. no E003/E004/E005/E006/E018/E019', !codes(result).some((c) => ['E003', 'E004', 'E005', 'E006', 'E018', 'E019'].includes(c)), JSON.stringify(codes(result)));
}

// --- 2. block_add connection test ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'selector_block_add',
    blocks: [blockAdd('n1', selectorNode('sel', 'Blocks.ICE'), 1, 65, 1)],
  };
  const result = validate(doc);
  if (result.ok && result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('2a. block_add: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const add = workspace.getAllBlocks(false).find((b) => b.type === 'block_add');
    const selector = add?.getInputTargetBlock('block');
    blocklyOk('2b. block_add.block connection present (not dropped)', !!selector, '');
    blocklyOk('2c. selector block type is mcitem_allblocks', selector?.type === 'mcitem_allblocks', String(selector?.type));
    blocklyOk('2d. ICE value preserved after round-trip', selector?.getFieldValue('value') === 'Blocks.ICE', String(selector?.getFieldValue('value')));
  } else {
    blocklyOk('2. block_add connection test: validation must succeed first', false, JSON.stringify(codes(result)));
  }
}

// --- 3. block_replace connection test ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'selector_block_replace',
    blocks: [blockReplace('n1', selectorNode('sel', 'Blocks.STAINED_GLASS#3'), 2, 66, 2)],
  };
  const result = validate(doc);
  if (result.ok && result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('3a. block_replace: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const rep = workspace.getAllBlocks(false).find((b) => b.type === 'block_replace');
    const selector = rep?.getInputTargetBlock('block');
    blocklyOk('3b. block_replace.block connection present (not dropped)', !!selector, '');
    blocklyOk('3c. STAINED_GLASS#3 value preserved after round-trip', selector?.getFieldValue('value') === 'Blocks.STAINED_GLASS#3', String(selector?.getFieldValue('value')));
  } else {
    blocklyOk('3. block_replace connection test: validation must succeed first', false, JSON.stringify(codes(result)));
  }
}

// --- 4. Multiple-selector test: 5 distinct blocks in one procedure, not confused ---
{
  const expectedValues = {
    n_ice: 'Blocks.ICE',
    n_air: 'Blocks.AIR',
    n_void: 'Blocks.VOID_AIR',
    n_cave: 'Blocks.CAVE_AIR',
    n_glass: 'Blocks.STAINED_GLASS#3',
  };
  const doc = {
    format_version: 1,
    procedure_name: 'selector_multi',
    blocks: [
      blockAdd('n_ice', selectorNode('sel_ice', expectedValues.n_ice), 0, 70, 0, 'n_air'),
      blockAdd('n_air', selectorNode('sel_air', expectedValues.n_air), 1, 70, 0, 'n_void'),
      blockAdd('n_void', selectorNode('sel_void', expectedValues.n_void), 2, 70, 0, 'n_cave'),
      blockAdd('n_cave', selectorNode('sel_cave', expectedValues.n_cave), 3, 70, 0, 'n_glass'),
      blockReplace('n_glass', selectorNode('sel_glass', expectedValues.n_glass), 4, 70, 0),
    ],
  };
  const result = validate(doc);
  ok('4a. multi-selector doc: 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('4b. multi-selector: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const selectors = workspace.getAllBlocks(false).filter((b) => b.type === 'mcitem_allblocks');
    blocklyOk('4c. exactly 5 mcitem_allblocks blocks present', selectors.length === 5, String(selectors.length));
    const actualValues = new Set(selectors.map((b) => b.getFieldValue('value')));
    const wantValues = new Set(Object.values(expectedValues));
    const matches = actualValues.size === wantValues.size && [...wantValues].every((v) => actualValues.has(v));
    blocklyOk('4d. all 5 distinct values preserved, none confused/mixed up', matches, `got=${JSON.stringify([...actualValues])}`);
  } else {
    blocklyOk('4. multi-selector connection checks: validation must succeed first', false, JSON.stringify(codes(result)));
  }
}

// --- 5. Value-format validation ---
{
  const emptyDoc = { format_version: 1, procedure_name: 'sel_empty', blocks: [blockAdd('n1', selectorNode('sel', ''), 0, 0, 0)] };
  ok('5a. empty value -> E018', codes(validate(emptyDoc)).includes('E018'), JSON.stringify(codes(validate(emptyDoc))));

  const malformedDoc = { format_version: 1, procedure_name: 'sel_malformed', blocks: [blockAdd('n1', selectorNode('sel', 'ICE'), 0, 0, 0)] };
  ok('5b. malformed value ("ICE", no prefix) -> E019', codes(validate(malformedDoc)).includes('E019'), JSON.stringify(codes(validate(malformedDoc))));

  const garbageDoc = { format_version: 1, procedure_name: 'sel_garbage', blocks: [blockAdd('n1', selectorNode('sel', 'javascript:alert(1)'), 0, 0, 0)] };
  ok('5c. malformed value (arbitrary string) -> E019, not silently accepted', codes(validate(garbageDoc)).includes('E019'), JSON.stringify(codes(validate(garbageDoc))));

  const customDoc = { format_version: 1, procedure_name: 'sel_custom', blocks: [blockAdd('n1', selectorNode('sel', 'CUSTOM:MyCustomBlock'), 0, 0, 0)] };
  ok('5d. CUSTOM:<name> format -> 0 errors (workspace-dependent, not rejected)', validate(customDoc).ok, JSON.stringify(codes(validate(customDoc))));

  const customPropDoc = { format_version: 1, procedure_name: 'sel_custom_prop', blocks: [blockAdd('n1', selectorNode('sel', 'CUSTOM:MyCustomBlock.lit'), 0, 0, 0)] };
  ok('5e. CUSTOM:<name>.<suffix> format -> 0 errors', validate(customPropDoc).ok, JSON.stringify(codes(validate(customPropDoc))));

  const externalDoc = { format_version: 1, procedure_name: 'sel_external', blocks: [blockAdd('n1', selectorNode('sel', 'EXTERNAL:some.literal.expr'), 0, 0, 0)] };
  ok('5f. EXTERNAL:<literal> format -> 0 errors', validate(externalDoc).ok, JSON.stringify(codes(validate(externalDoc))));

  const metaIndexDoc = { format_version: 1, procedure_name: 'sel_metaindex', blocks: [blockAdd('n1', selectorNode('sel', 'Blocks.STONE#3'), 0, 0, 0)] };
  ok('5g. Blocks.<NAME>#<index> format -> 0 errors', validate(metaIndexDoc).ok, JSON.stringify(codes(validate(metaIndexDoc))));
}

// --- 6. mcitem_all (singular) connects into an MCItem-typed slot ---
// (mcitem_to_block.source expects MCItem; nested under block_add.block so
// there's a real statement-shape root — a bare top-level "value"-shape block
// is itself an orphan (W005) and never gets its inputs checked at all.)
{
  const doc = {
    format_version: 1,
    procedure_name: 'sel_mcitem_all',
    blocks: [
      blockAdd(
        'n1',
        {
          node_id: 'conv',
          block_id: 'mcitem_to_block',
          value_inputs: { source: { node_id: 'sel', block_id: 'mcitem_all', fields: { value: 'Blocks.DIAMOND' } } },
        },
        0,
        0,
        0,
      ),
    ],
  };
  const result = validate(doc);
  ok('6a. mcitem_all in an MCItem slot: 0 errors', result.ok, JSON.stringify(codes(result)));
}

// --- 7. Output-type correction: mcitem_allblocks must NOT connect to a Number slot ---
// (regression guard for the "any" -> ["MCItemBlock","BlockStateProvider"] fix)
{
  const doc = {
    format_version: 1,
    procedure_name: 'sel_type_mismatch',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'block_add',
        value_inputs: {
          block: selectorNode('sel_ok', 'Blocks.ICE'),
          x: selectorNode('sel_bad', 'Blocks.ICE'),
          y: numNode('y1', 0),
          z: numNode('z1', 0),
        },
      },
    ],
  };
  const result = validate(doc);
  ok('7a. mcitem_allblocks into a Number slot -> E006 (type mismatch, not silently "any")', codes(result).includes('E006'), JSON.stringify(codes(result)));
}

// --- 8. Lesson-9-equivalent sample: round-trip through a real workspace ---
{
  const lessonPath = path.join(root, 'public/samples/sample_lesson9_circle_blocks.json');
  const doc = JSON.parse(readFileSync(lessonPath, 'utf-8'));
  const result = validate(doc);
  ok('8a. Lesson 9 sample: 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('8b. Lesson 9 sample: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const selectors = workspace.getAllBlocks(false).filter((b) => b.type === 'mcitem_allblocks');
    const values = selectors.map((b) => b.getFieldValue('value'));
    blocklyOk('8c. Lesson 9 sample: all 5 block references present (ICE/STAINED_GLASS#3/AIR/VOID_AIR/CAVE_AIR)', ['Blocks.ICE', 'Blocks.STAINED_GLASS#3', 'Blocks.AIR', 'Blocks.VOID_AIR', 'Blocks.CAVE_AIR'].every((v) => values.includes(v)), JSON.stringify(values));
    const trigOps = workspace.getAllBlocks(false).filter((b) => b.type === 'math_singular_ops').map((b) => b.getFieldValue('OP'));
    blocklyOk('8d. Lesson 9 sample: SIN/COS/ASIN/DEG2RAD all present', ['SIN', 'COS', 'ASIN', 'DEG2RAD'].every((op) => trigOps.includes(op)), JSON.stringify(trigOps));
    blocklyOk('8e. Lesson 9 sample: repeat loop present', workspace.getAllBlocks(false).some((b) => b.type === 'controls_repeat_ext'), '');
    blocklyOk('8f. Lesson 9 sample: block-get (world_data_blockat) present', workspace.getAllBlocks(false).some((b) => b.type === 'world_data_blockat'), '');
    blocklyOk('8g. Lesson 9 sample: block-compare (compare_blockstates) present', workspace.getAllBlocks(false).some((b) => b.type === 'compare_blockstates'), '');
  } else {
    blocklyOk('8. Lesson 9 sample: validation must succeed first', false, JSON.stringify(codes(result)));
  }
}

console.log('');
console.log(`selector tests: ${failures + blocklyFailures} failure(s)`);
if (failures + blocklyFailures > 0) process.exit(1);
