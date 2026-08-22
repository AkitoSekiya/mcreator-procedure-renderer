// Regression tests for deep/large MCreator 2025.1 procedures — the
// "Lesson 9"-style trigonometric dome generation scenario (many local
// variables, multi-level controls_if/controls_repeat_ext nesting, deeply
// nested math formulas, mixed next/statement_inputs chains, the same local
// variable referenced from many places). This is a pure audit/regression
// pass: every check below already passed against the *existing*, unmodified
// normalizeInput.ts/validate.ts/toXml.ts/registerBlocks.ts pipeline (no
// block_id/field/value_input names were invented — all confirmed against
// blocks_full.json, same as every other pass in this project) — the design
// (structural, block_id-driven, no logic inference from JSON shape) already
// generalizes to this scale.
//
// Run with: npm run check-deep-nesting
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
function errors(result) {
  return result.messages.filter((m) => m.severity === 'error');
}

function numNode(id, value = '1') {
  return { node_id: id, block_id: 'math_number', fields: { NUM: String(value) } };
}
function getNum(id, varName) {
  return { node_id: id, block_id: 'variables_get_number', fields: { VAR: varName } };
}
function setNum(id, varName, val, next) {
  return { node_id: id, block_id: 'variables_set_number', fields: { VAR: varName }, value_inputs: { VAL: val }, ...(next ? { next } : {}) };
}

// ============================================================================
// Headless-Blockly harness (mirrors scripts/check-compat.mjs's).
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

// Mirrors registerBlocks.ts's buildVariableBlockDefs()/applyVariableEntityMutator().
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

// --- 1. Eight local Number variables declared simultaneously, each
// get/set-able, none colliding. ---
{
  const names = ['center', 'r', 'h', 'a', 'b', 'x', 'y', 'z'];
  const doc = {
    format_version: 1,
    procedure_name: 'eight_local_vars_test',
    variables: names.map((n) => ({ name: n, type: 'number', scope: 'local', initial_value: 0 })),
    blocks: names.reduce((acc, n, i) => {
      const nextId = i + 1 < names.length ? `set_${names[i + 1]}` : undefined;
      acc.push(setNum(`set_${n}`, n, numNode(`${n}_val`, i), nextId));
      return acc;
    }, []),
  };
  const result = validate(doc);
  ok('8 local Number variables: 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('8 local Number variables: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
  }
}

// --- 2. controls_if nested 4 levels deep, each with its own condition,
// DO0/ELSE combination determined solely by the JSON (no invented mutator
// logic) -- confirms the elseif/else mutator stays correct at depth. ---
{
  function nestedIf(depth) {
    if (depth === 0) return { node_id: 'leaf_stmt', block_id: 'entity_send_chat', value_inputs: { text: { node_id: 'lt', block_id: 'text', fields: { TEXT: 'deep' } }, actbar: { node_id: 'lb', block_id: 'logic_boolean', fields: { BOOL: 'FALSE' } }, entity: { node_id: 'le', block_id: 'entity_from_deps' } } };
    return {
      node_id: `if_${depth}`,
      block_id: 'controls_if',
      value_inputs: { IF0: { node_id: `cond_${depth}`, block_id: 'logic_boolean', fields: { BOOL: 'TRUE' } } },
      statement_inputs: depth % 2 === 0 ? { DO0: [nestedIf(depth - 1)], ELSE: [{ node_id: `else_${depth}`, block_id: 'entity_send_chat', value_inputs: { text: { node_id: `et${depth}`, block_id: 'text', fields: { TEXT: 'else' } }, actbar: { node_id: `eb${depth}`, block_id: 'logic_boolean', fields: { BOOL: 'FALSE' } }, entity: { node_id: `ee${depth}`, block_id: 'entity_from_deps' } } }] } : { DO0: [nestedIf(depth - 1)] },
    };
  }
  const doc = { format_version: 1, procedure_name: 'nested_if_4_test', blocks: [nestedIf(4)] };
  const result = validate(doc);
  ok('controls_if nested 4 levels: 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { xml, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('controls_if nested 4 levels: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const ifCount = (xml.match(/<block type="controls_if"/g) ?? []).length;
    blocklyOk('controls_if nested 4 levels: all 4 controls_if blocks present', ifCount === 4, String(ifCount));
    blocklyOk('controls_if nested 4 levels: elseif/else mutator correct at every level (2 of 4 have else="1")', (xml.match(/else="1"/g) ?? []).length === 2, xml);
  }
}

// --- 3. controls_repeat_ext nested 2 levels (outer 30, inner 5), each with
// its own TIMES value and DO body — mirrors the Lesson 9 scenario directly. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'nested_repeat_test',
    blocks: [
      {
        node_id: 'outer',
        block_id: 'controls_repeat_ext',
        value_inputs: { TIMES: numNode('t30', 30) },
        statement_inputs: {
          DO: [
            {
              node_id: 'inner',
              block_id: 'controls_repeat_ext',
              value_inputs: { TIMES: numNode('t5', 5) },
              statement_inputs: { DO: [{ node_id: 'leaf', block_id: 'entity_send_chat', value_inputs: { text: { node_id: 'lt2', block_id: 'text', fields: { TEXT: 'tick' } }, actbar: { node_id: 'lb2', block_id: 'logic_boolean', fields: { BOOL: 'FALSE' } }, entity: { node_id: 'le2', block_id: 'entity_from_deps' } } }] },
            },
          ],
        },
      },
    ],
  };
  const result = validate(doc);
  ok('controls_repeat_ext nested 2 levels (30x5): 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { xml, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('controls_repeat_ext nested 2 levels: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    blocklyOk('controls_repeat_ext nested 2 levels: both TIMES values present', xml.includes('<field name="NUM">30</field>') && xml.includes('<field name="NUM">5</field>'), xml);
  }
}

// --- 4. math_dual_ops deeply nested (40 levels), covering +, -, *, / all
// within one formula tree — value_inputs nesting "何段でも" (many levels). ---
{
  function deepFormula(depth) {
    const ops = ['ADD', 'MINUS', 'MULTIPLY', 'DIVIDE'];
    let node = numNode('leaf', 2);
    for (let i = 0; i < depth; i += 1) {
      node = { node_id: `f${i}`, block_id: 'math_dual_ops', fields: { OP: ops[i % ops.length] }, value_inputs: { A: node, B: numNode(`f${i}b`, 3) } };
    }
    return node;
  }
  const doc = {
    format_version: 1,
    procedure_name: 'deep_formula_test',
    variables: [{ name: 'result', type: 'number', scope: 'local', initial_value: 0 }],
    blocks: [setNum('set_result', 'result', deepFormula(40))],
  };
  const result = validate(doc);
  ok('math_dual_ops (+-*/) nested 40 levels deep: 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('math_dual_ops nested 40 levels: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
  }
}

// --- 5. math_singular_ops: sin/cos/asin/DEG to RAD/RAD to DEG all use their
// real machine values (SIN/COS/ASIN/DEG2RAD/RAD2DEG), not display labels. ---
{
  const ops = ['SIN', 'COS', 'ASIN', 'DEG2RAD', 'RAD2DEG'];
  for (const op of ops) {
    const doc = {
      format_version: 1,
      procedure_name: `singular_op_${op}_test`,
      variables: [{ name: 'v', type: 'number', scope: 'local', initial_value: 0 }],
      blocks: [setNum('set_v', 'v', { node_id: 'calc', block_id: 'math_singular_ops', fields: { OP: op }, value_inputs: { NUM: numNode('n', 1) } })],
    };
    const result = validate(doc);
    ok(`math_singular_ops OP="${op}": 0 errors (real machine value accepted)`, result.ok, JSON.stringify(codes(result)));
  }
}

// --- 6. statement_inputs holding 3 directly-listed statements: order is
// preserved exactly (not reordered/deduped). ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'multi_statement_order_test',
    variables: [{ name: 'seq', type: 'string', scope: 'local', initial_value: '' }],
    blocks: [
      {
        node_id: 'wrap',
        block_id: 'controls_if',
        value_inputs: { IF0: { node_id: 'c', block_id: 'logic_boolean', fields: { BOOL: 'TRUE' } } },
        statement_inputs: {
          DO0: [
            { node_id: 's1', block_id: 'variables_set_string', fields: { VAR: 'seq' }, value_inputs: { VAL: { node_id: 't1', block_id: 'text', fields: { TEXT: 'one' } } } },
            { node_id: 's2', block_id: 'variables_set_string', fields: { VAR: 'seq' }, value_inputs: { VAL: { node_id: 't2', block_id: 'text', fields: { TEXT: 'two' } } } },
            { node_id: 's3', block_id: 'variables_set_string', fields: { VAR: 'seq' }, value_inputs: { VAL: { node_id: 't3', block_id: 'text', fields: { TEXT: 'three' } } } },
          ],
        },
      },
    ],
  };
  const result = validate(doc);
  ok('statement_inputs with 3 direct entries: 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { xml, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('statement_inputs with 3 direct entries: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const i1 = xml.indexOf('>one<');
    const i2 = xml.indexOf('>two<');
    const i3 = xml.indexOf('>three<');
    blocklyOk('statement_inputs with 3 direct entries: order preserved (one -> two -> three)', i1 >= 0 && i1 < i2 && i2 < i3, xml);
  }
}

// --- 7. next-chain used *inside* a statement_inputs array entry (single
// node_id referencing a node whose own .next chains further) mixed with an
// *outer* next connecting the whole controls_if to a sibling — confirms
// mixing next and statement_inputs doesn't break connection order. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'next_and_statement_inputs_mixed_test',
    variables: [{ name: 'seq', type: 'string', scope: 'local', initial_value: '' }],
    blocks: [
      {
        node_id: 'wrap',
        block_id: 'controls_if',
        value_inputs: { IF0: { node_id: 'c', block_id: 'logic_boolean', fields: { BOOL: 'TRUE' } } },
        statement_inputs: { DO0: ['chain_a'] }, // single ref; chain_a.next -> chain_b -> chain_c
        next: 'after_if',
      },
      { node_id: 'chain_a', block_id: 'variables_set_string', fields: { VAR: 'seq' }, value_inputs: { VAL: { node_id: 'ta', block_id: 'text', fields: { TEXT: 'a' } } }, next: 'chain_b' },
      { node_id: 'chain_b', block_id: 'variables_set_string', fields: { VAR: 'seq' }, value_inputs: { VAL: { node_id: 'tb', block_id: 'text', fields: { TEXT: 'b' } } }, next: 'chain_c' },
      { node_id: 'chain_c', block_id: 'variables_set_string', fields: { VAR: 'seq' }, value_inputs: { VAL: { node_id: 'tc', block_id: 'text', fields: { TEXT: 'c' } } } },
      { node_id: 'after_if', block_id: 'variables_set_string', fields: { VAR: 'seq' }, value_inputs: { VAL: { node_id: 'td', block_id: 'text', fields: { TEXT: 'after' } } } },
    ],
  };
  const result = validate(doc);
  ok('next + statement_inputs mixed: 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { xml, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('next + statement_inputs mixed: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const ia = xml.indexOf('>a<');
    const ib = xml.indexOf('>b<');
    const ic = xml.indexOf('>c<');
    const iafter = xml.indexOf('>after<');
    blocklyOk('next + statement_inputs mixed: order preserved (a -> b -> c -> after, after is outside DO0)', ia >= 0 && ia < ib && ib < ic && ic < iafter, xml);
  }
}

// --- 8. Same local variable ("shared") referenced from many places
// (get x3, set x2) — all resolve to the same variable, none collide. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'shared_var_multi_ref_test',
    variables: [{ name: 'shared', type: 'number', scope: 'local', initial_value: 0 }],
    blocks: [
      setNum('s1', 'shared', numNode('n1', 1), 's2'),
      setNum('s2', 'shared', { node_id: 'read1', block_id: 'math_dual_ops', fields: { OP: 'ADD' }, value_inputs: { A: getNum('g1', 'shared'), B: numNode('n2', 1) } }, 'check_if'),
      {
        node_id: 'check_if',
        block_id: 'controls_if',
        value_inputs: { IF0: { node_id: 'cmp', block_id: 'math_binary_ops', fields: { OP: 'GT' }, value_inputs: { A: getNum('g2', 'shared'), B: numNode('n3', 0) } } },
        statement_inputs: { DO0: [{ node_id: 'chat', block_id: 'entity_send_chat', value_inputs: { text: { node_id: 'ct', block_id: 'text_format_number', value_inputs: { number: getNum('g3', 'shared'), format: { node_id: 'fmt', block_id: 'text', fields: { TEXT: '0' } } } }, actbar: { node_id: 'cb', block_id: 'logic_boolean', fields: { BOOL: 'FALSE' } }, entity: { node_id: 'ce', block_id: 'entity_from_deps' } } }] },
      },
    ],
  };
  const result = validate(doc);
  ok('same local variable referenced 5 times (2 set, 3 get): 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { xml, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('shared variable: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const occurrences = (xml.match(/local:shared/g) ?? []).length;
    blocklyOk('shared variable: all 5 references rewritten to "local:shared"', occurrences === 5, String(occurrences));
  }
}

// --- 9. logic_negate (NOT), compare_blockstates (block compare),
// coord_x/y/z (coordinate retrieval), block_add (block placement),
// spawn_entity (entity generation) all work as ordinary BlockNodes,
// combined in one procedure. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'ordinary_blocknode_kinds_test',
    blocks: [
      {
        node_id: 'root',
        block_id: 'controls_if',
        value_inputs: {
          IF0: {
            node_id: 'not_air',
            block_id: 'logic_negate',
            value_inputs: {
              BOOL: {
                node_id: 'cmp_air',
                block_id: 'compare_blockstates',
                value_inputs: {
                  a: { node_id: 'blk', block_id: 'world_data_blockat', value_inputs: { x: { node_id: 'cx', block_id: 'coord_x' }, y: { node_id: 'cy', block_id: 'coord_y' }, z: { node_id: 'cz', block_id: 'coord_z' } } },
                  b: { node_id: 'air', block_id: 'mcitem_allblocks', fields: { value: 'Blocks.AIR' } },
                },
              },
            },
          },
        },
        statement_inputs: { DO0: ['place'] },
      },
      {
        node_id: 'place',
        block_id: 'block_add',
        value_inputs: {
          block: { node_id: 'ice', block_id: 'mcitem_allblocks', fields: { value: 'Blocks.ICE' } },
          x: { node_id: 'cx2', block_id: 'coord_x' },
          y: { node_id: 'cy2', block_id: 'coord_y' },
          z: { node_id: 'cz2', block_id: 'coord_z' },
        },
        next: 'spawn',
      },
      {
        node_id: 'spawn',
        block_id: 'spawn_entity',
        fields: { entity: 'EntityCreeper' },
        value_inputs: { x: { node_id: 'cx3', block_id: 'coord_x' }, y: { node_id: 'cy3', block_id: 'coord_y' }, z: { node_id: 'cz3', block_id: 'coord_z' } },
      },
    ],
  };
  const result = validate(doc);
  ok('NOT/block-compare/coord/block-place/entity-spawn as ordinary BlockNodes: 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('NOT/compare/coord/place/spawn: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
  }
}

// --- 10. Nesting well under MAX_NESTING_DEPTH (500) — e.g. 450 levels —
// must actually succeed (not just fail gracefully), confirming the limit
// isn't hit prematurely by a real stack overflow or off-by-one before the
// intentional guard. Lesson-9-scale procedures never approach this, but the
// user's own request asks to confirm the ceiling is high enough, not just
// that overflow is caught. ---
{
  function deepChain(depth) {
    let node = numNode('leaf', 1);
    for (let i = 0; i < depth; i += 1) {
      node = { node_id: `c${i}`, block_id: 'math_dual_ops', fields: { OP: 'ADD' }, value_inputs: { A: node, B: numNode(`c${i}b`, 1) } };
    }
    return node;
  }
  const doc = {
    format_version: 1,
    procedure_name: 'near_limit_nesting_test',
    variables: [{ name: 'v', type: 'number', scope: 'local', initial_value: 0 }],
    blocks: [setNum('set_v', 'v', deepChain(450))],
  };
  const result = validate(doc);
  ok('450-level nested formula (under MAX_NESTING_DEPTH=500): 0 errors, not a false-positive E012', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('450-level nesting: expected block count matches actual (real Blockly workspace, no crash)', expected === actual, `expected=${expected} actual=${actual}`);
  } else {
    fail('450-level nesting: expected a normalized result — MAX_NESTING_DEPTH may need raising for real Lesson-9-scale procedures');
  }
}

// --- 11. A wide (2,000 top-level nodes) procedure, well under
// MAX_TOP_LEVEL_BLOCKS (20,000), succeeds — Lesson-9-scale procedures are on
// the order of ~100 nodes, so this leaves generous headroom. ---
{
  const names = Array.from({ length: 2000 }, (_, i) => `n${i}`);
  const blocks = names.map((id) => ({ node_id: id, block_id: 'math_number', fields: { NUM: '1' } }));
  // math_number is shape=value; wrap the whole chain as value_inputs of a
  // single dummy statement so they're not all orphaned W005 roots (which
  // would still be 0 errors, but this exercises them as real connected
  // nodes instead, matching how a real large procedure would use them).
  const doc = {
    format_version: 1,
    procedure_name: 'wide_procedure_test',
    variables: [{ name: 'v', type: 'number', scope: 'local', initial_value: 0 }],
    blocks: [setNum('set_v', 'v', { node_id: 'sum_root', block_id: 'math_dual_ops', fields: { OP: 'ADD' }, value_inputs: { A: blocks[0], B: blocks[1] } }), ...blocks.slice(2)],
  };
  const result = validate(doc);
  ok('2,000 top-level blocks (under MAX_TOP_LEVEL_BLOCKS=20,000): 0 errors', result.ok, JSON.stringify(codes(result).slice(0, 5)));
}

// --- 12. Existing strict validation (E003 unknown block_id, E004 unknown
// input name) still fires correctly even deep inside a large nested
// structure — deep nesting must not weaken validation. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'deep_still_strict_test',
    blocks: [
      {
        node_id: 'root',
        block_id: 'controls_if',
        value_inputs: { IF0: { node_id: 'c', block_id: 'logic_boolean', fields: { BOOL: 'TRUE' } } },
        statement_inputs: {
          DO0: [
            {
              node_id: 'inner_if',
              block_id: 'controls_if',
              value_inputs: { IF0: { node_id: 'c2', block_id: 'logic_boolean', fields: { BOOL: 'TRUE' } } },
              statement_inputs: { DO0: [{ node_id: 'bad', block_id: 'this_block_does_not_exist' }] },
            },
          ],
        },
      },
    ],
  };
  const result = validate(doc);
  ok('unknown block_id 2 levels deep -> still E003', codes(result).includes('E003'), JSON.stringify(codes(result)));
}

// --- 13. sample_lesson9_trig_dome.json: the full combined scenario from
// the user's 14-point spec, round-tripped through a real Blockly workspace. ---
{
  const doc = JSON.parse(readFileSync(path.join(root, 'public/samples/sample_lesson9_trig_dome.json'), 'utf-8'));
  const result = validate(doc);
  ok('sample_lesson9_trig_dome.json: 0 errors', result.ok, JSON.stringify(codes(result)));
  ok('sample_lesson9_trig_dome.json: 0 warnings/info too (fully clean)', result.messages.length === 0, JSON.stringify(result.messages));
  if (result.ok && result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('sample_lesson9_trig_dome.json: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const types = new Set(workspace.getAllBlocks(false).map((b) => b.type));
    for (const t of ['controls_if', 'controls_repeat_ext', 'math_dual_ops', 'math_singular_ops', 'logic_negate', 'compare_blockstates', 'coord_x', 'coord_y', 'coord_z', 'block_add', 'spawn_entity', 'variables_get_number', 'variables_set_number']) {
      blocklyOk(`sample_lesson9_trig_dome.json: contains ${t}`, types.has(t), '');
    }
    const ops = new Set(workspace.getAllBlocks(false).filter((b) => b.type === 'math_singular_ops').map((b) => b.getFieldValue('OP')));
    blocklyOk('sample_lesson9_trig_dome.json: SIN/COS/ASIN/DEG2RAD/RAD2DEG all present', ['SIN', 'COS', 'ASIN', 'DEG2RAD', 'RAD2DEG'].every((op) => ops.has(op)), JSON.stringify([...ops]));
    const repeatCount = workspace.getAllBlocks(false).filter((b) => b.type === 'controls_repeat_ext').length;
    blocklyOk('sample_lesson9_trig_dome.json: 2 nested controls_repeat_ext (30-loop and 5-loop)', repeatCount === 2, String(repeatCount));
  } else {
    blocklyOk('sample_lesson9_trig_dome.json: validation must succeed first', false, JSON.stringify(codes(result)));
  }
}

console.log('');
console.log(`deep-nesting tests: ${failures + blocklyFailures} failure(s)`);
if (failures + blocklyFailures > 0) process.exit(1);
