// Regression tests for MCreator 2025.1's real entity-type-judgment
// mechanism ("is this Entity a Creeper/Zombie/Skeleton/custom Mob?"),
// exposed via the block_id `logic_entity_compare` — which already existed,
// fully and correctly, in blocks_full.json's static 516-block catalog
// (value_inputs.compareTo:Entity, fields.entity:field_data_list_selector,
// output Boolean) before this pass. It was never discovered/used because
// its `use_case_ja` was a generic placeholder ("取得値を他ブロックの入力
// スロットへ差し込んで使う。") that said nothing about entity-type
// judgment, and because there was no machine-readable catalog of valid
// `fields.entity` values anywhere in this repo — both fixed in this pass
// (see public/reference/entity_types.json and blocks_full.json's updated
// use_case_ja/tooltip_ja for logic_entity_compare).
//
// Persistence format, confirmed from MCreator 2025.1 real data (not
// guessed) — see src/lib/validate.ts's ENTITY_TYPE_VALUE_PATTERN doc
// comment and README for the full chain of evidence:
//   - Real block_id: `logic_entity_compare` (core/procedures/
//     logic_entity_compare.json — label "Is %1 (sub)type of %2").
//     `entity_check_creature_type` (the other existing entity-related
//     check) only tests broad CreatureType categories (UNDEAD/ARTHROPOD/
//     ILLAGER/WATER) and was deliberately NOT touched/repurposed.
//   - Field name: "entity" (field_data_list_selector, datalist "entity").
//   - Value format: "Entity<Name>" (e.g. "EntityCreeper", "EntityZombie",
//     "EntitySkeleton") — the literal key format shared by datalists/
//     entities.yaml (the selector dialog's data source, 166 entries) and
//     the generator's own mappings/entities.yaml (confirmed identical key
//     sets); resolved at codegen time via `generator.map(field$entity,
//     "entities", N)` — confirmed directly from 7 real neoforge-1.21.1/
//     procedures/*.java.ftl templates (logic_entity_compare.java.ftl is
//     literally `(${input$compareTo} instanceof ${generator.map(field$
//     entity, "entities", 0)})` — a plain Java `instanceof` check; index 0
//     resolves to the bare Java class name, e.g. "Creeper").
//   - "CUSTOM:<ModElementName>" — a workspace mod element reference, same
//     mechanism as mcitem_allblocks (GeneratorWrapper.getElementPlainName /
//     MappableElement.validateReference).
//   - "EXTERNAL:<literal>" — NameMapper's generic escape hatch.
//   - Non-spawnable abstract Java supertypes (EntityAnimal, EntityAgeable,
//     ...) are valid values here (that's the whole point of "(sub)type")
//     even though they can't be used with spawn_entity.
//
// Run with: npm run check-entity-types
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

function isTypeDoc(entityValue) {
  return {
    format_version: 1,
    procedure_name: `entity_is_${entityValue}`,
    blocks: [
      {
        node_id: 'n1',
        block_id: 'controls_if',
        value_inputs: {
          IF0: {
            node_id: 'cmp',
            block_id: 'logic_entity_compare',
            fields: { entity: entityValue },
            value_inputs: { compareTo: { node_id: 'e1', block_id: 'entity_from_deps' } },
          },
        },
        statement_inputs: {
          DO0: [
            {
              node_id: 'chat',
              block_id: 'entity_send_chat',
              value_inputs: {
                text: { node_id: 't', block_id: 'text', fields: { TEXT: 'yes' } },
                actbar: { node_id: 'b', block_id: 'logic_boolean', fields: { BOOL: 'FALSE' } },
                entity: { node_id: 'e2', block_id: 'entity_from_deps' },
              },
            },
          ],
        },
      },
    ],
  };
}

// ============================================================================
// Headless-Blockly harness (mirrors scripts/check-compat.mjs's; see that
// file's "Headless-Blockly section" comment). Set up before any test that
// loads XML into a workspace.
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

// --- 1. Creeper type-check: 0 errors, real Blockly connects it, field
// preserved after round-trip (this is the exact scenario the user asked
// for: "if target entity is a Creeper"). ---
{
  const result = validate(isTypeDoc('EntityCreeper'));
  ok('Creeper type-check: 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('Creeper type-check: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const cmp = workspace.getAllBlocks(false).find((b) => b.type === 'logic_entity_compare');
    blocklyOk('Creeper type-check: logic_entity_compare block present', !!cmp, '');
    blocklyOk('Creeper type-check: entity field is "EntityCreeper" (visually confirmable)', cmp?.getFieldValue('entity') === 'EntityCreeper', String(cmp?.getFieldValue('entity')));
    blocklyOk('Creeper type-check: compareTo input connected', !!cmp?.getInputTargetBlock('compareTo'), '');
  } else {
    blocklyOk('Creeper type-check: validation must succeed first', false, JSON.stringify(codes(result)));
  }
}

// --- 2. Zombie type-check: confirms the mechanism is not Creeper-hardcoded. ---
{
  const result = validate(isTypeDoc('EntityZombie'));
  ok('Zombie type-check: 0 errors (mechanism is not Creeper-hardcoded)', result.ok, JSON.stringify(codes(result)));
}

// --- 3. Skeleton type-check: confirms the mechanism works for a third,
// unrelated vanilla entity (not just two special-cased names). ---
{
  const result = validate(isTypeDoc('EntitySkeleton'));
  ok('Skeleton type-check: 0 errors', result.ok, JSON.stringify(codes(result)));
}

// --- 4. Custom (workspace-defined) entity type-check: "CUSTOM:<name>",
// e.g. a mod-defined "MyBoss" entity — must be accepted, not blanket-error,
// since static reference data can't know custom entity names in advance. ---
{
  const result = validate(isTypeDoc('CUSTOM:MyBoss'));
  ok('Custom entity ("MyBoss") type-check: 0 errors', result.ok, JSON.stringify(codes(result)));
}

// --- 5. Type mismatch: a Number value connected to compareTo (check:
// Entity) must be E006, not silently accepted. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'entity_compare_type_mismatch',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'controls_if',
        value_inputs: {
          IF0: {
            node_id: 'cmp',
            block_id: 'logic_entity_compare',
            fields: { entity: 'EntityCreeper' },
            value_inputs: { compareTo: { node_id: 'bad', block_id: 'math_number', fields: { NUM: '1' } } },
          },
        },
        statement_inputs: { DO0: [] },
      },
    ],
  };
  const result = validate(doc);
  ok('Number connected to compareTo (Entity) -> E006', codes(result).includes('E006'), JSON.stringify(codes(result)));
}

// --- 6. Unknown input name -> E004 (existing strict validation preserved). ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'entity_compare_unknown_input',
    blocks: [
      {
        node_id: 'n1',
        block_id: 'controls_if',
        value_inputs: {
          IF0: {
            node_id: 'cmp',
            block_id: 'logic_entity_compare',
            fields: { entity: 'EntityCreeper' },
            value_inputs: { notARealInput: { node_id: 'e1', block_id: 'entity_from_deps' } },
          },
        },
        statement_inputs: { DO0: [] },
      },
    ],
  };
  const result = validate(doc);
  ok('Unknown value_inputs key -> E004', codes(result).includes('E004'), JSON.stringify(codes(result)));
}

// --- 7. Unknown block_id (a plausible-looking but non-existent id someone
// might guess, e.g. "entity_is_type") still -> E003, not silently accepted
// as if it were logic_entity_compare. ---
{
  const doc = {
    format_version: 1,
    procedure_name: 'entity_compare_unknown_block',
    blocks: [{ node_id: 'n1', block_id: 'entity_is_type', fields: { entity: 'EntityCreeper' } }],
  };
  const result = validate(doc);
  ok('Guessed/non-existent block_id "entity_is_type" -> E003', codes(result).includes('E003'), JSON.stringify(codes(result)));
}

// --- 8. Value-format validation: empty -> E020, malformed -> E021,
// unrecognized-but-well-formed vanilla name -> W013 (warning, not a hard
// block — entity_types.json's 166-entry snapshot may not be exhaustive). ---
{
  ok('empty entity value -> E020', codes(validate(isTypeDoc(''))).includes('E020'), JSON.stringify(codes(validate(isTypeDoc('')))));
  ok('malformed entity value ("Creeper", no "Entity" prefix) -> E021', codes(validate(isTypeDoc('Creeper'))).includes('E021'), JSON.stringify(codes(validate(isTypeDoc('Creeper')))));
  const unknownResult = validate(isTypeDoc('EntityTotallyMadeUp'));
  ok('well-formed but unrecognized vanilla entity -> W013 (not an error)', unknownResult.ok && codes(unknownResult).includes('W013'), JSON.stringify(codes(unknownResult)));
}

// --- 9. Round-trip: JSON -> normalize -> validate -> XML -> real Blockly
// workspace -> the entity-type info is not lost at any stage. ---
{
  const result = validate(isTypeDoc('EntitySkeleton'));
  if (result.ok && result.normalized) {
    const xml = procedureToXmlString(result.normalized);
    ok('round-trip: XML contains the entity field verbatim', xml.includes('<field name="entity">EntitySkeleton</field>'), xml);
    const { workspace } = loadIntoWorkspace(result.normalized);
    const cmp = workspace.getAllBlocks(false).find((b) => b.type === 'logic_entity_compare');
    blocklyOk('round-trip: value survives into a real Blockly workspace', cmp?.getFieldValue('entity') === 'EntitySkeleton', String(cmp?.getFieldValue('entity')));
  } else {
    fail('round-trip test: validation must succeed first');
  }
}

// --- 10. sample_entity_is_creeper.json: the ready-to-use Creeper-judgment
// sample, round-tripped through a real Blockly workspace. ---
{
  const doc = JSON.parse(readFileSync(path.join(root, 'public/samples/sample_entity_is_creeper.json'), 'utf-8'));
  const result = validate(doc);
  ok('sample_entity_is_creeper.json: 0 errors', result.ok, JSON.stringify(codes(result)));
  if (result.ok && result.normalized) {
    const { workspace, expected, actual } = loadIntoWorkspace(result.normalized);
    blocklyOk('sample_entity_is_creeper.json: expected block count matches actual', expected === actual, `expected=${expected} actual=${actual}`);
    const cmp = workspace.getAllBlocks(false).find((b) => b.type === 'logic_entity_compare');
    blocklyOk('sample_entity_is_creeper.json: entity field is "EntityCreeper"', cmp?.getFieldValue('entity') === 'EntityCreeper', String(cmp?.getFieldValue('entity')));
  } else {
    blocklyOk('sample_entity_is_creeper.json: validation must succeed first', false, JSON.stringify(codes(result)));
  }
}

console.log('');
console.log(`entity-type tests: ${failures + blocklyFailures} failure(s)`);
if (failures + blocklyFailures > 0) process.exit(1);
