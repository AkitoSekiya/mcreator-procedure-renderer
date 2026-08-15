// Tests for the flat graph-format normalization layer added in SPEC.md v1.2
// (src/lib/normalizeInput.ts). Covers: node_id reference resolution,
// format_version normalization, missing/circular references, statement_inputs
// single-value wrapping, unreferenced value-block exclusion, multi-reference
// dedup, type/shape contradiction warnings, trigger-object dependency
// diffing, and the silent label->machine-value field conversion.
// Run with: npm run check-graph
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProcedure, validateProcedureText } from '../src/lib/validate.ts';
import { buildDropdownOptionsMap } from '../src/lib/dropdownOptions.ts';
import { procedureToXmlString } from '../src/blockly/toXml.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const full = JSON.parse(readFileSync(path.join(root, 'public/reference/blocks_full.json'), 'utf-8'));
const render = JSON.parse(readFileSync(path.join(root, 'public/reference/blocks_render.json'), 'utf-8'));
const dropdownOptions = buildDropdownOptionsMap(render);

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
  return validateProcedure(doc, full, dropdownOptions);
}

// --- 1. flat graph sample2-equivalent vs nested sample2: identical XML ---
{
  const nestedText = readFileSync(path.join(root, 'public/samples/sample2_if_else.json'), 'utf-8');
  const graphText = readFileSync(path.join(root, 'public/samples/sample4_graph.json'), 'utf-8');

  const nestedResult = validateProcedureText(nestedText, full, dropdownOptions);
  const graphResult = validateProcedureText(graphText, full, dropdownOptions);

  const nestedErrors = nestedResult.messages.filter((m) => m.severity === 'error');
  const graphErrors = graphResult.messages.filter((m) => m.severity === 'error');
  ok('graph-sample2-equivalent: nested form has 0 errors', nestedErrors.length === 0, JSON.stringify(nestedErrors));
  ok('graph-sample2-equivalent: graph form has 0 errors', graphErrors.length === 0, JSON.stringify(graphErrors));

  if (nestedResult.normalized && graphResult.normalized) {
    const nestedXml = procedureToXmlString(nestedResult.normalized);
    const graphXml = procedureToXmlString(graphResult.normalized);
    ok('graph-sample2-equivalent: rendered XML is identical', nestedXml === graphXml, nestedXml === graphXml ? '' : `nested=${nestedXml}\ngraph=${graphXml}`);
  } else {
    fail('graph-sample2-equivalent: one or both forms failed to normalize');
  }
}

// --- 2. format_version normalization ---
function trivialDoc(formatVersion) {
  return {
    format_version: formatVersion,
    procedure_name: 'fv_test',
    blocks: [{ node_id: 'n1', block_id: 'entity_from_deps' }],
  };
}
// entity_from_deps is shape=value with no references -> would be W005'd and
// excluded, but format_version is checked before any of that, so this alone
// is enough to test format_version acceptance/rejection via error presence.
for (const fv of ['1.0', 1, '1', 1.0]) {
  const result = validate(trivialDoc(fv));
  const hasE002 = result.messages.some((m) => m.code === 'E002');
  ok(`format_version ${JSON.stringify(fv)} accepted`, !hasE002, JSON.stringify(result.messages));
}
{
  const result = validate(trivialDoc(2));
  const hasE002 = result.messages.some((m) => m.code === 'E002');
  ok('format_version 2 rejected (E002)', hasE002, JSON.stringify(result.messages));
}

// --- 3. missing node_id reference -> E008 ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'missing_ref_test',
    blocks: [{ node_id: 'n1', block_id: 'controls_if', value_inputs: { IF0: 'does_not_exist' } }],
  };
  const result = validate(doc);
  ok('missing node_id reference -> E008', result.messages.some((m) => m.code === 'E008'), JSON.stringify(result.messages));
}

// --- 4. circular reference (A.next=B, B.next=A) -> E009 ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'cycle_test',
    blocks: [
      { node_id: 'A', block_id: 'entity_send_chat', next: 'B' },
      { node_id: 'B', block_id: 'entity_send_chat', next: 'A' },
    ],
  };
  const result = validate(doc);
  ok('circular next reference -> E009', result.messages.some((m) => m.code === 'E009'), JSON.stringify(result.messages));
}

// --- 5. statement_inputs single string wrapped into array ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'single_statement_input_test',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'controls_repeat_ext',
        value_inputs: { TIMES: 'n2' },
        statement_inputs: { DO: 'n3' }, // single string, not an array
      },
      { node_id: 'n2', block_id: 'math_number', fields: { NUM: '3' } },
      {
        node_id: 'n3',
        block_id: 'spawn_particle',
        fields: { particle: 'minecraft:heart' },
        value_inputs: { x: 'n4', y: 'n4', z: 'n4', xs: 'n2', ys: 'n2', zs: 'n2' },
      },
      { node_id: 'n4', block_id: 'coord_x' },
    ],
  };
  const result = validate(doc);
  const errors = result.messages.filter((m) => m.severity === 'error');
  ok('single-string statement_inputs value is wrapped into an array (0 errors)', errors.length === 0, JSON.stringify(errors));
  ok('single-string statement_inputs value actually attaches the node', !!result.normalized?.stacks[0]?.[0]?.statementInputs?.DO?.[0], 'DO should contain n3');
}

// --- 6. unreferenced value block -> W005, excluded from render XML ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'orphan_value_test',
    blocks: [
      { node_id: 'main', block_id: 'entity_send_chat', value_inputs: { text: 'txt', actbar: 'b', entity: 'e' } },
      { node_id: 'txt', block_id: 'text', fields: { TEXT: 'hi' } },
      { node_id: 'b', block_id: 'logic_boolean', fields: { BOOL: 'FALSE' } },
      { node_id: 'e', block_id: 'entity_from_deps' },
      // Never referenced by anyone:
      { node_id: 'orphan', block_id: 'math_number', fields: { NUM: '42' } },
    ],
  };
  const result = validate(doc);
  ok('unreferenced value block -> W005', result.messages.some((m) => m.code === 'W005' && m.nodeId === 'orphan'), JSON.stringify(result.messages));
  ok('unreferenced value block has 0 errors (rendering still proceeds)', result.ok, JSON.stringify(result.messages.filter((m) => m.severity === 'error')));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    ok('orphan value block is excluded from the render XML', !xml.includes('math_number'), xml);
  } else {
    fail('orphan-value-block test: expected a normalized result');
  }
}

// --- 7. multi-reference -> W006 ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'multi_ref_test',
    blocks: [
      { node_id: 'root1', block_id: 'entity_send_chat', value_inputs: { text: 'shared', actbar: 'b1', entity: 'e1' } },
      { node_id: 'root2', block_id: 'entity_send_chat', value_inputs: { text: 'shared', actbar: 'b2', entity: 'e2' } },
      { node_id: 'shared', block_id: 'text', fields: { TEXT: 'hi' } },
      { node_id: 'b1', block_id: 'logic_boolean', fields: { BOOL: 'FALSE' } },
      { node_id: 'b2', block_id: 'logic_boolean', fields: { BOOL: 'FALSE' } },
      { node_id: 'e1', block_id: 'entity_from_deps' },
      { node_id: 'e2', block_id: 'entity_from_deps' },
    ],
  };
  const result = validate(doc);
  ok('node referenced from two places -> W006', result.messages.some((m) => m.code === 'W006'), JSON.stringify(result.messages));
}

// --- 8. type contradicts resolved shape -> W007 ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'type_contradiction_test',
    blocks: [
      { node_id: 'n1', block_id: 'controls_if', value_inputs: { IF0: 'n2' } },
      // logic_boolean's actual shape is "value", not "statement".
      { node_id: 'n2', block_id: 'logic_boolean', type: 'statement', fields: { BOOL: 'TRUE' } },
    ],
  };
  const result = validate(doc);
  ok('type "statement" on a shape=value block -> W007', result.messages.some((m) => m.code === 'W007' && m.nodeId === 'n2'), JSON.stringify(result.messages));
}

// --- 9. trigger object dependencies fully covering requirements -> no W001 ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'trigger_deps_test',
    trigger: { type: 'onBlockRightClicked', dependencies: ['world:world'] },
    blocks: [
      {
        node_id: 'n1',
        block_id: 'strike_lightning',
        fields: { effectOnly: 'FALSE' },
        value_inputs: { x: 'x', y: 'y', z: 'z' },
      },
      { node_id: 'x', block_id: 'coord_x' },
      { node_id: 'y', block_id: 'coord_y' },
      { node_id: 'z', block_id: 'coord_z' },
    ],
  };
  const result = validate(doc);
  ok('trigger.dependencies covers required deps -> no W001', !result.messages.some((m) => m.code === 'W001'), JSON.stringify(result.messages));
}

// --- 10. label value for a dropdown field -> silently converted, 0 warnings ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'label_conversion_test',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'controls_if',
        value_inputs: { IF0: 'n2' },
      },
      {
        node_id: 'n2',
        block_id: 'math_binary_ops',
        fields: { OP: '=' }, // display label, not the machine value 'EQ'
        value_inputs: { A: 'a', B: 'b' },
      },
      { node_id: 'a', block_id: 'math_number', fields: { NUM: '1' } },
      { node_id: 'b', block_id: 'math_number', fields: { NUM: '1' } },
    ],
  };
  const result = validate(doc);
  ok('label value produces zero messages', result.messages.length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    ok('label value converted to machine value in XML', xml.includes('<field name="OP">EQ</field>'), xml);
  } else {
    fail('label-conversion test: expected a normalized result');
  }
}

// --- 11. legacy-mode compatibility: no string references anywhere ->
// multiple unreferenced statement roots auto-chain into ONE main sequence,
// in blocks-array order, with zero warnings (v1's public contract: "blocks
// array = one top-to-bottom main sequence"). No W004 in this mode.
{
  const doc = {
    format_version: 1,
    procedure_name: 'legacy_multi_root_test',
    blocks: [
      { node_id: 'n1', block_id: 'entity_send_chat' },
      { node_id: 'n2', block_id: 'entity_send_chat' },
    ],
  };
  const result = validate(doc);
  ok('legacy mode: two unreferenced roots, 0 errors', result.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(result.messages));
  ok('legacy mode: zero warnings (no W004)', result.messages.length === 0, JSON.stringify(result.messages));
  ok('legacy mode: detected as mode="legacy"', result.normalized?.mode === 'legacy', result.normalized?.mode);
  ok('legacy mode: exactly one stack', result.normalized?.stacks.length === 1, JSON.stringify(result.normalized?.stacks?.length));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    const blockCount = (xml.match(/<block type="entity_send_chat"/g) ?? []).length;
    ok('legacy mode: both blocks present in XML', blockCount === 2, xml);
    ok('legacy mode: the two blocks are <next>-chained', xml.includes('<next>'), xml);
  } else {
    fail('legacy-multi-root test: expected a normalized result');
  }
}

// --- 12. graph-mode preserved: string references present + two unreferenced
// statement roots -> still W004, and the XML has 2 independent top-level
// <block> groups (not chained together). Confirms the mode-detection rule
// doesn't regress the graph-format multi-stack behavior from rule 5. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'graph_multi_root_test',
    blocks: [
      { node_id: 'root1', block_id: 'entity_send_chat', value_inputs: { entity: 'e1' } },
      { node_id: 'e1', block_id: 'entity_from_deps' },
      { node_id: 'root2', block_id: 'entity_send_chat', value_inputs: { entity: 'e2' } },
      { node_id: 'e2', block_id: 'entity_from_deps' },
    ],
  };
  const result = validate(doc);
  ok('graph mode: detected as mode="graph"', result.normalized?.mode === 'graph', result.normalized?.mode);
  ok('graph mode: two unreferenced roots -> W004', result.messages.some((m) => m.code === 'W004'), JSON.stringify(result.messages));
  ok('graph mode: two independent stacks', result.normalized?.stacks.length === 2, JSON.stringify(result.normalized?.stacks?.length));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    const blockCount = (xml.match(/<block type="entity_send_chat"/g) ?? []).length;
    ok('graph mode: both roots present in XML as independent top-level blocks', blockCount === 2, xml);
    ok('graph mode: the second root is explicitly positioned (not stacked on the first)', /<block type="entity_send_chat" x="0" y="\d+">/.test(xml), xml);
  } else {
    fail('graph-multi-root test: expected a normalized result');
  }
}

// --- 13-18. Regression tests for the "next inside a nested statement_inputs
// slot gets silently dropped" bug: normalizeInput.ts's statement_inputs
// resolution loop only resolved each array element itself, without
// flattening that element's own next-chain into the array — so anything
// reachable only via .next from a statement_inputs entry (at any nesting
// depth: controls_if DO0/DO1/ELSE, repeat's DO, etc.) vanished from the
// normalized tree and never reached the render XML. Fixed by flattening each
// array element's next-chain (flattenNextChain) at resolution time, the same
// way the top-level root stacks already were. These mirror the top-level
// node_id-reference tests above but nest the equivalent structure one (or
// more) statement_inputs levels deep. ---
function boolNode(id) {
  return { node_id: id, block_id: 'logic_boolean', fields: { BOOL: 'TRUE' } };
}
function numNode(id) {
  return { node_id: id, block_id: 'math_number', fields: { NUM: '1' } };
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

// --- 13. Test A: next-chain nested inside statement_inputs (outer_if.DO0 =
// inner_if_1, inner_if_1.next = inner_if_2, inner_if_2.next = inner_if_3).
// All 3 inner ifs must survive and stay <next>-chained inside outer_if's DO0. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'nested_next_test_a',
    blocks: [
      { node_id: 'outer_if', block_id: 'controls_if', value_inputs: { IF0: boolNode('c0') }, statement_inputs: { DO0: ['inner_if_1'] } },
      { node_id: 'inner_if_1', block_id: 'controls_if', value_inputs: { IF0: boolNode('c1') }, next: 'inner_if_2' },
      { node_id: 'inner_if_2', block_id: 'controls_if', value_inputs: { IF0: boolNode('c2') }, next: 'inner_if_3' },
      { node_id: 'inner_if_3', block_id: 'controls_if', value_inputs: { IF0: boolNode('c3') } },
    ],
  };
  const result = validate(doc);
  const errors = result.messages.filter((m) => m.severity === 'error');
  ok('nested-next-A: 0 errors', errors.length === 0, JSON.stringify(errors));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    const count = (xml.match(/<block type="controls_if"/g) ?? []).length;
    ok('nested-next-A: all 4 controls_if blocks present (outer + 3 chained inner)', count === 4, xml);
    // 2 <next> links connect the 3 inner ifs (inner_if_1->2, inner_if_2->3);
    // outer_if->inner_if_1 itself is a <statement name="DO0"> connection, not <next>.
    ok('nested-next-A: inner ifs chained via <next> (not dropped)', (xml.match(/<next>/g) ?? []).length === 2, xml);
  } else {
    fail('nested-next-A: expected a normalized result');
  }
}

// --- 14. Test B: next-chain of plain statement blocks (not controls_if)
// nested inside a DO0 (inner_if.DO0 = spawn_1, spawn_1.next = spawn_2,
// spawn_2.next = spawn_3). All 3 must survive, in order. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'nested_next_test_b',
    blocks: [
      { node_id: 'inner_if', block_id: 'controls_if', value_inputs: { IF0: boolNode('c0') }, statement_inputs: { DO0: ['spawn_1'] } },
      spawnNode('spawn_1', { next: 'spawn_2' }),
      spawnNode('spawn_2', { next: 'spawn_3' }),
      spawnNode('spawn_3'),
    ],
  };
  const result = validate(doc);
  const errors = result.messages.filter((m) => m.severity === 'error');
  ok('nested-next-B: 0 errors', errors.length === 0, JSON.stringify(errors));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    const count = (xml.match(/<block type="spawn_entity"/g) ?? []).length;
    ok('nested-next-B: all 3 spawn_entity blocks present', count === 3, xml);
    // Each spawn_N carries its own node_id as the `entity` field text (no
    // surrounding quotes — it's element text content, not an XML attribute),
    // so plain substring search is enough to check ordering.
    const i1 = xml.indexOf('>spawn_1<');
    const i2 = xml.indexOf('>spawn_2<');
    const i3 = xml.indexOf('>spawn_3<');
    ok('nested-next-B: spawn_1/2/3 appear in document order in the XML', i1 >= 0 && i1 < i2 && i2 < i3, xml);
  } else {
    fail('nested-next-B: expected a normalized result');
  }
}

// --- 15. Test C: deep nesting mixing statement_inputs and next at multiple
// levels — outer_if.DO0 = inner_if; inner_if.DO0 = [spawn_1 -> next
// spawn_2]; inner_if.next = another_if; another_if.DO0 = spawn_3. Every
// node must survive with correct parent/next relationships. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'nested_next_test_c',
    blocks: [
      { node_id: 'outer_if', block_id: 'controls_if', value_inputs: { IF0: boolNode('c0') }, statement_inputs: { DO0: ['inner_if'] } },
      {
        node_id: 'inner_if',
        block_id: 'controls_if',
        value_inputs: { IF0: boolNode('c1') },
        statement_inputs: { DO0: ['spawn_1'] },
        next: 'another_if',
      },
      spawnNode('spawn_1', { next: 'spawn_2' }),
      spawnNode('spawn_2'),
      {
        node_id: 'another_if',
        block_id: 'controls_if',
        value_inputs: { IF0: boolNode('c2') },
        statement_inputs: { DO0: ['spawn_3'] },
      },
      spawnNode('spawn_3'),
    ],
  };
  const result = validate(doc);
  const errors = result.messages.filter((m) => m.severity === 'error');
  ok('nested-next-C: 0 errors', errors.length === 0, JSON.stringify(errors));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    const ifCount = (xml.match(/<block type="controls_if"/g) ?? []).length;
    const spawnCount = (xml.match(/<block type="spawn_entity"/g) ?? []).length;
    ok('nested-next-C: all 3 controls_if blocks present', ifCount === 3, xml);
    ok('nested-next-C: all 3 spawn_entity blocks present', spawnCount === 3, xml);
    // controls_if blocks carry no distinguishing text of their own, but each
    // spawn_N's node_id is round-tripped through its `entity` field text, so
    // ordering among the spawn blocks is directly checkable; combined with
    // the DO0/next tag counts below this pins down the full nested shape
    // (outer_if.DO0 -> inner_if.DO0 -> [spawn_1 -> next spawn_2],
    // inner_if.next -> another_if.DO0 -> spawn_3).
    const iSpawn1 = xml.indexOf('>spawn_1<');
    const iSpawn2 = xml.indexOf('>spawn_2<');
    const iSpawn3 = xml.indexOf('>spawn_3<');
    ok('nested-next-C: spawn_1/2/3 appear in document order in the XML', iSpawn1 >= 0 && iSpawn1 < iSpawn2 && iSpawn2 < iSpawn3, xml);
    const doCount = (xml.match(/<statement name="DO0">/g) ?? []).length;
    const nextCount = (xml.match(/<next>/g) ?? []).length;
    ok('nested-next-C: 3 DO0 statement slots used (outer, inner, another_if)', doCount === 3, xml);
    ok('nested-next-C: 2 next-chain links used (inner_if->another_if, spawn_1->spawn_2)', nextCount === 2, xml);
  } else {
    fail('nested-next-C: expected a normalized result');
  }
}

// --- 16. Test D: circular next reference (A.next=B, B.next=C, C.next=A) ->
// E009, does not infinite-loop. Extends the existing 2-node cycle test
// (above) to 3 nodes, matching the exact scenario called out for this fix. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'nested_next_test_d_cycle',
    blocks: [
      { node_id: 'A', block_id: 'entity_send_chat', next: 'B' },
      { node_id: 'B', block_id: 'entity_send_chat', next: 'C' },
      { node_id: 'C', block_id: 'entity_send_chat', next: 'A' },
    ],
  };
  const result = validate(doc);
  ok('nested-next-D: 3-node circular next reference -> E009', result.messages.some((m) => m.code === 'E009'), JSON.stringify(result.messages));
}

// --- 17. Test E: next reference to a non-existent node_id, from inside a
// statement_inputs-nested block -> E008 (not silently dropped). ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'nested_next_test_e_missing_ref',
    blocks: [
      { node_id: 'inner_if', block_id: 'controls_if', value_inputs: { IF0: boolNode('c0') }, statement_inputs: { DO0: ['spawn_1'] } },
      spawnNode('spawn_1', { next: 'missing_node' }),
    ],
  };
  const result = validate(doc);
  ok('nested-next-E: next to a missing node_id (nested) -> E008', result.messages.some((m) => m.code === 'E008'), JSON.stringify(result.messages));
}

// --- 18. Test F: the same node referenced from both statement_inputs (array
// position) and another node's next -> W006, and the existing precedence
// (value_inputs > statement_inputs > next) still wins: statement_inputs
// keeps the node, the competing next edge is the one cut. No duplicate
// block, no silent drop. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'nested_next_test_f_multi_ref',
    blocks: [
      { node_id: 'root', block_id: 'controls_if', value_inputs: { IF0: boolNode('c0') }, statement_inputs: { DO0: ['A', 'B'] } },
      spawnNode('A', { next: 'B' }),
      spawnNode('B'),
    ],
  };
  const result = validate(doc);
  const errors = result.messages.filter((m) => m.severity === 'error');
  ok('nested-next-F: 0 errors', errors.length === 0, JSON.stringify(errors));
  const w006 = result.messages.find((m) => m.code === 'W006');
  ok('nested-next-F: multi-reference (statement_inputs + next) -> W006', !!w006, JSON.stringify(result.messages));
  ok('nested-next-F: precedence unchanged (next edge is the one cut, not statement_inputs)', !!w006 && w006.message.includes('next'), w006 && w006.message);
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    const count = (xml.match(/<block type="spawn_entity"/g) ?? []).length;
    ok('nested-next-F: node B appears exactly once (no duplicate connection)', count === 2, xml);
  } else {
    fail('nested-next-F: expected a normalized result');
  }
}

// --- 19-21. Regression tests for the "call_procedure's procedure name field
// renders blank" bug: blocks_full.json (validation source of truth)
// deliberately catalogues call_procedure's "which procedure" field under the
// empty name "" (that's MCreator's own js-imperative source data, not a
// mistake — see README/validate.ts's DYNAMIC_FIELD_PATTERNS comment), but
// the *real* Blockly block registered from blocks_render.json names that
// field "procedure". toXml.ts was emitting `<field name="">...</field>`
// verbatim, which Blockly's XML loader can't match to any field on the real
// block, so the procedure name silently failed to apply. Fixed in
// src/blockly/toXml.ts's fieldsXml via a per-block-id field-name override
// table (FIELD_NAME_XML_OVERRIDES), applied only at the render boundary —
// normalizeInput.ts/validate.ts are untouched and still treat "" as the
// canonical, correct field name per blocks_full.json/README. ---

// --- 19. Test 1: fields: {"": "JamMake"} on call_procedure -> 0 errors,
// renders, and the XML carries the procedure name under Blockly's real
// field name ("procedure"), not the validation-only empty name. ---
{
  const doc = {
    format_version: 1,
    mcreator_version: '2025.1',
    procedure_name: 'test',
    blocks: [{ node_id: 'n1', block_id: 'call_procedure', fields: { '': 'JamMake' } }],
  };
  const result = validate(doc);
  const errorCodes = result.messages.filter((m) => m.severity === 'error').map((m) => m.code);
  ok('call_procedure-1: no E003/E004/E005 (or any error)', errorCodes.length === 0, JSON.stringify(result.messages));
  ok('call_procedure-1: validates ok, normalized result present', result.ok && !!result.normalized, JSON.stringify(result.messages));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    ok('call_procedure-1: call_procedure block present in XML', xml.includes('<block type="call_procedure">'), xml);
    ok(
      'call_procedure-1: procedure name rendered under Blockly\'s real field name "procedure"',
      xml.includes('<field name="procedure">JamMake</field>'),
      xml,
    );
    ok('call_procedure-1: no literal empty field name leaked into the XML', !xml.includes('<field name="">'), xml);
  } else {
    fail('call_procedure-1: expected a normalized result');
  }
}

// --- 20. Test 2: same shape, different procedure name (TestProcedure) ---
{
  const doc = {
    format_version: 1,
    mcreator_version: '2025.1',
    procedure_name: 'test',
    blocks: [{ node_id: 'n1', block_id: 'call_procedure', fields: { '': 'TestProcedure' } }],
  };
  const result = validate(doc);
  const errorCodes = result.messages.filter((m) => m.severity === 'error').map((m) => m.code);
  ok('call_procedure-2: no errors', errorCodes.length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    ok('call_procedure-2: procedure name rendered correctly', xml.includes('<field name="procedure">TestProcedure</field>'), xml);
  } else {
    fail('call_procedure-2: expected a normalized result');
  }
}

// --- 21. Test 3: existing ordinary-field blocks are unaffected — the
// call_procedure-only override table must not touch any other block_id's
// field names (including a block whose field happens to share a name with
// something in the override table would still need block_id-scoping, but
// simplest direct check: a normal named field renders under its own name
// unchanged, for both a non-call_procedure block and call_procedure's own
// non-"" dynamic fields like "name0"). ---
{
  // spawn_entity is a statement-shape root (unlike a bare value block, it
  // won't be W005-excluded) and its own field_data_list_selector field
  // ("entity") happens to be the same field *type* as call_procedure's, but
  // a different, non-empty name — confirms the override table is keyed by
  // block_id, not by field type, and never touches this field.
  const doc = {
    format_version: 1,
    procedure_name: 'ordinary_field_test',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'spawn_entity',
        fields: { entity: 'minecraft:zombie' },
        value_inputs: {
          x: { node_id: 'x', block_id: 'math_number', fields: { NUM: '1' } },
          y: { node_id: 'y', block_id: 'math_number', fields: { NUM: '1' } },
          z: { node_id: 'z', block_id: 'math_number', fields: { NUM: '1' } },
        },
      },
    ],
  };
  const result = validate(doc);
  ok('call_procedure-3: ordinary block (spawn_entity.entity) still 0 errors', result.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    ok('call_procedure-3: ordinary field name is untouched by the call_procedure override', xml.includes('<field name="entity">minecraft:zombie</field>'), xml);
  } else {
    fail('call_procedure-3: expected a normalized result');
  }
}
{
  // call_procedure's dynamic "nameN" argument-name fields (README/SPEC's
  // documented mutator-added names) must pass through unmapped — only the
  // validation-only "" name gets remapped to "procedure".
  const doc = {
    format_version: 1,
    procedure_name: 'call_procedure_dynamic_field_test',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'call_procedure',
        fields: { '': 'WithArgs', name0: 'firstArg' },
        value_inputs: { arg0: { node_id: 'n2', block_id: 'math_number', fields: { NUM: '1' } } },
      },
    ],
  };
  const result = validate(doc);
  ok('call_procedure-3: dynamic name0/arg0 fields still 0 errors', result.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    ok('call_procedure-3: "" -> "procedure" remapped', xml.includes('<field name="procedure">WithArgs</field>'), xml);
    ok('call_procedure-3: dynamic "name0" field left unmapped', xml.includes('<field name="name0">firstArg</field>'), xml);
  } else {
    fail('call_procedure-3: expected a normalized result (dynamic fields)');
  }
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} graph-format test(s) did not produce the expected result.`);
  process.exit(1);
} else {
  console.log('\nOK: all graph-format tests produced their expected result.');
}
