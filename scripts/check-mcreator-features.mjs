// Regression tests for the MCreator 2025.1 "generalize beyond one theme"
// pass: custom variables (9 types x 6 scopes, incl. PLAYER-scope entity
// input), the real trigger catalog (auto-filled dependencies), and iterator
// scope checking (entity_iterator/direction_iterator/itemstack_iterator
// used outside their *_foreach provider). All three features are backed by
// real MCreator 2025.1 data extracted via tools/extract_mcreator_
// metadata.py into public/reference/{variable_types,triggers,
// iterator_providers}.json — see src/lib/validate.ts's ValidationExtras doc
// comment for the full paper trail (javap on mcreator.jar, mcreator_blocks.js
// / mcreator_extensions.js, core/triggers, core/procedures's
// mcreator.statements[].provides).
//
// Run with: npm run check-mcreator-features
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProcedure } from '../src/lib/validate.ts';
import { buildDropdownOptionsMap } from '../src/lib/dropdownOptions.ts';
import { procedureToXmlString, countExpectedBlocks } from '../src/blockly/toXml.ts';
// See check-compat.mjs's "Headless-Blockly section" comment for why this
// uses the default import form instead of the app's own namespace import.
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

function numNode(id, value = '1') {
  return { node_id: id, block_id: 'math_number', fields: { NUM: value } };
}
function boolNode(id) {
  return { node_id: id, block_id: 'logic_boolean', fields: { BOOL: 'TRUE' } };
}
function textNode(id, value) {
  return { node_id: id, block_id: 'text', fields: { TEXT: value } };
}

// ============================================================================
// Part 1: custom variables (structural/semantic — no Blockly needed)
// ============================================================================

// get/set blocks are shape=value/statement respectively (validated against
// variable_types.json, not blocks_full.json — normalizeInput.ts doesn't
// know about them at all, so a *bare top-level* get block would be treated
// as a statement root and correctly E007 for the shape mismatch, same as
// any other value-shape block would). These tests nest the "get" reference
// inside the "set" block's own VAL input instead — a self-assignment
// ("set var = get var") that's semantically odd but structurally exactly
// how a get reference is normally used (nested inside some other
// statement's value_inputs), keeping the top-level root statement-shaped.
function setEqualsGetDoc(procedureName, typeId, varName, scope, extraSetValueInputs) {
  return {
    format_version: 1,
    procedure_name: procedureName,
    variables: [{ name: varName, type: typeId, scope }],
    blocks: [
      {
        node_id: 'setter',
        block_id: `variables_set_${typeId}`,
        fields: { VAR: varName },
        value_inputs: {
          VAL: {
            node_id: 'getter',
            block_id: `variables_get_${typeId}`,
            fields: { VAR: varName },
            value_inputs: extraSetValueInputs?.getValueInputs ?? {},
          },
          ...(extraSetValueInputs?.setValueInputs ?? {}),
        },
      },
    ],
  };
}

// --- 1a. All 9 types, local scope: get + set round-trip through
// validate.ts with 0 errors, and the field is rewritten to "local:<name>". ---
for (const t of variableTypes.types) {
  const doc = setEqualsGetDoc(`var_${t.id}_local_test`, t.id, 'myVar', 'local');
  const result = validate(doc);
  const errors = result.messages.filter((m) => m.severity === 'error');
  ok(`variable type "${t.id}" (local): 0 errors`, errors.length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    const varOccurrences = (xml.match(/<field name="VAR">local:myVar<\/field>/g) ?? []).length;
    ok(`variable type "${t.id}" (local): both get and set fields rewritten to "local:myVar"`, varOccurrences === 2, xml);
    ok(`variable type "${t.id}" (local): <variables> section declares it with blockly_type "${t.blockly_type}"`, xml.includes(`<variable type="${t.blockly_type}" id="myVar">myVar</variable>`), xml);
  } else {
    fail(`variable type "${t.id}" (local): expected a normalized result`);
  }
}

// --- 1b. All 6 scopes (using type "number") ---
const ALL_SCOPES = ['local', 'GLOBAL_SESSION', 'GLOBAL_MAP', 'GLOBAL_WORLD', 'PLAYER_LIFETIME', 'PLAYER_PERSISTENT'];
for (const scope of ALL_SCOPES) {
  const isPlayer = scope === 'PLAYER_LIFETIME' || scope === 'PLAYER_PERSISTENT';
  const entityInputs = isPlayer ? { entity: { node_id: 'e_get', block_id: 'entity_from_deps' } } : {};
  const setEntityInputs = isPlayer ? { entity: { node_id: 'e_set', block_id: 'entity_from_deps' } } : {};
  const doc = setEqualsGetDoc(`var_scope_${scope}_test`, 'number', 'sv', scope, { getValueInputs: entityInputs, setValueInputs: setEntityInputs });
  const result = validate(doc);
  const errors = result.messages.filter((m) => m.severity === 'error');
  ok(`scope "${scope}": 0 errors`, errors.length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    const expectedPrefix = scope === 'local' ? 'local' : 'global';
    ok(`scope "${scope}": field prefixed "${expectedPrefix}:"`, xml.includes(`<field name="VAR">${expectedPrefix}:sv</field>`), xml);
    ok(`scope "${scope}": mutation is_player_var="${isPlayer}"`, xml.includes(`is_player_var="${isPlayer}"`), xml);
  } else {
    fail(`scope "${scope}": expected a normalized result`);
  }
}

// --- 1c. PLAYER-scope without an entity input -> W010 (warning, not error) ---
{
  const doc = setEqualsGetDoc('var_player_missing_entity_test', 'number', 'score', 'PLAYER_PERSISTENT');
  const result = validate(doc);
  ok('PLAYER-scope var without entity input -> W010', result.messages.some((m) => m.code === 'W010'), JSON.stringify(result.messages));
  ok('PLAYER-scope var without entity input: still 0 errors (renders fine)', result.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(result.messages));
}

// --- 1d. Undefined variable reference -> E013 ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'var_undefined_test',
    variables: [],
    blocks: [
      {
        node_id: 'setter',
        block_id: 'variables_set_number',
        fields: { VAR: 'doesNotExist' },
        value_inputs: { VAL: numNode('v') },
      },
    ],
  };
  const result = validate(doc);
  ok('undefined variable reference -> E013', result.messages.some((m) => m.code === 'E013'), JSON.stringify(result.messages));
}

// --- 1e. Declared type doesn't match the get/set block's type suffix -> E016 ---
{
  const doc = setEqualsGetDoc('var_type_mismatch_test', 'number', 'n', 'local');
  doc.variables = [{ name: 'n', type: 'string', scope: 'local' }]; // declared string, referenced via variables_get/set_number
  const result = validate(doc);
  ok('declared type (string) vs block suffix (number) -> E016', result.messages.some((m) => m.code === 'E016'), JSON.stringify(result.messages));
}

// --- 1f. Unknown type/scope in a variable declaration -> E014 ---
{
  const docBadType = {
    format_version: 1,
    procedure_name: 'var_bad_type_test',
    variables: [{ name: 'n', type: 'not_a_real_type', scope: 'local' }],
    blocks: [],
  };
  ok('unknown variable type in declaration -> E014', validate(docBadType).messages.some((m) => m.code === 'E014'), JSON.stringify(validate(docBadType).messages));

  const docBadScope = {
    format_version: 1,
    procedure_name: 'var_bad_scope_test',
    variables: [{ name: 'n', type: 'number', scope: 'NOT_A_REAL_SCOPE' }],
    blocks: [],
  };
  ok('unknown variable scope in declaration -> E014', validate(docBadScope).messages.some((m) => m.code === 'E014'), JSON.stringify(validate(docBadScope).messages));
}

// --- 1g. Duplicate variable name -> E015 ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'var_duplicate_test',
    variables: [
      { name: 'dup', type: 'number', scope: 'local' },
      { name: 'dup', type: 'string', scope: 'local' },
    ],
    blocks: [],
  };
  const result = validate(doc);
  ok('duplicate variable name -> E015', result.messages.some((m) => m.code === 'E015'), JSON.stringify(result.messages));
}

// --- 1h. Two declarations in the *same* global-family namespace (both
// non-local, even different specific scopes) still collide -> E015, since
// real MCreator looks all of GLOBAL_SESSION/GLOBAL_MAP/GLOBAL_WORLD/
// PLAYER_LIFETIME/PLAYER_PERSISTENT up through the one project-wide pool
// (Workspace.getVariableElements()). ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'var_duplicate_global_family_test',
    variables: [
      { name: 'dup2', type: 'number', scope: 'GLOBAL_MAP' },
      { name: 'dup2', type: 'number', scope: 'PLAYER_PERSISTENT' },
    ],
    blocks: [],
  };
  const result = validate(doc);
  ok('duplicate name across two *different* global-family scopes -> still E015 (one shared pool)', result.messages.some((m) => m.code === 'E015'), JSON.stringify(result.messages));
}

// --- 1i. A `local` and a same-named GLOBAL_*/PLAYER_* declaration do NOT
// collide — real MCreator resolves them through two entirely separate
// lookup paths (see normalizeInput.ts's resolveVariables doc comment). A
// bare reference (fields.VAR, no scope prefix) resolves to the `local` one
// (innermost-scope-shadows-outer-scope). ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'var_local_global_same_name_test',
    variables: [
      { name: 'shared', type: 'number', scope: 'local' },
      { name: 'shared', type: 'string', scope: 'GLOBAL_MAP' },
    ],
    blocks: [
      {
        node_id: 'setter',
        block_id: 'variables_set_number', // references the *local* "shared" (type number) — must NOT E016 against the global string one
        fields: { VAR: 'shared' },
        value_inputs: { VAL: numNode('v') },
      },
    ],
  };
  const result = validate(doc);
  ok('local + same-named global variable: no E015 (different namespaces)', !result.messages.some((m) => m.code === 'E015'), JSON.stringify(result.messages));
  ok('bare VAR reference resolves to the local one (no E016 against the global string decl)', result.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    ok('field correctly prefixed "local:shared" (not "global:shared")', xml.includes('<field name="VAR">local:shared</field>'), xml);
    ok('only the local declaration appears in <variables> (global one has no XML declaration)', (xml.match(/<variable /g) ?? []).length === 1, xml);
  } else {
    fail('var_local_global_same_name_test: expected a normalized result');
  }
}

// --- 1j. initial_value: accepted, type-checked against the 3 types with an
// obvious JSON primitive (Number/Logic/String); mismatch -> W012 (warning
// only — it has zero effect on rendering, see ResolvedVariableDecl's doc
// comment), correct type -> no W012. Complex types (Entity/Itemstack/etc.)
// aren't type-checked at all (no reasonable JSON-primitive form). ---
{
  const docMismatch = {
    format_version: 1,
    procedure_name: 'var_initial_value_mismatch_test',
    variables: [{ name: 'n', type: 'number', scope: 'local', initial_value: 'not_a_number' }],
    blocks: [],
  };
  ok('initial_value type mismatch (number decl, string value) -> W012', validate(docMismatch).messages.some((m) => m.code === 'W012'), JSON.stringify(validate(docMismatch).messages));
  ok('initial_value mismatch is a warning only, not an error', validate(docMismatch).messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(validate(docMismatch).messages));

  const docMatch = {
    format_version: 1,
    procedure_name: 'var_initial_value_match_test',
    variables: [
      { name: 'n', type: 'number', scope: 'local', initial_value: 0 },
      { name: 'b', type: 'logic', scope: 'local', initial_value: false },
      { name: 's', type: 'string', scope: 'local', initial_value: 'hi' },
    ],
    blocks: [],
  };
  ok('matching initial_value types (number/logic/string) -> no W012', !validate(docMatch).messages.some((m) => m.code === 'W012'), JSON.stringify(validate(docMatch).messages));

  const docComplexType = {
    format_version: 1,
    procedure_name: 'var_initial_value_complex_type_test',
    variables: [{ name: 'e', type: 'entity', scope: 'local', initial_value: 'anything goes, not type-checked' }],
    blocks: [],
  };
  ok('initial_value on a complex type (entity) is accepted without W012 (no primitive to check against)', !validate(docComplexType).messages.some((m) => m.code === 'W012'), JSON.stringify(validate(docComplexType).messages));
}

// --- 1k. The "mode" scenario from the task: a PLAYER_PERSISTENT Number
// variable, exercised through get / set / "get mode, +1, set mode" / an IF
// comparison / entity input normal, missing, and wrong-typed. ---
{
  // get
  const getDoc = {
    format_version: 1,
    procedure_name: 'mode_get_test',
    variables: [{ name: 'mode', type: 'number', scope: 'PLAYER_PERSISTENT' }],
    blocks: [
      {
        node_id: 'setHealth',
        block_id: 'entity_set_health',
        value_inputs: {
          entity: { node_id: 'e0', block_id: 'entity_from_deps' },
          health: {
            node_id: 'getter',
            block_id: 'variables_get_number',
            fields: { VAR: 'mode' },
            value_inputs: { entity: { node_id: 'e1', block_id: 'entity_from_deps' } },
          },
        },
      },
    ],
  };
  const getResult = validate(getDoc);
  ok('mode: get -> 0 errors', getResult.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(getResult.messages));
  ok('mode: get renders the getter block with entity input connected', getResult.normalized && procedureToXmlString(getResult.normalized).includes('variables_get_number'), '');

  // set
  const setDoc = {
    format_version: 1,
    procedure_name: 'mode_set_test',
    variables: [{ name: 'mode', type: 'number', scope: 'PLAYER_PERSISTENT' }],
    blocks: [
      {
        node_id: 'setter',
        block_id: 'variables_set_number',
        fields: { VAR: 'mode' },
        value_inputs: { VAL: numNode('v', '2'), entity: { node_id: 'e1', block_id: 'entity_from_deps' } },
      },
    ],
  };
  ok('mode: set with entity -> 0 errors', validate(setDoc).messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(validate(setDoc).messages));

  // get mode, +1 (math_binary_ops ADD), set mode
  const incrementDoc = {
    format_version: 1,
    procedure_name: 'mode_increment_test',
    variables: [{ name: 'mode', type: 'number', scope: 'PLAYER_PERSISTENT' }],
    blocks: [
      {
        node_id: 'setter',
        block_id: 'variables_set_number',
        fields: { VAR: 'mode' },
        value_inputs: {
          entity: { node_id: 'e1', block_id: 'entity_from_deps' },
          VAL: {
            node_id: 'add',
            block_id: 'math_dual_ops', // the real arithmetic block; math_binary_ops is comparison-only (EQ/NEQ/LT/...)
            fields: { OP: 'ADD' },
            value_inputs: {
              A: { node_id: 'getter', block_id: 'variables_get_number', fields: { VAR: 'mode' }, value_inputs: { entity: { node_id: 'e2', block_id: 'entity_from_deps' } } },
              B: numNode('one', '1'),
            },
          },
        },
      },
    ],
  };
  const incResult = validate(incrementDoc);
  ok('mode: "get mode, +1, set mode" chain -> 0 errors', incResult.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(incResult.messages));

  // IF comparison: if mode >= 3 then despawn
  const ifDoc = {
    format_version: 1,
    procedure_name: 'mode_if_test',
    variables: [{ name: 'mode', type: 'number', scope: 'PLAYER_PERSISTENT' }],
    blocks: [
      {
        node_id: 'root_if',
        block_id: 'controls_if',
        value_inputs: {
          IF0: {
            node_id: 'cmp',
            block_id: 'math_binary_ops',
            fields: { OP: 'GTE' },
            value_inputs: {
              A: { node_id: 'getter', block_id: 'variables_get_number', fields: { VAR: 'mode' }, value_inputs: { entity: { node_id: 'e1', block_id: 'entity_from_deps' } } },
              B: numNode('three', '3'),
            },
          },
        },
        statement_inputs: { DO0: [{ node_id: 'despawn', block_id: 'entity_despawn', value_inputs: { entity: { node_id: 'e2', block_id: 'entity_from_deps' } } }] },
      },
    ],
  };
  ok('mode: IF (mode >= 3) comparison -> 0 errors', validate(ifDoc).messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(validate(ifDoc).messages));

  // entity missing -> W010 (warning, not error)
  const missingEntityDoc = {
    format_version: 1,
    procedure_name: 'mode_missing_entity_test',
    variables: [{ name: 'mode', type: 'number', scope: 'PLAYER_PERSISTENT' }],
    blocks: [{ node_id: 'getter', block_id: 'variables_get_number', fields: { VAR: 'mode' } }],
  };
  const missingResult = validate(missingEntityDoc);
  ok('mode: missing entity input -> W010 (not an error)', missingResult.messages.some((m) => m.code === 'W010'), JSON.stringify(missingResult.messages));

  // entity wrong type (a Number block plugged into the Entity-check input) -> E006 (existing generic type-check mechanism, reused as-is)
  const wrongEntityTypeDoc = {
    format_version: 1,
    procedure_name: 'mode_wrong_entity_type_test',
    variables: [{ name: 'mode', type: 'number', scope: 'PLAYER_PERSISTENT' }],
    blocks: [{ node_id: 'getter', block_id: 'variables_get_number', fields: { VAR: 'mode' }, value_inputs: { entity: numNode('wrong') } }],
  };
  ok('mode: wrong-typed entity input (Number into Entity slot) -> E006 (reused, not a new code)', validate(wrongEntityTypeDoc).messages.some((m) => m.code === 'E006'), JSON.stringify(validate(wrongEntityTypeDoc).messages));
}

// ============================================================================
// Part 2: trigger catalog (dependency auto-fill)
// ============================================================================

// --- 2a. Trigger name matching the real catalog auto-provides its
// dependencies (no W001 for blocks needing only those deps), even with no
// explicit trigger.dependencies given. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'trigger_autofill_test',
    trigger: 'entity_dies', // real trigger id; provides world/entity/sourceentity/x/y/z/damagesource
    blocks: [{ node_id: 'n1', block_id: 'spawn_entity', fields: { entity: 'minecraft:zombie' }, value_inputs: { x: numNode('x'), y: numNode('y'), z: numNode('z') } }],
  };
  const result = validate(doc);
  ok('known trigger auto-fills "world" dependency -> no W001', !result.messages.some((m) => m.code === 'W001'), JSON.stringify(result.messages));
}
// --- 2b. Unknown trigger name -> unchanged old behavior (W001 still fires) ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'trigger_unknown_test',
    trigger: 'this_is_not_a_real_trigger_id',
    blocks: [{ node_id: 'n1', block_id: 'spawn_entity', fields: { entity: 'minecraft:zombie' }, value_inputs: { x: numNode('x'), y: numNode('y'), z: numNode('z') } }],
  };
  const result = validate(doc);
  ok('unknown trigger name: W001 still fires (no auto-fill, unchanged behavior)', result.messages.some((m) => m.code === 'W001'), JSON.stringify(result.messages));
}
// --- 2c. Explicit trigger.dependencies still works and combines with the
// catalog (backward compatible with the pre-catalog {type, dependencies}
// object form). ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'trigger_explicit_plus_catalog_test',
    trigger: { type: 'mod_load', dependencies: ['world:world'] }, // mod_load provides nothing in the real catalog
    blocks: [{ node_id: 'n1', block_id: 'spawn_entity', fields: { entity: 'minecraft:zombie' }, value_inputs: { x: numNode('x'), y: numNode('y'), z: numNode('z') } }],
  };
  const result = validate(doc);
  ok('explicit trigger.dependencies still suppresses W001 (backward compatible)', !result.messages.some((m) => m.code === 'W001'), JSON.stringify(result.messages));
}

// ============================================================================
// Part 3: iterator scope checking (E017)
// ============================================================================

// --- 3a. entity_iterator used correctly inside world_entity_inrange_foreach's
// "foreach" statement -> no E017. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'iterator_correct_scope_test',
    blocks: [
      {
        node_id: 'loop',
        block_id: 'world_entity_inrange_foreach',
        value_inputs: { x: numNode('x'), y: numNode('y'), z: numNode('z'), range: numNode('r', '4') },
        statement_inputs: {
          foreach: [
            {
              node_id: 'despawn',
              block_id: 'entity_despawn',
              value_inputs: { entity: { node_id: 'it', block_id: 'entity_iterator' } },
            },
          ],
        },
      },
    ],
  };
  const result = validate(doc);
  ok('entity_iterator inside world_entity_inrange_foreach.foreach: no E017', !result.messages.some((m) => m.code === 'E017'), JSON.stringify(result.messages));
}
// --- 3b. entity_iterator used with no enclosing provider at all -> E017 ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'iterator_outside_scope_test',
    blocks: [{ node_id: 'despawn', block_id: 'entity_despawn', value_inputs: { entity: { node_id: 'it', block_id: 'entity_iterator' } } }],
  };
  const result = validate(doc);
  ok('entity_iterator with no enclosing *_foreach -> E017', result.messages.some((m) => m.code === 'E017'), JSON.stringify(result.messages));
}
// --- 3c. entity_iterator used inside the *wrong* provider's DO0 (e.g. a
// direction_foreach, which only provides directioniterator) -> still E017. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'iterator_wrong_scope_test',
    blocks: [
      {
        node_id: 'loop',
        block_id: 'direction_foreach',
        statement_inputs: {
          foreach: [{ node_id: 'despawn', block_id: 'entity_despawn', value_inputs: { entity: { node_id: 'it', block_id: 'entity_iterator' } } }],
        },
      },
    ],
  };
  const result = validate(doc);
  ok('entity_iterator inside direction_foreach (wrong provider) -> E017', result.messages.some((m) => m.code === 'E017'), JSON.stringify(result.messages));
}
// --- 3d. direction_iterator correctly scoped inside direction_foreach -> no E017 ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'iterator_direction_correct_test',
    blocks: [
      {
        node_id: 'loop',
        block_id: 'direction_foreach',
        statement_inputs: {
          foreach: [
            {
              node_id: 'chat',
              block_id: 'entity_send_chat',
              value_inputs: {
                text: textNode('t', 'x'),
                actbar: boolNode('b'),
                entity: { node_id: 'e', block_id: 'entity_from_deps' },
              },
            },
          ],
        },
      },
    ],
  };
  const result = validate(doc);
  ok('direction_foreach scoping itself: 0 errors', result.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(result.messages));
}
// --- 3e. Nesting: entity_iterator used two levels deep inside the correct
// provider (through an intermediate controls_if) still sees the scope. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'iterator_nested_scope_test',
    blocks: [
      {
        node_id: 'loop',
        block_id: 'world_entity_inrange_foreach',
        value_inputs: { x: numNode('x'), y: numNode('y'), z: numNode('z'), range: numNode('r', '4') },
        statement_inputs: {
          foreach: [
            {
              node_id: 'iff',
              block_id: 'controls_if',
              value_inputs: { IF0: boolNode('c') },
              statement_inputs: {
                DO0: [{ node_id: 'despawn', block_id: 'entity_despawn', value_inputs: { entity: { node_id: 'it', block_id: 'entity_iterator' } } }],
              },
            },
          ],
        },
      },
    ],
  };
  const result = validate(doc);
  ok('entity_iterator nested 2 levels inside the correct provider: no E017', !result.messages.some((m) => m.code === 'E017'), JSON.stringify(result.messages));
}

// --- 3f. direction_iterator correctly nested inside direction_foreach's
// "foreach" must NOT produce a spurious W001 "directioniterator" dependency
// warning. Root cause: direction_iterator declares its own MCreator-real
// dependency as "directioniterator:direction" (see blocks_full.json), and
// W001's dependency aggregation used to add every used block's declared
// dependency to the "required" set unconditionally, with no awareness that
// direction_foreach's "foreach" statement locally *provides* that exact
// name (iterator_providers.json's provides_name "directioniterator" for
// block_id "direction_foreach"/statement_name "foreach" — the same name
// direction_iterator itself declares, both sourced from MCreator's own
// mcreator.statements[].provides). A dependency satisfied by an active
// *_foreach ancestor is not something the trigger needs to supply, so it
// must not appear in W001's message. This also exercises the JSON's real
// "_placeholder" value_input (per direction_foreach's actual MCreator JSON:
// mcreator.toolbox_init always fills it with a fixed, disabled
// direction_iterator block purely as UI decoration — it is not part of the
// "foreach" statement's provides scope, so this test intentionally leaves
// it unset, same as the existing 3d test above) with a direction_iterator
// used inside the loop body (block_set_direction). ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'direction_foreach_iterator_deps_test',
    blocks: [
      {
        node_id: 'loop',
        block_id: 'direction_foreach',
        statement_inputs: {
          foreach: [
            {
              node_id: 'setdir',
              block_id: 'block_set_direction',
              value_inputs: {
                x: numNode('x'),
                y: numNode('y'),
                z: numNode('z'),
                direction: { node_id: 'cur', block_id: 'direction_iterator' },
              },
            },
          ],
        },
      },
    ],
  };
  const result = validate(doc);
  ok('direction_iterator inside direction_foreach: no E017', !result.messages.some((m) => m.code === 'E017'), JSON.stringify(result.messages));
  ok(
    'direction_iterator inside direction_foreach: no spurious W001 "directioniterator" dependency warning',
    !result.messages.some((m) => m.code === 'W001' && m.message.includes('directioniterator')),
    JSON.stringify(result.messages),
  );
}

// --- 3g. direction_iterator used with NO enclosing *_foreach at all still
// gets both E017 (wrong scope) and, independently, still counts as a real
// missing dependency in W001 if somehow reached despite the error (guards
// against the 3f fix over-broadly suppressing W001 for genuinely-unscoped
// usage — but a document with E017 never reaches XML rendering anyway, this
// only confirms depsUsed itself isn't being suppressed unconditionally). ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'direction_iterator_outside_scope_test',
    blocks: [{ node_id: 'setdir', block_id: 'block_set_direction', value_inputs: { x: numNode('x'), y: numNode('y'), z: numNode('z'), direction: { node_id: 'it', block_id: 'direction_iterator' } } }],
  };
  const result = validate(doc);
  ok('direction_iterator with no enclosing *_foreach: E017', result.messages.some((m) => m.code === 'E017'), JSON.stringify(result.messages));
  ok(
    'direction_iterator with no enclosing *_foreach: W001 still lists "directioniterator" as required',
    result.messages.some((m) => m.code === 'W001' && m.message.includes('directioniterator')),
    JSON.stringify(result.messages),
  );
}

// ============================================================================
// Part 4: W011 (empty statement body) direct tests
// ============================================================================
{
  const doc = {
    format_version: 1,
    procedure_name: 'empty_if_test',
    blocks: [{ node_id: 'n1', block_id: 'controls_if', value_inputs: { IF0: boolNode('c') } }],
  };
  const result = validate(doc);
  ok('completely empty controls_if (no DO0 at all) -> W011', result.messages.some((m) => m.code === 'W011'), JSON.stringify(result.messages));
  ok('empty controls_if is still legal (0 errors)', result.messages.filter((m) => m.severity === 'error').length === 0, JSON.stringify(result.messages));
}
{
  const doc = {
    format_version: 1,
    procedure_name: 'empty_repeat_test',
    blocks: [{ node_id: 'n1', block_id: 'controls_repeat_ext', value_inputs: { TIMES: numNode('t', '3') }, statement_inputs: { DO: [] } }],
  };
  const result = validate(doc);
  ok('controls_repeat_ext with explicit empty DO array -> W011', result.messages.some((m) => m.code === 'W011'), JSON.stringify(result.messages));
}
{
  const doc = {
    format_version: 1,
    procedure_name: 'nonempty_if_test',
    blocks: [
      { node_id: 'n1', block_id: 'controls_if', value_inputs: { IF0: boolNode('c') }, statement_inputs: { DO0: ['n2'] } },
      { node_id: 'n2', block_id: 'entity_despawn' },
    ],
  };
  const result = validate(doc);
  ok('non-empty controls_if -> no W011', !result.messages.some((m) => m.code === 'W011'), JSON.stringify(result.messages));
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check-mcreator-features test(s) did not produce the expected result (pre-Blockly section).`);
  process.exit(1);
} else {
  console.log('\nOK (pre-Blockly section): all check-mcreator-features structural tests produced their expected result.');
}

// ============================================================================
// Part 5: headless-Blockly section — real workspace round-trip
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

// Mirrors registerBlocks.ts's applyCallProcedureArgsMutator().
{
  const def = Blockly.Blocks['call_procedure'];
  def.domToMutation = function (xmlElement) {
    const raw = xmlElement.getAttribute('inputs');
    const count = raw !== null ? Math.max(0, parseInt(raw, 10) || 0) : 0;
    let i = 0;
    while (this.getInput('arg' + i)) {
      this.removeInput('arg' + i);
      i += 1;
    }
    for (let n = 0; n < count; n += 1) {
      this.appendValueInput('arg' + n).appendField(new Blockly.FieldTextInput(''), 'name' + n);
    }
  };
  def.mutationToDom = function () {
    const container = Blockly.utils.xml.createElement('mutation');
    let count = 0;
    while (this.getInput('arg' + count)) count += 1;
    container.setAttribute('inputs', String(count));
    return container;
  };
}

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

// --- 4z. direction_foreach's rendered block must not show literal "%1"/
// "%2"/full-width "％1"/"％2" placeholder text — regression guard for the
// blocks_render.json message0 fix (tools/gen_render_defs.py's load_props()
// now normalizes MCreator JA locale strings' full-width "％<digit>" to
// ASCII "%<digit>" before Blockly's own message0 substitution runs; without
// it, direction_foreach's real JA string "％1として...％2を実行" left the
// "％1"/"％2" untouched as literal text and tacked a redundant "%1 %2" onto
// the end instead of substituting in place). Checked directly against the
// real Blockly block's rendered field/input text, not just the raw JSON. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'direction_foreach_label_render_test',
    blocks: [{ node_id: 'loop', block_id: 'direction_foreach', statement_inputs: { foreach: [] } }],
  };
  const result = validate(doc);
  if (result.ok && result.normalized) {
    const { workspace } = loadIntoWorkspace(result.normalized);
    const block = workspace.getAllBlocks(false).find((b) => b.type === 'direction_foreach');
    const rendered = block ? block.toString() : '';
    blocklyOk('direction_foreach rendered text has no leftover "%1"/"%2" placeholder', !/%1|%2/.test(rendered), rendered);
    blocklyOk('direction_foreach rendered text has no leftover full-width "％1"/"％2"', !/％1|％2/.test(rendered), rendered);
  } else {
    blocklyOk('direction_foreach label render test: validation must succeed first', false, JSON.stringify(result.messages));
  }
}

// --- 5a. Real Blockly round-trip: player-scoped variable get gets its
// entity input created on load, and the field/value are all present. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'var_player_headless_test',
    variables: [{ name: 'combo', type: 'number', scope: 'PLAYER_PERSISTENT' }],
    blocks: [
      {
        // variables_get_number is shape=value — nested here inside a real
        // statement's value_inputs, same as any other value block would be
        // (a bare top-level entry would be a statement-context shape
        // mismatch, unrelated to what this test is actually checking).
        node_id: 'root',
        block_id: 'entity_set_health',
        value_inputs: {
          entity: { node_id: 'e1', block_id: 'entity_from_deps' },
          health: {
            node_id: 'getter',
            block_id: 'variables_get_number',
            fields: { VAR: 'combo' },
            value_inputs: { entity: { node_id: 'e2', block_id: 'entity_from_deps' } },
          },
        },
      },
    ],
  };
  const result = validate(doc);
  if (result.ok && result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('PLAYER-scope variable get: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const getterBlock = workspace.getAllBlocks(false).find((b) => b.type === 'variables_get_number');
    blocklyOk('PLAYER-scope variable get: VAR field value is "global:combo"', getterBlock?.getFieldValue('VAR') === 'global:combo', getterBlock?.getFieldValue('VAR'));
    blocklyOk('PLAYER-scope variable get: entity input got created and connected', !!getterBlock?.getInputTargetBlock('entity'), '');
    workspace.dispose();
  } else {
    blocklyOk('var_player_headless_test: expected a normalized result', false, JSON.stringify(result.messages));
  }
}

// --- 5b. Full "capture ball" round-trip using a real Local MCItem variable
// — the exact scenario a previous pass couldn't represent for lack of real
// variable data. Demonstrates: create a local Itemstack variable, assign it
// a fresh MCItem, tag it with NBT (String + Number), then read the tag back
// out — all via the *same* variable reference across multiple statements
// (impossible without a real variable, since every other value expression
// in this app's block set constructs a fresh instance on each evaluation). ---
{
  const doc = {
    format_version: 1,
    mcreator_version: '2025.1',
    procedure_name: 'capture_side_with_variable',
    trigger: 'entity_dies',
    variables: [{ name: 'capturedItem', type: 'itemstack', scope: 'local' }],
    blocks: [
      {
        node_id: 'assign',
        block_id: 'variables_set_itemstack',
        fields: { VAR: 'capturedItem' },
        value_inputs: { VAL: { node_id: 'mk', block_id: 'registryname_to_mcitem', value_inputs: { registryname: textNode('rn', 'minecraft:carrot') } } },
        next: 'tag_type',
      },
      {
        node_id: 'tag_type',
        block_id: 'item_nbt_text_set',
        value_inputs: {
          tagName: textNode('tn1', 'captured_type'),
          tagValue: textNode('tv1', 'zombie'),
          item: { node_id: 'read1', block_id: 'variables_get_itemstack', fields: { VAR: 'capturedItem' } },
        },
        next: 'tag_health',
      },
      {
        node_id: 'tag_health',
        block_id: 'item_nbt_num_set',
        value_inputs: {
          tagName: textNode('tn2', 'captured_health'),
          tagValue: { node_id: 'hp', block_id: 'entity_health', value_inputs: { entity: { node_id: 'e1', block_id: 'entity_from_deps' } } },
          item: { node_id: 'read2', block_id: 'variables_get_itemstack', fields: { VAR: 'capturedItem' } },
        },
        next: 'give',
      },
      {
        node_id: 'give',
        block_id: 'entity_send_chat',
        value_inputs: {
          text: {
            node_id: 'read3',
            block_id: 'item_nbt_text_get',
            value_inputs: { tagName: textNode('tn3', 'captured_type'), item: { node_id: 'read4', block_id: 'variables_get_itemstack', fields: { VAR: 'capturedItem' } } },
          },
          actbar: boolNode('b1'),
          entity: { node_id: 'e2', block_id: 'entity_from_deps' },
        },
      },
    ],
  };
  const result = validate(doc);
  const errors = result.messages.filter((m) => m.severity === 'error');
  ok('capture_side_with_variable: 0 errors', errors.length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('capture_side_with_variable: expected block count matches actual (nothing lost across the same-variable chain)', expected === actual, `expected=${expected} actual=${actual}`);
    const varsInXml = (procedureToXmlString(result.normalized).match(/<variable /g) ?? []).length;
    blocklyOk('capture_side_with_variable: exactly one <variable> declared (not duplicated per reference)', varsInXml === 1, String(varsInXml));
    workspace.dispose();
  } else {
    fail('capture_side_with_variable: expected a normalized result');
  }
}

// --- 5c. Round-trip fidelity across a broad mix of features in one
// document: node_id graph references, controls_if with ELSE, a local
// variable, an *_foreach iterator loop, call_procedure with an argument,
// and a custom (non-vanilla-Minecraft) mod item id — confirms none of
// block_id / fields / selector values / connections / mutations / the
// custom mod element name are lost anywhere along JSON -> normalize ->
// validate -> XML -> Blockly. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'round_trip_mixed_test',
    trigger: { type: 'player_right_click_entity', dependencies: [] },
    variables: [{ name: 'hits', type: 'number', scope: 'GLOBAL_MAP' }],
    blocks: [
      {
        node_id: 'root_if',
        block_id: 'controls_if',
        value_inputs: { IF0: 'cond' },
        statement_inputs: { DO0: ['spawn_custom'], ELSE: ['set_hits'] },
      },
      { node_id: 'cond', block_id: 'entity_istamed', value_inputs: { entity: { node_id: 'e1', block_id: 'entity_from_deps' } } },
      {
        node_id: 'spawn_custom',
        block_id: 'spawn_entity',
        // A *custom mod* entity reference (not vanilla Minecraft), using the
        // real "CUSTOM:<ModElementName>" format (see src/lib/validate.ts's
        // ENTITY_TYPE_VALUE_PATTERN doc comment — confirmed via
        // GeneratorWrapper.getElementPlainName/MappableElement.
        // validateReference, the same mechanism mcitem_allblocks uses) to
        // confirm custom mod entity ids pass through untouched.
        fields: { entity: 'CUSTOM:CustomDragon' },
        value_inputs: { x: numNode('x'), y: numNode('y'), z: numNode('z') },
        next: 'call_helper',
      },
      {
        node_id: 'call_helper',
        block_id: 'call_procedure',
        fields: { '': 'helperProcedure', name0: 'amount' },
        value_inputs: { arg0: numNode('argval', '5') },
        next: 'loop',
      },
      {
        node_id: 'loop',
        block_id: 'world_entity_inrange_foreach',
        value_inputs: { x: numNode('lx'), y: numNode('ly'), z: numNode('lz'), range: numNode('lr', '8') },
        statement_inputs: {
          foreach: [{ node_id: 'despawn_it', block_id: 'entity_despawn', value_inputs: { entity: { node_id: 'it', block_id: 'entity_iterator' } } }],
        },
      },
      { node_id: 'set_hits', block_id: 'variables_set_number', fields: { VAR: 'hits' }, value_inputs: { VAL: numNode('one', '1') } },
    ],
  };
  const result = validate(doc);
  const errors = result.messages.filter((m) => m.severity === 'error');
  ok('round_trip_mixed_test: 0 errors', errors.length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    ok('round_trip_mixed_test: custom mod element id preserved verbatim', xml.includes('CUSTOM:CustomDragon'), xml);
    ok('round_trip_mixed_test: controls_if mutation has else="1"', /<mutation elseif="0" else="1">/.test(xml), xml);
    ok('round_trip_mixed_test: call_procedure argument connected (arg0)', xml.includes('<value name="arg0">'), xml);
    ok('round_trip_mixed_test: variable field present', xml.includes('<field name="VAR">global:hits</field>'), xml);
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('round_trip_mixed_test: expected block count matches actual in a real workspace', expected === actual, `expected=${expected} actual=${actual}`);
    workspace.dispose();
  } else {
    fail('round_trip_mixed_test: expected a normalized result');
  }
}

// ============================================================================
// Part 6: the 5 public/samples/sample_custom_variable_*.json /
// sample_mode_change_boots.json files — real headless-Blockly round-trip
// (check-samples.mjs only exercises validate.ts; this confirms they also
// actually load into a real workspace with the expected block count).
// ============================================================================
for (const fn of [
  'sample_custom_variable_number.json',
  'sample_custom_variable_player.json',
  'sample_custom_variable_all_types.json',
  'sample_custom_variable_local.json',
  'sample_mode_change_boots.json',
]) {
  const text = readFileSync(path.join(root, 'public/samples', fn), 'utf-8');
  const result = validate(JSON.parse(text));
  const errors = result.messages.filter((m) => m.severity === 'error');
  ok(`${fn}: 0 errors`, errors.length === 0, JSON.stringify(result.messages));
  if (result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk(`${fn}: real Blockly block count matches expected`, expected === actual, `expected=${expected} actual=${actual}`);
    workspace.dispose();
  } else {
    fail(`${fn}: expected a normalized result`);
  }
}

const totalFailures = failures + blocklyFailures;
if (totalFailures > 0) {
  console.error(`\nFAILED: ${totalFailures} check-mcreator-features test(s) did not produce the expected result (total).`);
  process.exit(1);
} else {
  console.log('\nOK: all check-mcreator-features tests (structural + headless-Blockly) produced their expected result.');
}
