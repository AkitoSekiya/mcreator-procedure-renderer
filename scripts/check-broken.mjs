// Mechanical tests for the 3 "broken input" cases required by SPEC.md §9-4:
// unknown block_id -> E003, unknown input name -> E004, type mismatch -> E006.
// Also covers the machine-value-vs-display-label fix: blocks_full.json's
// fields[].options are, for many blocks, *display labels* (e.g.
// math_binary_ops.OP: "=","≠","<"...), not the machine values Blockly's XML
// actually needs ("EQ","NEQ","LT"...). validate.ts checks against the real
// machine values sourced from blocks_render.json (see
// src/lib/dropdownOptions.ts) and auto-converts a label to its machine value.
//
// SPEC.md v1.2 rule 9 changed label auto-conversion from "warn (W002) and
// convert" to "silently convert, no message at all" — so the
// math_binary_ops-label-value case below now asserts *zero* messages (it
// previously asserted W002). This is a deliberate, task-authorized test
// expectation update, not a regression: only truly-unknown values (matching
// neither a machine value nor a label) still produce W002.
// Run with: npm run check-broken
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProcedure } from '../src/lib/validate.ts';
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

function expectCode(name, doc, expectedCode) {
  const result = validateProcedure(doc, full, dropdownOptions);
  const codes = result.messages.map((m) => m.code);
  const found = codes.includes(expectedCode);
  console.log(`${name}: expected ${expectedCode} -> ${found ? 'OK' : 'MISSING'} (codes: ${codes.join(',') || '(none)'})`);
  if (!found) fail(`${name}: expected code ${expectedCode} not found`);
  return result;
}

function expectNoMessages(name, doc) {
  const result = validateProcedure(doc, full, dropdownOptions);
  const ok = result.messages.length === 0;
  console.log(
    `${name}: expected 0 messages -> ${ok ? 'OK' : 'FAIL'} (got: ${result.messages.map((m) => `${m.severity}:${m.code}`).join(',') || '(none)'})`,
  );
  if (!ok) fail(`${name}: expected zero messages but got ${JSON.stringify(result.messages)}`);
  return result;
}

// E003: block_id not present in blocks_full.json.
expectCode(
  'unknown-block-id',
  {
    format_version: 1,
    procedure_name: 'broken_unknown_block',
    blocks: [{ node_id: 'n1', block_id: 'this_block_id_does_not_exist' }],
  },
  'E003',
);

// E004: value_inputs key not declared on a known block (entity_send_chat has
// text/actbar/entity, not this).
expectCode(
  'unknown-input-name',
  {
    format_version: 1,
    procedure_name: 'broken_unknown_input',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'entity_send_chat',
        value_inputs: {
          not_a_real_input_name: { node_id: 'n2', block_id: 'text', fields: { TEXT: 'hi' } },
        },
      },
    ],
  },
  'E004',
);

// E006: type mismatch. controls_if's IF0 requires Boolean; coord_x outputs Number.
expectCode(
  'type-mismatch',
  {
    format_version: 1,
    procedure_name: 'broken_type_mismatch',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'controls_if',
        value_inputs: {
          IF0: { node_id: 'n2', block_id: 'coord_x' },
        },
      },
    ],
  },
  'E006',
);

// --- W002 machine-value-vs-label fix ---

function docWithBinaryOp(opValue) {
  return {
    format_version: 1,
    procedure_name: 'binary_op_test',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'controls_if',
        value_inputs: {
          IF0: {
            node_id: 'n2',
            block_id: 'math_binary_ops',
            fields: { OP: opValue },
            value_inputs: {
              A: { node_id: 'n3', block_id: 'math_number', fields: { NUM: '1' } },
              B: { node_id: 'n4', block_id: 'math_number', fields: { NUM: '1' } },
            },
          },
        },
      },
    ],
  };
}

// math_binary_ops.OP = 'EQ' (correct machine value) -> zero warnings.
expectNoMessages('math_binary_ops-machine-value', docWithBinaryOp('EQ'));

// math_binary_ops.OP = '=' (display label, per blocks_full.json's options) ->
// SPEC v1.2 rule 9: silent auto-conversion, zero messages, but the value
// must still be converted to 'EQ' in the render XML.
{
  const result = expectNoMessages('math_binary_ops-label-value', docWithBinaryOp('='));
  if (result.ok && result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    const hasConvertedField = xml.includes('<field name="OP">EQ</field>');
    console.log(`  XML auto-converted '=' -> 'EQ': ${hasConvertedField ? 'OK' : 'FAIL'}`);
    if (!hasConvertedField) fail(`math_binary_ops-label-value: XML did not contain converted field, got: ${xml}`);
  } else {
    fail('math_binary_ops-label-value: expected result.ok with a normalized procedure (W002 is a warning, not an error)');
  }
}

// math_binary_ops.OP = 'XXX' (neither machine value nor label) -> W002.
expectCode('math_binary_ops-unknown-value', docWithBinaryOp('XXX'), 'W002');

// logic_boolean.BOOL = 'false' (lowercase; blocks_full.json declares this
// exact string as a valid option, but Blockly's real builtin block only
// accepts 'TRUE'/'FALSE') -> zero warnings, and renders as 'FALSE' in XML.
{
  const doc = {
    format_version: 1,
    procedure_name: 'logic_boolean_case_test',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'entity_send_chat',
        value_inputs: {
          text: { node_id: 'n2', block_id: 'text', fields: { TEXT: 'hi' } },
          actbar: { node_id: 'n3', block_id: 'logic_boolean', fields: { BOOL: 'false' } },
          entity: { node_id: 'n4', block_id: 'entity_from_deps' },
        },
      },
    ],
  };
  const result = expectNoMessages('logic_boolean-lowercase-false', doc);
  if (result.ok && result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    const hasField = xml.includes('<field name="BOOL">FALSE</field>');
    console.log(`  XML normalized 'false' -> 'FALSE': ${hasField ? 'OK' : 'FAIL'}`);
    if (!hasField) fail(`logic_boolean-lowercase-false: XML did not contain normalized field, got: ${xml}`);
  } else {
    fail('logic_boolean-lowercase-false: expected result.ok with a normalized procedure');
  }
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} broken-input test(s) did not produce the expected result.`);
  process.exit(1);
} else {
  console.log('\nOK: all broken-input tests produced their expected result.');
}
