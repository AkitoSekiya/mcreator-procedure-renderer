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

if (failures > 0) {
  console.error(`\nFAILED: ${failures} graph-format test(s) did not produce the expected result.`);
  process.exit(1);
} else {
  console.log('\nOK: all graph-format tests produced their expected result.');
}
