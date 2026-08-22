// Regression tests for the MCreator 2025.1 compatibility pass:
// - Security/perf guards (src/lib/guards.ts): reserved-key rejection (E010),
//   oversized-input rejection (E011), excessive-nesting rejection (E012).
// - New semantic checks: call_procedure argN/nameN index contiguity (W008),
//   field_number non-numeric values (W009), procedure-wide required_apis
//   aggregate (I003).
// - The call_procedure dynamic-argument rendering fix (src/blockly/
//   registerBlocks.ts's applyCallProcedureArgsMutator), verified against a
//   real (headless) Blockly workspace, not just the generated XML string.
// - A "capture ball" style sample built entirely from real, catalogued
//   blocks_full.json blocks (spawn/NBT/despawn/health/tame) — written before
//   this project had access to real MCreator source data for custom
//   variables. Custom variable get/set support (variables_get_<type>/
//   variables_set_<type>, all 9 types x 6 scopes) was added in a later pass
//   once that data became available — see scripts/check-mcreator-
//   features.mjs for its dedicated regression tests (including a version of
//   this same capture/respawn scenario using a real Local MCItem variable).
// - Documents (rather than "fixes", since there's nothing to fix) that an
//   unrecognized custom-variable-style block_id (not matching any of the 9
//   known variable_types.json type ids) safely surfaces as E003 instead of
//   silently mis-rendering.
//
// Run with: npm run check-compat
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProcedure, validateProcedureText } from '../src/lib/validate.ts';
import { buildDropdownOptionsMap } from '../src/lib/dropdownOptions.ts';
import { procedureToXmlString, countExpectedBlocks } from '../src/blockly/toXml.ts';
// See the "Headless-Blockly section" comment further below for why this uses
// the default import form (`import Blockly from ...`) instead of the
// namespace form the app itself uses.
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
const extras = { variableTypes, triggers, iteratorProviders };

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

function boolNode(id) {
  return { node_id: id, block_id: 'logic_boolean', fields: { BOOL: 'TRUE' } };
}
function numNode(id, value = '1') {
  return { node_id: id, block_id: 'math_number', fields: { NUM: value } };
}
function spawnNode(id, extra) {
  return {
    node_id: id,
    block_id: 'spawn_entity',
    fields: { entity: id },
    value_inputs: { x: numNode(`${id}x`), y: numNode(`${id}y`), z: numNode(`${id}z`) },
    ...extra,
  };
}

// --- 1. Reserved key rejection (E010): value_inputs, statement_inputs, fields ---
//
// `["__proto__"]` (a *computed* property name) is used deliberately instead
// of a literal `__proto__:` key: per spec (Annex B.3.1), only a literal,
// non-computed `__proto__` key in object-literal syntax is special-cased to
// set the new object's prototype at creation time — it never becomes an
// enumerable own "__proto__" property, so a literal key wouldn't actually
// exercise the vulnerable code path under test at all. A computed name (or
// JSON.parse, which a real attacker's payload would go through) has no such
// special case: `"__proto__"` there is an ordinary own property, exactly
// what these tests need to construct. `constructor`/`prototype` don't need
// this treatment (ordinary identifiers, no special object-literal behavior),
// but are written the same way for consistency across the three cases.
{
  const doc = {
    format_version: 1,
    procedure_name: 'dangerous_key_value_inputs',
    blocks: [{ node_id: 'n1', block_id: 'controls_if', value_inputs: { ['__proto__']: boolNode('c1') } }],
  };
  const result = validate(doc);
  ok('E010: __proto__ as value_inputs key is rejected', result.messages.some((m) => m.code === 'E010'), JSON.stringify(result.messages));
}
{
  const doc = {
    format_version: 1,
    procedure_name: 'dangerous_key_statement_inputs',
    blocks: [{ node_id: 'n1', block_id: 'controls_if', value_inputs: { IF0: boolNode('c1') }, statement_inputs: { ['constructor']: [spawnNode('s1')] } }],
  };
  const result = validate(doc);
  ok('E010: constructor as statement_inputs key is rejected', result.messages.some((m) => m.code === 'E010'), JSON.stringify(result.messages));
}
{
  // fields is on a shape=statement block (spawn_entity) reachable from a
  // controls_if root, not a bare top-level shape=value block — otherwise it
  // would be W005-excluded (unreferenced value block) before fields are ever
  // validated at all, never reaching the E010 check under test.
  const doc = {
    format_version: 1,
    procedure_name: 'dangerous_key_fields',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'controls_if',
        value_inputs: { IF0: boolNode('c1') },
        statement_inputs: { DO0: [{ ...spawnNode('s1'), fields: { entity: 's1', ['prototype']: 'hi' } }] },
      },
    ],
  };
  const result = validate(doc);
  ok('E010: prototype as fields key is rejected', result.messages.some((m) => m.code === 'E010'), JSON.stringify(result.messages));
}
{
  // Confirms the guard doesn't corrupt the object it's building: a
  // *legitimate* sibling key in the same value_inputs object is unaffected —
  // exactly one E010 (for __proto__ only), and IF0's own child (logic_boolean
  // "good") still gets validated with zero errors of its own. (The document
  // as a whole still ends up `ok: false` — E010 is error-severity and gates
  // rendering just like E001-E009 — that's the correctly-expected outcome
  // here, not a sign IF0 itself broke.)
  const doc = {
    format_version: 1,
    procedure_name: 'dangerous_key_sibling_survives',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'controls_if',
        value_inputs: { ['__proto__']: boolNode('bad'), IF0: boolNode('good') },
      },
    ],
  };
  const result = validate(doc);
  const e010s = result.messages.filter((m) => m.code === 'E010');
  ok('E010: exactly one E010 (for __proto__), not two or a crash', e010s.length === 1, JSON.stringify(result.messages));
  ok('E010: sibling key IF0/"good" itself has no errors of its own', !result.messages.some((m) => m.severity === 'error' && m.code !== 'E010'), JSON.stringify(result.messages));
}

// --- 2. Oversized-input rejection (E011) ---
{
  const hugeText = JSON.stringify({
    format_version: 1,
    procedure_name: 'x'.repeat(6_000_000),
    blocks: [],
  });
  const textResult = validateProcedureText(hugeText, full, dropdownOptions);
  ok('E011: oversized JSON text is rejected before parsing', textResult.messages.some((m) => m.code === 'E011'), JSON.stringify(textResult.messages.slice(0, 3)));
}
{
  const manyBlocks = Array.from({ length: 20_001 }, (_, i) => ({ node_id: `n${i}`, block_id: 'entity_send_chat' }));
  const doc = { format_version: 1, procedure_name: 'too_many_blocks', blocks: manyBlocks };
  const result = validate(doc);
  ok('E011: blocks array over the top-level count limit is rejected', result.messages.some((m) => m.code === 'E011'), JSON.stringify(result.messages.slice(0, 3)));
}

// --- 3. Excessive nesting rejection (E012) ---
{
  // 600 levels of inline value_inputs nesting (all shape=value blocks
  // chained via a single input), well past MAX_NESTING_DEPTH (500).
  function deepChain(depth) {
    let node = { node_id: 'leaf', block_id: 'math_number', fields: { NUM: '1' } };
    for (let i = 0; i < depth; i += 1) {
      node = { node_id: `d${i}`, block_id: 'math_binary_ops', fields: { OP: 'EQ' }, value_inputs: { A: node, B: { node_id: `d${i}b`, block_id: 'math_number', fields: { NUM: '1' } } } };
    }
    return node;
  }
  const doc = {
    format_version: 1,
    procedure_name: 'deep_nesting_test',
    blocks: [{ node_id: 'root', block_id: 'controls_if', value_inputs: { IF0: boolNode('c0') }, statement_inputs: { DO0: [{ node_id: 'wrap', block_id: 'spawn_entity', fields: { entity: 'x' }, value_inputs: { x: deepChain(600), y: numNode('yy'), z: numNode('zz') } }] } }],
  };
  const result = validate(doc);
  ok('E012: value_inputs nested 600 levels deep is rejected (not a stack overflow)', result.messages.some((m) => m.code === 'E012'), JSON.stringify(result.messages.filter((m) => m.severity === 'error').slice(0, 2)));
}

// --- 4. call_procedure argN/nameN contiguity (W008) ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'call_procedure_arg_gap',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'call_procedure',
        fields: { '': 'MyProc', name0: 'first' },
        value_inputs: { arg0: numNode('a0'), arg2: numNode('a2') }, // arg1 missing
      },
    ],
  };
  const result = validate(doc);
  ok('W008: non-contiguous argN indices (arg0, arg2 — no arg1) warns', result.messages.some((m) => m.code === 'W008'), JSON.stringify(result.messages));
  ok('W008 case: still 0 errors (a warning, not fatal)', result.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(result.messages));
}
{
  const doc = {
    format_version: 1,
    procedure_name: 'call_procedure_arg_contiguous',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'call_procedure',
        fields: { '': 'MyProc', name0: 'first', name1: 'second' },
        value_inputs: { arg0: numNode('a0'), arg1: numNode('a1') },
      },
    ],
  };
  const result = validate(doc);
  ok('W008: contiguous argN/nameN (0,1) produces no W008', !result.messages.some((m) => m.code === 'W008'), JSON.stringify(result.messages));
}

// --- 5. field_number validation (W009) ---
// get_command_parameters is shape=value, so it must be reachable (embedded
// in another node's value_inputs) rather than a bare top-level root — a
// top-level shape=value block is W005-excluded before fields are validated.
{
  const doc = {
    format_version: 1,
    procedure_name: 'field_number_invalid',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'entity_send_chat',
        value_inputs: { text: { node_id: 'n2', block_id: 'get_command_parameters', fields: { paramid: 'not_a_number' } } },
      },
    ],
  };
  const result = validate(doc);
  ok('W009: non-numeric field_number value warns', result.messages.some((m) => m.code === 'W009'), JSON.stringify(result.messages));
}
{
  const doc = {
    format_version: 1,
    procedure_name: 'field_number_valid',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'entity_send_chat',
        value_inputs: { text: { node_id: 'n2', block_id: 'get_command_parameters', fields: { paramid: '3' } } },
      },
    ],
  };
  const result = validate(doc);
  ok('W009: numeric field_number value produces no W009', !result.messages.some((m) => m.code === 'W009'), JSON.stringify(result.messages));
}

// --- 6. Procedure-wide required_apis aggregate (I003) ---
// blocks_full.json has `required_apis: null` on every one of its 516
// entries (confirmed by inspection) — no real block in this project's
// reference data exercises the field at all, so I002/I003 are otherwise
// dead code against real data. This test verifies the *aggregation logic
// itself* with a synthetic reference dataset (a clone of blocks_full.json
// with one statement-shape block's required_apis populated), not a claim
// about any real MCreator block actually requiring an API.
{
  const syntheticRef = {
    ...full,
    blocks: {
      ...full.blocks,
      __test_block_with_required_api: {
        ...full.blocks.spawn_entity,
        id: '__test_block_with_required_api',
        required_apis: ['TestAPI'],
      },
    },
  };
  const doc = {
    format_version: 1,
    procedure_name: 'required_apis_aggregate_test',
    blocks: [
      {
        node_id: 'n1',
        block_id: '__test_block_with_required_api',
        fields: { entity: 'x' },
        value_inputs: { x: numNode('x1'), y: numNode('y1'), z: numNode('z1') },
      },
    ],
  };
  const result = validateProcedure(doc, syntheticRef, dropdownOptions);
  ok('I003: procedure-wide required_apis aggregate present', result.messages.some((m) => m.code === 'I003' && m.message.includes('TestAPI')), JSON.stringify(result.messages));
  ok('I003: per-node I002 still present too (aggregate is additive, not a replacement)', result.messages.some((m) => m.code === 'I002'), JSON.stringify(result.messages));
}

// --- 7. Unrecognized custom-variable-style block_id -> safe E003 (a type
// suffix not among variable_types.json's 9 known ids is correctly treated
// as an unknown block_id rather than guessed at). Real variables_get_*/
// variables_set_* support (now backed by actual MCreator 2025.1 data — see
// tools/extract_mcreator_metadata.py) has its own dedicated regression
// suite in scripts/check-mcreator-features.mjs. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'custom_variable_unknown_type_test',
    blocks: [{ node_id: 'n1', block_id: 'variables_get_notarealtype', fields: { VAR: 'x' } }],
  };
  const result = validate(doc);
  ok('Unrecognized variable-block type suffix safely -> E003, not silently accepted', result.messages.some((m) => m.code === 'E003'), JSON.stringify(result.messages));
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check-compat test(s) did not produce the expected result (pre-Blockly section).`);
  process.exit(1);
} else {
  console.log('\nOK (pre-Blockly section): all check-compat structural tests produced their expected result.');
}

// ============================================================================
// Headless-Blockly section: loads generated XML into a real (non-SVG)
// Blockly Workspace and cross-checks the actual block/connection count, the
// same way App.tsx's own E999 safety net does after domToWorkspace.
//
// This can't `import * as Blockly from 'blockly/core'` and reuse
// src/blockly/registerBlocks.ts/fields.ts directly: under plain tsx/Node ESM
// (not Vite's bundler), that namespace import doesn't resolve blockly's CJS
// exports correctly (`Blockly.FieldDropdown` etc. come back `undefined`) —
// only `import Blockly from 'blockly/core'` (default import) does. This is a
// Node-direct-execution quirk of the `blockly` package's build, unrelated to
// the app itself (which runs fine under Vite/the browser). So this section
// hand-rolls a minimal harness using the default-import form, mirroring
// registerBlocks.ts/fields.ts's actual logic (including the call_procedure
// argument mutator fix under test) closely enough to faithfully exercise the
// same XML the app generates.
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

// Mirrors src/blockly/registerBlocks.ts's applyCallProcedureArgsMutator() —
// see that file for the full rationale (call_procedure is "js-imperative"
// sourced; its real argument mutator isn't captured in blocks_render.json).
{
  const def = Blockly.Blocks['call_procedure'];
  def.domToMutation = function (xmlElement) {
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
  def.mutationToDom = function () {
    const container = Blockly.utils.xml.createElement('mutation');
    let count = 0;
    while (this.getInput(`arg${count}`)) count += 1;
    container.setAttribute('inputs', String(count));
    return container;
  };
}

let blocklyFailures = 0;
function blocklyOk(name, condition, detail) {
  console.log(`${name}: ${condition ? 'OK' : 'FAIL'}${detail ? ` (${detail})` : ''}`);
  if (!condition) blocklyFailures += 1;
}

/** Loads a validated NormalizedProcedure's XML into a real headless
 * Workspace and returns { workspace, xml, expected, actual }. */
function loadIntoWorkspace(normalized) {
  const xml = procedureToXmlString(normalized);
  const expected = countExpectedBlocks(normalized);
  const workspace = new Blockly.Workspace();
  const dom = Blockly.utils.xml.textToDom(xml);
  Blockly.Xml.domToWorkspace(dom, workspace);
  const actual = workspace.getAllBlocks(false).length;
  return { workspace, xml, expected, actual };
}

// --- 8. call_procedure argument mutator fix: real Blockly workspace check ---
// (Confirms the bug found during this pass — Blockly silently discarding
// argN/nameN entirely, dropping the connected child block — is actually
// fixed, not just "produces plausible-looking XML".)
{
  const doc = {
    format_version: 1,
    procedure_name: 'call_procedure_mutator_render_test',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'call_procedure',
        fields: { '': 'WithArgs', name0: 'firstArgLabel', name1: 'secondArgLabel' },
        value_inputs: {
          arg0: { node_id: 'n2', block_id: 'math_number', fields: { NUM: '42' } },
          arg1: { node_id: 'n3', block_id: 'text', fields: { TEXT: 'hi' } },
        },
      },
    ],
  };
  const result = validate(doc);
  if (result.ok && result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('call_procedure mutator: expected block count matches actual (args not silently dropped)', expected === actual, `expected=${expected} actual=${actual}`);
    const cp = workspace.getAllBlocks(false).find((b) => b.type === 'call_procedure');
    blocklyOk('call_procedure mutator: arg0 is connected', !!cp?.getInput('arg0')?.connection?.targetBlock(), '');
    blocklyOk('call_procedure mutator: arg1 is connected', !!cp?.getInput('arg1')?.connection?.targetBlock(), '');
    blocklyOk('call_procedure mutator: name0/name1 field values applied', cp?.getFieldValue('name0') === 'firstArgLabel' && cp?.getFieldValue('name1') === 'secondArgLabel', `name0=${cp?.getFieldValue('name0')} name1=${cp?.getFieldValue('name1')}`);
    workspace.dispose();
  } else {
    blocklyOk('call_procedure mutator render test: expected a normalized result', false, JSON.stringify(result.messages));
  }
}

// --- 9. "Capture ball" style regression sample, built entirely from real,
// catalogued blocks (no custom variables — see README's limitations
// section). Demonstrates the closest faithful approximation possible:
// entity-side NBT read/write (entity_from_deps is the same dependency-
// provided entity across multiple statements within one procedure, per
// FULL-REFERENCE.md §1.4's description of dependencies as a stable
// per-execution context value — unlike a freshly-evaluated item expression,
// which is a new instance each time it's referenced, so item-side NBT
// *chaining* across statements is exactly the piece that needs a variable
// and can't be represented here). ---
{
  const numLit = (id, v) => ({ node_id: id, block_id: 'math_number', fields: { NUM: v } });
  const textLit = (id, v) => ({ node_id: id, block_id: 'text', fields: { TEXT: v } });
  const entityDeps = (id) => ({ node_id: id, block_id: 'entity_from_deps' });

  const captureDoc = {
    format_version: 1,
    mcreator_version: '2025.1',
    procedure_name: 'capture_side',
    trigger: 'onEntityRightClicked',
    blocks: [
      {
        node_id: 'root_if',
        block_id: 'controls_if',
        value_inputs: {
          IF0: {
            node_id: 'cond',
            block_id: 'math_binary_ops',
            fields: { OP: 'GT' },
            value_inputs: {
              A: { node_id: 'hp', block_id: 'entity_health', value_inputs: { entity: entityDeps('e1') } },
              B: numLit('zero', '0'),
            },
          },
        },
        statement_inputs: { DO0: ['nbt_type'] },
      },
      {
        node_id: 'nbt_type',
        block_id: 'entity_nbt_text_set',
        value_inputs: { tagName: textLit('t1', 'captured_type'), tagValue: textLit('t2', 'zombie'), entity: entityDeps('e2') },
        next: 'nbt_hp',
      },
      {
        node_id: 'nbt_hp',
        block_id: 'entity_nbt_num_set',
        value_inputs: {
          tagName: textLit('t3', 'captured_health'),
          tagValue: { node_id: 'hp2', block_id: 'entity_health', value_inputs: { entity: entityDeps('e3') } },
          entity: entityDeps('e4'),
        },
        next: 'tame',
      },
      { node_id: 'tame', block_id: 'entity_maketamed', value_inputs: { entity: entityDeps('e5'), sourceentity: entityDeps('e6') }, next: 'despawn' },
      { node_id: 'despawn', block_id: 'entity_despawn', value_inputs: { entity: entityDeps('e7') } },
    ],
  };

  const result = validate(captureDoc);
  ok('capture_side sample: 0 errors', result.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('capture_side sample: real Blockly block count matches expected', expected === actual, `expected=${expected} actual=${actual}`);
    workspace.dispose();
  } else {
    fail('capture_side sample: expected a normalized result');
  }

  const respawnDoc = {
    format_version: 1,
    mcreator_version: '2025.1',
    procedure_name: 'respawn_side',
    trigger: 'onBlockRightClicked',
    blocks: [
      {
        node_id: 'spawn',
        block_id: 'spawn_entity',
        fields: { entity: 'minecraft:zombie' },
        value_inputs: { x: { node_id: 'cx', block_id: 'coord_x' }, y: { node_id: 'cy', block_id: 'coord_y' }, z: { node_id: 'cz', block_id: 'coord_z' } },
        next: 'tame2',
      },
      { node_id: 'tame2', block_id: 'entity_maketamed', value_inputs: { entity: entityDeps('e8'), sourceentity: entityDeps('e9') }, next: 'restore_hp' },
      {
        node_id: 'restore_hp',
        block_id: 'entity_set_health',
        value_inputs: {
          entity: entityDeps('e10'),
          health: {
            node_id: 'read_hp',
            block_id: 'item_nbt_num_get',
            value_inputs: { tagName: textLit('t4', 'captured_health'), item: { node_id: 'empty_item', block_id: 'empty_itemstack' } },
          },
        },
      },
    ],
  };
  const result2 = validate(respawnDoc);
  ok('respawn_side sample: 0 errors', result2.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(result2.messages));
  if (result2.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result2.normalized);
    blocklyOk('respawn_side sample: real Blockly block count matches expected', expected === actual, `expected=${expected} actual=${actual}`);
    workspace.dispose();
  } else {
    fail('respawn_side sample: expected a normalized result');
  }
}

const totalFailures = failures + blocklyFailures;
if (totalFailures > 0) {
  console.error(`\nFAILED: ${totalFailures} check-compat test(s) did not produce the expected result (total).`);
  process.exit(1);
} else {
  console.log('\nOK: all check-compat tests (structural + headless-Blockly) produced their expected result.');
}
