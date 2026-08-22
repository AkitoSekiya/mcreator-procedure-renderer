/**
 * Strict semantic validation against `blocks_full.json` (SPEC.md v1.2 §4).
 * Contains no DOM/Blockly/React dependencies so it can be exercised from
 * plain Node scripts/tests.
 *
 * All *structural* graph concerns (node_id references, cycles, multi-
 * reference dedup, next-chain flattening, root/orphan classification) are
 * already resolved by normalizeInput.ts before this module ever runs — see
 * src/lib/normalizeInput.ts. This module's job is purely: does block_id
 * exist, are input/field names valid, do types match, and do field values
 * make sense (against blocks_render.json's real machine values) — the
 * things that require blocks_full.json's block-level semantics.
 */
import type {
  FullReferenceData,
  FullBlockDef,
  VariableTypeDef,
  VariableTypesData,
  TriggerDef,
  TriggersData,
  IteratorProviderDef,
  IteratorProvidersData,
} from './referenceTypes';
import type { ResolvedNode, ResolvedVariableDecl } from './resolvedTypes';
import { normalizeInput } from './normalizeInput';
import type { NormalizedNode, NormalizedProcedure, NormalizedVariableDecl } from './normalizedTypes';
import { findDropdownOptions, type DropdownOptionsMap } from './dropdownOptions';
import type { ValidationMessage } from './messages';
import { isDangerousKey, MAX_INPUT_JSON_LENGTH } from './guards';

/**
 * Optional MCreator 2025.1 metadata this module can use beyond
 * blocks_full.json/blocks_render.json — all reverse-engineered from real
 * MCreator 2025.1 data (see tools/extract_mcreator_metadata.py), covering
 * things the static 516-block catalog structurally can't (custom variable
 * get/set blocks are constructed in Java at runtime; the trigger catalog and
 * iterator-scoping rules aren't block definitions at all). Every field is
 * optional and additive: omitting any of them just disables that feature's
 * validation (variable references fall through to plain E003 "unknown
 * block_id", triggers get no dependency auto-fill, iterator scope isn't
 * checked) — existing 3-argument callers keep working unchanged. */
export interface ValidationExtras {
  variableTypes?: VariableTypesData;
  triggers?: TriggersData;
  iteratorProviders?: IteratorProvidersData;
}

export type { Severity, ValidationMessage } from './messages';

export interface ValidationResult {
  messages: ValidationMessage[];
  /** True iff there are zero error-severity messages (E001-E009). */
  ok: boolean;
  /** Present only when ok === true. */
  normalized: NormalizedProcedure | null;
}

/**
 * blocks_full.json's value_inputs/statement_inputs/fields lists reflect only
 * the *default* rendered shape of a block. Three builtin blocks support
 * Blockly mutators that add further, dynamically-named inputs/fields at
 * runtime (SPEC.md §5.3): controls_if (IF1../DO1../ELSE), text_join
 * (ADD2..), and call_procedure (arg1.., name0..). Those dynamic names never
 * appear in blocks_full.json, so they must be recognized here as a special
 * case, or the mutation feature documented in §5.3 (and SPEC's own sample2,
 * which relies on controls_if's ELSE branch) could never validate.
 */
const DYNAMIC_VALUE_INPUT_PATTERNS: Record<string, RegExp[]> = {
  controls_if: [/^IF\d+$/],
  text_join: [/^ADD\d+$/],
  call_procedure: [/^arg\d+$/],
};
const DYNAMIC_STATEMENT_INPUT_PATTERNS: Record<string, RegExp[]> = {
  controls_if: [/^DO\d+$/, /^ELSE$/],
};
// call_procedure's actual "which procedure" selector field is named
// "procedure" in blocks_render.json's Blockly definition, but blocks_full.json
// (the validation source of truth) records it with an empty name. We accept
// both the mutation-generated "nameN" fields and the literal "procedure" name
// here as a documented, deliberate exception (see final report deviations).
const DYNAMIC_FIELD_PATTERNS: Record<string, RegExp[]> = {
  call_procedure: [/^name\d+$/, /^procedure$/],
};

function matchesDynamicPattern(table: Record<string, RegExp[]>, blockId: string, key: string): boolean {
  const patterns = table[blockId];
  if (!patterns) return false;
  return patterns.some((p) => p.test(key));
}

/** The 6 real MCreator variable scopes (net.mcreator.workspace.elements.
 * VariableType$Scope, reverse-engineered via javap — see
 * tools/extract_mcreator_metadata.py's module docstring). "local" is
 * lowercase; the other 5 are the real Java enum constant names. */
const VALID_VARIABLE_SCOPES = new Set(['local', 'GLOBAL_SESSION', 'GLOBAL_MAP', 'GLOBAL_WORLD', 'PLAYER_LIFETIME', 'PLAYER_PERSISTENT']);
/** Scopes whose get/set blocks carry an extra "entity" value input (which
 * player's value is this?) — confirmed via mcreator_extensions.js's
 * 'variable_entity_input' registerMutator. */
const PLAYER_VARIABLE_SCOPES = new Set(['PLAYER_LIFETIME', 'PLAYER_PERSISTENT']);
/** variables_get_<type>/variables_set_<type> — the real block_id shape,
 * confirmed via `javap -v` on net.mcreator.blockly.java.BlocklyVariables'
 * `<block type=\"(?:variables_set_|variables_get_)\">` regex. */
const VARIABLE_BLOCK_ID_PATTERN = /^variables_(get|set)_([a-z]+)$/;

/** No iterator-provided dependency is active — the default at every
 * top-level stack root. */
const EMPTY_PROVIDES: ReadonlySet<string> = new Set();

/** Effective `check` type to use for E006 when a value input is one of the
 * dynamic mutator-added names above (not present in blocks_full.json). */
function dynamicValueInputCheck(blockId: string, key: string): string | string[] | null {
  if (blockId === 'controls_if' && /^IF\d+$/.test(key)) return 'Boolean';
  return null;
}

/** Blockly-style check compatibility: null/undefined on either side means "any". */
export function isCheckCompatible(
  outputType: string | string[] | null | undefined,
  check: string | string[] | null | undefined,
): boolean {
  if (outputType === null || outputType === undefined) return true;
  if (check === null || check === undefined) return true;
  const a = Array.isArray(outputType) ? outputType : [outputType];
  const b = Array.isArray(check) ? check : [check];
  return a.some((x) => b.includes(x));
}

/** Step 1: JSON.parse with E001 on failure. Kept separate so callers can
 * show a parse error before ever touching schema validation. */
export function parseJson(text: string): { data: unknown } | { error: ValidationMessage } {
  if (text.length > MAX_INPUT_JSON_LENGTH) {
    return {
      error: {
        code: 'E011',
        severity: 'error',
        message: `入力テキストが大きすぎます（${text.length}文字、上限${MAX_INPUT_JSON_LENGTH}文字）。`,
      },
    };
  }
  try {
    return { data: JSON.parse(text) };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      error: {
        code: 'E001',
        severity: 'error',
        message: `JSONを解析できませんでした: ${detail}`,
      },
    };
  }
}

/** Fields treated as booleans whose casing GPT output tends to vary on
 * ("true"/"TRUE"/"false"/"FALSE"). Recognized case-insensitively and
 * silently normalized to the canonical machine value — no W002, since this
 * isn't "using the label instead of the machine value" (SPEC deviation,
 * see README and the logic_boolean finding it generalizes). */
function normalizeBooleanish(strValue: string): 'TRUE' | 'FALSE' | null {
  const upper = strValue.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') return upper;
  return null;
}

interface Ctx {
  ref: FullReferenceData;
  dropdownOptions: DropdownOptionsMap;
  messages: ValidationMessage[];
  seenIds: Set<string>;
  depsUsed: Set<string>;
  requiredApiBlocksReported: Set<string>; // nodeId set, avoid double I002 per node
  requiredApisUsed: Set<string>; // procedure-wide aggregate, for I003
  variableTypes: Map<string, VariableTypeDef>; // type id ("number") -> def
  // Two separate namespaces, matching real MCreator's two separate lookup
  // paths for a "local:"- vs "global:"-prefixed VAR field value (confirmed
  // via javap — see normalizeInput.ts's resolveVariables doc comment): a
  // `local` variable and a same-named GLOBAL_*/PLAYER_* one are genuinely
  // different variables, not a collision, so a bare reference (fields.VAR
  // has no scope prefix in this app's JSON — see validateVariableNode) must
  // pick a namespace when both exist. `local` wins on a name present in
  // both, per innermost-scope-shadows-outer-scope convention (documented in
  // README).
  localVariableDecls: Map<string, { type: string; scope: string }>;
  globalVariableDecls: Map<string, { type: string; scope: string }>;
  iteratorProviders: Map<string, IteratorProviderDef[]>; // `${block_id}:${statement_name}` -> provider defs
}

function pushMsg(ctx: Ctx, msg: ValidationMessage): void {
  ctx.messages.push(msg);
}

/** SPEC v1.2 rule 8: type/parent/previous/children are silently accepted
 * unless they contradict the resolved graph, in which case a single W007 is
 * emitted per contradiction. Only simple string (or, for children, string[])
 * values are compared — anything else is left alone rather than risking a
 * false-positive warning. */
function checkMetadataContradictions(ctx: Ctx, node: ResolvedNode, shape: string | undefined): void {
  if (node.rawType !== undefined && shape !== undefined && node.rawType !== shape) {
    pushMsg(ctx, {
      code: 'W007',
      severity: 'warn',
      message: `ノード ${node.nodeId}（block_id: ${node.blockId}）の type "${node.rawType}" は実際の shape "${shape}" と矛盾します。`,
      nodeId: node.nodeId,
      blockId: node.blockId,
    });
  }

  if (typeof node.rawParent === 'string') {
    if (node.rawParent !== (node.actualParentId ?? '')) {
      pushMsg(ctx, {
        code: 'W007',
        severity: 'warn',
        message: `ノード ${node.nodeId}（block_id: ${node.blockId}）の parent "${node.rawParent}" は解決結果（${node.actualParentId ?? 'なし'}）と矛盾します。`,
        nodeId: node.nodeId,
        blockId: node.blockId,
      });
    }
  }

  if (typeof node.rawPrevious === 'string') {
    if (node.rawPrevious !== (node.actualPreviousId ?? '')) {
      pushMsg(ctx, {
        code: 'W007',
        severity: 'warn',
        message: `ノード ${node.nodeId}（block_id: ${node.blockId}）の previous "${node.rawPrevious}" は解決結果（${node.actualPreviousId ?? 'なし'}）と矛盾します。`,
        nodeId: node.nodeId,
        blockId: node.blockId,
      });
    }
  }

  if (typeof node.rawChildren === 'string' || Array.isArray(node.rawChildren)) {
    const rawList = (Array.isArray(node.rawChildren) ? node.rawChildren : [node.rawChildren]).filter(
      (v): v is string => typeof v === 'string',
    );
    const rawSet = [...rawList].sort();
    const actualSet = node.actualChildrenIds;
    const matches = rawSet.length === actualSet.length && rawSet.every((v, i) => v === actualSet[i]);
    if (!matches) {
      pushMsg(ctx, {
        code: 'W007',
        severity: 'warn',
        message: `ノード ${node.nodeId}（block_id: ${node.blockId}）の children ${JSON.stringify(rawSet)} は解決結果 ${JSON.stringify(actualSet)} と矛盾します。`,
        nodeId: node.nodeId,
        blockId: node.blockId,
      });
    }
  }
}

/**
 * Validates + normalizes a single ResolvedNode. Returns null when the node
 * cannot be normalized (unknown block_id, wrong shape for context) — callers
 * should not attach a null result into the normalized tree, but the function
 * still recurses into children so nested problems are surfaced too.
 *
 * `activeProvides` is the set of iterator-scoped dependency names (e.g.
 * "entityiterator") currently in scope — non-empty only while walking inside
 * a statement_inputs branch that a known *_foreach-style block "provides" to
 * (see ctx.iteratorProviders / E017 below). Threaded explicitly rather than
 * mutated on ctx so each branch of the tree only ever sees what its own
 * ancestors actually provide.
 */
function validateNode(
  ctx: Ctx,
  node: ResolvedNode,
  expectedShape: 'statement' | 'value',
  activeProvides: ReadonlySet<string> = EMPTY_PROVIDES,
): NormalizedNode | null {
  const { nodeId, blockId } = node;

  if (ctx.seenIds.has(nodeId)) {
    pushMsg(ctx, {
      code: 'E002',
      severity: 'error',
      message: `node_id "${nodeId}"（block_id: ${blockId}）が重複しています。`,
      nodeId,
      blockId,
    });
  } else {
    ctx.seenIds.add(nodeId);
  }

  // variables_get_<type>/variables_set_<type> are never in blocks_full.json
  // (constructed dynamically in MCreator's own Java code — see
  // ValidationExtras's doc comment) — dispatch to dedicated handling before
  // the blocks_full.json lookup below, which would otherwise always 404.
  const variableMatch = VARIABLE_BLOCK_ID_PATTERN.exec(blockId);
  if (variableMatch) {
    return validateVariableNode(ctx, node, expectedShape, variableMatch, activeProvides);
  }

  const def: FullBlockDef | undefined = ctx.ref.blocks[blockId];
  if (!def) {
    pushMsg(ctx, {
      code: 'E003',
      severity: 'error',
      message: `ノード ${nodeId} の block_id "${blockId}" は blocks_full.json に存在しません。`,
      nodeId,
      blockId,
    });
    checkMetadataContradictions(ctx, node, undefined);
    // Still recurse into children so nested problems are also reported,
    // even though this node itself can't be normalized.
    for (const child of Object.values(node.valueInputs)) validateNode(ctx, child, 'value', activeProvides);
    for (const children of Object.values(node.statementInputs)) {
      for (const child of children) validateNode(ctx, child, 'statement', activeProvides);
    }
    return null;
  }

  checkMetadataContradictions(ctx, node, def.shape);

  if (def.shape !== expectedShape) {
    const where = expectedShape === 'statement' ? 'ステートメント列' : '値入力(value_inputs)';
    pushMsg(ctx, {
      code: 'E007',
      severity: 'error',
      message: `ノード ${nodeId}（block_id: ${blockId}）は shape="${def.shape}" ですが、${where} には shape="${expectedShape}" のブロックのみ配置できます。`,
      nodeId,
      blockId,
    });
  }

  // Iterator scope check (E017): "<X>_iterator" value blocks (entity_/
  // direction_/itemstack_iterator — confirmed the only 3 such blocks in
  // blocks_full.json) only make sense nested inside the specific
  // statement_inputs branch of a *_foreach-style block that "provides"
  // "<X>iterator" (see ctx.iteratorProviders / tools/extract_mcreator_
  // metadata.py's iterator_providers.json). Naming is mechanical: strip the
  // underscore ("entity_iterator" -> "entityiterator").
  const iteratorMatch = /^([a-z]+)_iterator$/.exec(blockId);
  if (iteratorMatch && ctx.ref.blocks[blockId]) {
    const requiredProvide = iteratorMatch[1] + 'iterator';
    if (!activeProvides.has(requiredProvide)) {
      pushMsg(ctx, {
        code: 'E017',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）は "${requiredProvide}" を提供するstatement_inputs（対応する*_foreachブロックの内部）の外で使われています。`,
        nodeId,
        blockId,
      });
    }
  }

  for (const depName of def.dependencies) {
    const name = depName.split(':')[0];
    if (name) ctx.depsUsed.add(name);
  }

  if (def.required_apis && def.required_apis.length > 0 && !ctx.requiredApiBlocksReported.has(nodeId)) {
    ctx.requiredApiBlocksReported.add(nodeId);
    for (const api of def.required_apis) ctx.requiredApisUsed.add(api);
    pushMsg(ctx, {
      code: 'I002',
      severity: 'info',
      message: `ノード ${nodeId}（block_id: ${blockId}）は追加API(${def.required_apis.join(', ')})が必要です。`,
      nodeId,
      blockId,
    });
  }

  // --- fields ---
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.fieldsRaw)) {
    if (isDangerousKey(key)) {
      pushMsg(ctx, {
        code: 'E010',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の fields キー "${key}" は予約済みのキー名のため使用できません。`,
        nodeId,
        blockId,
      });
      continue;
    }
    const fieldDef = def.fields.find((f) => f.name === key);
    if (!fieldDef) {
      if (matchesDynamicPattern(DYNAMIC_FIELD_PATTERNS, blockId, key)) {
        const strValue = typeof value === 'string' ? value : JSON.stringify(value);
        fields[key] = strValue;
        continue;
      }
      pushMsg(ctx, {
        code: 'E005',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の fields キー "${key}" はこのブロックの定義に存在しません。`,
        nodeId,
        blockId,
      });
      continue;
    }
    let strValue = typeof value === 'string' ? value : JSON.stringify(value);

    // field_checkbox values ("TRUE"/"FALSE" in SPEC.md §3) tolerate any
    // true/false casing and get normalized to canonical uppercase before
    // storage — no options list exists to run W002 against.
    if (fieldDef.type === 'field_checkbox') {
      const normalized = normalizeBooleanish(strValue);
      if (normalized) strValue = normalized;
      fields[key] = strValue;
      continue;
    }

    fields[key] = strValue;

    if (fieldDef.type === 'field_dropdown') {
      // logic_boolean.BOOL is conceptually boolean too; tolerate casing
      // the same way as field_checkbox, silently, before ever consulting
      // the options list.
      if (blockId === 'logic_boolean' && key === 'BOOL') {
        const normalized = normalizeBooleanish(strValue);
        if (normalized) {
          strValue = normalized;
          fields[key] = strValue;
          continue;
        }
      }

      const options = findDropdownOptions(ctx.dropdownOptions, blockId, key);
      if (options && options.length > 0) {
        const machineValues = options.map(([, v]) => v);
        if (!machineValues.includes(strValue)) {
          const labelMatch = options.find(([label]) => label === strValue);
          if (labelMatch) {
            // Display label used instead of the machine value (SPEC v1.2
            // rule 9): silently auto-convert for rendering. No warning and
            // no info message — this is expected, unremarkable input.
            strValue = labelMatch[1];
            fields[key] = strValue;
          } else {
            pushMsg(ctx, {
              code: 'W002',
              severity: 'warn',
              message: `ノード ${nodeId}（block_id: ${blockId}）の field "${key}" の値 "${strValue}" は機械値一覧 ${JSON.stringify(machineValues)} に含まれません。`,
              nodeId,
              blockId,
            });
          }
        }
      } else if (Array.isArray(fieldDef.options) && !fieldDef.options.includes(strValue)) {
        // Fallback for the (currently none-known) case where neither
        // blocks_render.json nor the builtin-block hardcoded table has
        // this block/field: best-effort check against blocks_full.json's
        // declared options, same as before this fix.
        pushMsg(ctx, {
          code: 'W002',
          severity: 'warn',
          message: `ノード ${nodeId}（block_id: ${blockId}）の field "${key}" の値 "${strValue}" は options ${JSON.stringify(fieldDef.options)} に含まれません。`,
          nodeId,
          blockId,
        });
      }
    } else if (fieldDef.type === 'field_number' && strValue.length > 0 && !Number.isFinite(Number(strValue))) {
      // field_number fields (blocks_full.json/blocks_render.json declare the
      // type explicitly, e.g. get_command_parameters.paramid) render via
      // Blockly's FieldNumber, which coerces non-numeric text to 0 silently —
      // catching this here surfaces the likely-unintended value instead of
      // letting it silently become "0" in the rendered block.
      pushMsg(ctx, {
        code: 'W009',
        severity: 'warn',
        message: `ノード ${nodeId}（block_id: ${blockId}）の field "${key}"（field_number）の値 "${strValue}" は数値として解釈できません。`,
        nodeId,
        blockId,
      });
    }
  }

  // --- value_inputs ---
  const valueInputs: Record<string, NormalizedNode> = {};
  for (const [key, childNode] of Object.entries(node.valueInputs)) {
    const inputDef = def.value_inputs.find((vi) => vi.name === key);
    const isDynamic = !inputDef && matchesDynamicPattern(DYNAMIC_VALUE_INPUT_PATTERNS, blockId, key);
    if (!inputDef && !isDynamic) {
      pushMsg(ctx, {
        code: 'E004',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の value_inputs キー "${key}" はこのブロックの定義に存在しません。`,
        nodeId,
        blockId,
      });
      // Still validate the orphaned child so its own errors surface.
      validateNode(ctx, childNode, 'value', activeProvides);
      continue;
    }
    const effectiveCheck = inputDef ? inputDef.check : dynamicValueInputCheck(blockId, key);
    const child = validateNode(ctx, childNode, 'value', activeProvides);
    // Type-compatibility check (E006), performed whenever the child's
    // block_id resolves to a known definition (independent of whether the
    // child fully validated, so a shape mismatch doesn't hide a separate
    // type mismatch).
    const childDef = ctx.ref.blocks[childNode.blockId];
    if (childDef) {
      if (!isCheckCompatible(childDef.output_type, effectiveCheck)) {
        pushMsg(ctx, {
          code: 'E006',
          severity: 'error',
          message: `ノード ${nodeId}（block_id: ${blockId}）の入力 "${key}" は型 ${JSON.stringify(effectiveCheck)} を要求しますが、接続されたブロック（block_id: ${childNode.blockId}）の出力型 ${JSON.stringify(childDef.output_type)} と適合しません。`,
          nodeId,
          blockId,
        });
      }
    }
    if (child) valueInputs[key] = child;
  }

  // --- statement_inputs ---
  const statementInputs: Record<string, NormalizedNode[]> = {};
  for (const [key, childList] of Object.entries(node.statementInputs)) {
    const has = def.statement_inputs.includes(key) || matchesDynamicPattern(DYNAMIC_STATEMENT_INPUT_PATTERNS, blockId, key);
    if (!has) {
      pushMsg(ctx, {
        code: 'E004',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の statement_inputs キー "${key}" はこのブロックの定義に存在しません。`,
        nodeId,
        blockId,
      });
      continue;
    }
    // If this exact block_id + statement key is a known iterator provider
    // (e.g. world_entity_inrange_foreach's "foreach"), extend the active-
    // provides set for everything nested inside it (E017 above).
    const providesHere = ctx.iteratorProviders.get(`${blockId}:${key}`);
    let childActiveProvides = activeProvides;
    if (providesHere && providesHere.length > 0) {
      const extended = new Set(activeProvides);
      for (const p of providesHere) extended.add(p.provides_name);
      childActiveProvides = extended;
    }
    const children: NormalizedNode[] = [];
    for (const childNode of childList) {
      const child = validateNode(ctx, childNode, 'statement', childActiveProvides);
      if (child) children.push(child);
    }
    statementInputs[key] = children;
  }

  // W011: a block that supports statement_inputs but whose slots are all
  // completely empty (never provided, or provided but resolving to zero
  // children) is structurally legal — MCreator itself allows an empty if/
  // repeat body — but likely signals an unfinished procedure, worth a
  // gentle nudge rather than silence. Scoped to blocks that actually *have*
  // a statement_inputs slot to begin with (def.statement_inputs.length > 0),
  // so plain leaf statements (spawn_entity etc., which have none) never
  // trigger it.
  if (def.statement_inputs.length > 0) {
    const totalChildren = Object.values(statementInputs).reduce((sum, arr) => sum + arr.length, 0);
    if (totalChildren === 0) {
      pushMsg(ctx, {
        code: 'W011',
        severity: 'warn',
        message: `ノード ${nodeId}（block_id: ${blockId}）はステートメント入力（${def.statement_inputs.join(', ')}）が全て空です。未完成のプロシージャの可能性があります。`,
        nodeId,
        blockId,
      });
    }
  }

  if (blockId === 'call_procedure') {
    checkCallProcedureArgContiguity(ctx, node, fields, valueInputs);
  }

  return { nodeId, blockId, fields, valueInputs, statementInputs };
}

/**
 * Handles `variables_get_<type>`/`variables_set_<type>` nodes — never
 * present in blocks_full.json (see ValidationExtras's doc comment). Mirrors
 * validateNode's overall structure (duplicate-id check already done by the
 * caller; shape/field/value_input/statement_input validation here) but
 * against variable_types.json + the document's own `variables` declarations
 * instead of a FullBlockDef.
 */
function validateVariableNode(
  ctx: Ctx,
  node: ResolvedNode,
  expectedShape: 'statement' | 'value',
  match: RegExpExecArray,
  activeProvides: ReadonlySet<string>,
): NormalizedNode | null {
  const { nodeId, blockId } = node;
  const kind = match[1] as 'get' | 'set';
  const typeId = match[2];
  const typeDef = ctx.variableTypes.get(typeId);

  if (!typeDef) {
    // Type suffix isn't one of the 9 known variable types (or no
    // variable_types.json was supplied at all) — same treatment as any
    // other unrecognized block_id, so it fails safe (E003) instead of being
    // silently accepted or guessed at.
    pushMsg(ctx, {
      code: 'E003',
      severity: 'error',
      message: `ノード ${nodeId} の block_id "${blockId}" は blocks_full.json にも既知の変数型（variable_types.json）にも存在しません。`,
      nodeId,
      blockId,
    });
    for (const child of Object.values(node.valueInputs)) validateNode(ctx, child, 'value', activeProvides);
    for (const children of Object.values(node.statementInputs)) {
      for (const child of children) validateNode(ctx, child, 'statement', activeProvides);
    }
    return null;
  }

  const shape: 'value' | 'statement' = kind === 'get' ? 'value' : 'statement';
  if (shape !== expectedShape) {
    const where = expectedShape === 'statement' ? 'ステートメント列' : '値入力(value_inputs)';
    pushMsg(ctx, {
      code: 'E007',
      severity: 'error',
      message: `ノード ${nodeId}（block_id: ${blockId}）は shape="${shape}" ですが、${where} には shape="${expectedShape}" のブロックのみ配置できます。`,
      nodeId,
      blockId,
    });
  }
  checkMetadataContradictions(ctx, node, shape);

  // --- fields: only "VAR" (the referenced variable's name) is legal ---
  const fields: Record<string, string> = {};
  let isPlayerScopedVariable = false;
  for (const [key, value] of Object.entries(node.fieldsRaw)) {
    if (isDangerousKey(key)) {
      pushMsg(ctx, {
        code: 'E010',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の fields キー "${key}" は予約済みのキー名のため使用できません。`,
        nodeId,
        blockId,
      });
      continue;
    }
    if (key !== 'VAR') {
      pushMsg(ctx, {
        code: 'E005',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の fields キー "${key}" はこのブロックの定義に存在しません（変数参照ブロックが持てるfieldは "VAR" のみです）。`,
        nodeId,
        blockId,
      });
      continue;
    }
    const varName = typeof value === 'string' ? value : JSON.stringify(value);
    // "local" shadows a same-named global-family variable — see Ctx's
    // localVariableDecls/globalVariableDecls doc comment.
    const decl = ctx.localVariableDecls.get(varName) ?? ctx.globalVariableDecls.get(varName);
    if (!decl) {
      pushMsg(ctx, {
        code: 'E013',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）は変数 "${varName}" を参照していますが、variables 配列に定義がありません。`,
        nodeId,
        blockId,
      });
      fields.VAR = varName;
      continue;
    }
    if (decl.type !== typeId) {
      pushMsg(ctx, {
        code: 'E016',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）は型 "${typeId}" ですが、変数 "${varName}" は型 "${decl.type}" として宣言されています。`,
        nodeId,
        blockId,
      });
    }
    isPlayerScopedVariable = PLAYER_VARIABLE_SCOPES.has(decl.scope);
    fields.VAR = `${decl.scope === 'local' ? 'local' : 'global'}:${varName}`;
  }
  if (!('VAR' in fields)) {
    pushMsg(ctx, {
      code: 'E002',
      severity: 'error',
      message: `ノード ${nodeId}（block_id: ${blockId}）に fields.VAR（参照する変数名）がありません。`,
      nodeId,
      blockId,
    });
  }

  // --- value_inputs: "VAL" (set only, check=blocklyType) + "entity"
  // (either kind, check=Entity — only meaningful when the variable turned
  // out to be player-scoped above, but accepted structurally either way so
  // an E016 type mismatch doesn't also cascade into a spurious E004). ---
  const valueInputs: Record<string, NormalizedNode> = {};
  for (const [key, childNode] of Object.entries(node.valueInputs)) {
    const isVal = kind === 'set' && key === 'VAL';
    const isEntity = key === 'entity';
    if (!isVal && !isEntity) {
      pushMsg(ctx, {
        code: 'E004',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の value_inputs キー "${key}" はこのブロックの定義に存在しません。`,
        nodeId,
        blockId,
      });
      validateNode(ctx, childNode, 'value', activeProvides);
      continue;
    }
    const effectiveCheck = isVal ? typeDef.blockly_type : 'Entity';
    const child = validateNode(ctx, childNode, 'value', activeProvides);
    const childDef = ctx.ref.blocks[childNode.blockId];
    if (childDef && !isCheckCompatible(childDef.output_type, effectiveCheck)) {
      pushMsg(ctx, {
        code: 'E006',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の入力 "${key}" は型 "${effectiveCheck}" を要求しますが、接続されたブロック（block_id: ${childNode.blockId}）の出力型 ${JSON.stringify(childDef.output_type)} と適合しません。`,
        nodeId,
        blockId,
      });
    }
    if (child) valueInputs[key] = child;
  }

  // No legal statement_inputs on a variable get/set block.
  for (const key of Object.keys(node.statementInputs)) {
    pushMsg(ctx, {
      code: 'E004',
      severity: 'error',
      message: `ノード ${nodeId}（block_id: ${blockId}）の statement_inputs キー "${key}" はこのブロックの定義に存在しません。`,
      nodeId,
      blockId,
    });
  }

  // W010: a PLAYER_LIFETIME/PLAYER_PERSISTENT-scoped reference structurally
  // supports the "entity" input but doesn't strictly require it (same
  // lenient "we never require inputs to be filled" philosophy as every
  // other block in this app) — flagged as a warning, not an error, since
  // the block still loads and renders fine either way.
  if (isPlayerScopedVariable && !Object.prototype.hasOwnProperty.call(node.valueInputs, 'entity')) {
    pushMsg(ctx, {
      code: 'W010',
      severity: 'warn',
      message: `ノード ${nodeId}（block_id: ${blockId}）はPLAYER系スコープの変数を参照していますが、value_inputs["entity"]（対象プレイヤー）が指定されていません。`,
      nodeId,
      blockId,
    });
  }

  return { nodeId, blockId, fields, valueInputs, statementInputs: {}, isPlayerScopedVariable };
}

/** call_procedure's dynamic `argN`/`nameN` pairs (README/SPEC's documented
 * mutator-added names, applied via src/blockly/registerBlocks.ts's own
 * domToMutation for that block — see its comment for why: the real MCreator
 * mutator implementation isn't captured in blocks_render.json at all, since
 * call_procedure is "source": "js-imperative" in blocks_full.json) only
 * produce a well-formed `<mutation inputs="N">` (and thus N real argN input
 * slots once loaded) when the indices used are contiguous from 0. A gap
 * (e.g. arg0 + arg2 but no arg1) silently renumbers/misaligns which
 * value_input each argN slot actually receives, since the mutator only knows
 * a *count*, not which specific indices were supplied — worth flagging even
 * though it doesn't prevent rendering. */
function checkCallProcedureArgContiguity(
  ctx: Ctx,
  node: ResolvedNode,
  fields: Record<string, string>,
  valueInputs: Record<string, NormalizedNode>,
): void {
  const argIndices = Object.keys(valueInputs)
    .map((k) => /^arg(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  const nameIndices = Object.keys(fields)
    .map((k) => /^name(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));

  const isContiguousFromZero = (indices: number[]): boolean => {
    if (indices.length === 0) return true;
    const sorted = [...new Set(indices)].sort((a, b) => a - b);
    return sorted.length === indices.length && sorted.every((v, i) => v === i);
  };

  if (!isContiguousFromZero(argIndices)) {
    pushMsg(ctx, {
      code: 'W008',
      severity: 'warn',
      message: `ノード ${node.nodeId}（block_id: call_procedure）の動的引数 value_inputs["argN"] の番号が0始まりの連番ではありません（実際: ${JSON.stringify([...argIndices].sort((a, b) => a - b))}）。`,
      nodeId: node.nodeId,
      blockId: 'call_procedure',
    });
  }
  if (!isContiguousFromZero(nameIndices)) {
    pushMsg(ctx, {
      code: 'W008',
      severity: 'warn',
      message: `ノード ${node.nodeId}（block_id: call_procedure）の動的引数名 fields["nameN"] の番号が0始まりの連番ではありません（実際: ${JSON.stringify([...nameIndices].sort((a, b) => a - b))}）。`,
      nodeId: node.nodeId,
      blockId: 'call_procedure',
    });
  }
}

/** JS primitive each variable type's `initial_value` should roughly match,
 * for the 3 types with an obvious 1:1 JSON primitive (Number -> number,
 * Logic -> boolean, String -> string). The other 6 types (Entity/Itemstack/
 * Blockstate/Direction/Damagesource/ActionResultType) are complex in-game
 * objects with no reasonable JSON-primitive representation, so their
 * initial_value isn't type-checked at all — accepted as-is. */
const VARIABLE_INITIAL_VALUE_JS_TYPE: Partial<Record<string, 'number' | 'boolean' | 'string'>> = {
  number: 'number',
  logic: 'boolean',
  string: 'string',
};

/**
 * `initial_value` (net.mcreator.workspace.elements.VariableElement.value in
 * real MCreator — see ResolvedVariableDecl's doc comment) has no Blockly XML
 * representation and never affects rendering, so a mismatch is a warning
 * (W012), not an E-level error that would block the whole document from
 * rendering over something with zero visual effect.
 */
function checkVariableInitialValue(messages: ValidationMessage[], decl: ResolvedVariableDecl): void {
  if (decl.initialValue === undefined) return;
  const expected = VARIABLE_INITIAL_VALUE_JS_TYPE[decl.type];
  if (!expected) return; // no primitive representation to check against
  if (typeof decl.initialValue !== expected) {
    messages.push({
      code: 'W012',
      severity: 'warn',
      message: `変数 "${decl.name}"（type: ${decl.type}）の initial_value は ${expected} 型を想定していますが、実際は ${typeof decl.initialValue} でした（${JSON.stringify(decl.initialValue)}）。initial_valueはレンダリングには影響しません。`,
    });
  }
}

export function validateProcedure(
  raw: unknown,
  ref: FullReferenceData,
  dropdownOptions: DropdownOptionsMap,
  extras?: ValidationExtras,
): ValidationResult {
  const { messages: normalizeMessages, doc } = normalizeInput(raw, ref);

  if (!doc) {
    return { messages: normalizeMessages, ok: false, normalized: null };
  }

  const messages: ValidationMessage[] = [...normalizeMessages];

  const variableTypes = new Map<string, VariableTypeDef>();
  for (const t of extras?.variableTypes?.types ?? []) variableTypes.set(t.id, t);

  const iteratorProviders = new Map<string, IteratorProviderDef[]>();
  for (const p of extras?.iteratorProviders?.providers ?? []) {
    const key = `${p.block_id}:${p.statement_name}`;
    const list = iteratorProviders.get(key);
    if (list) list.push(p);
    else iteratorProviders.set(key, [p]);
  }

  const triggers = new Map<string, TriggerDef>();
  for (const t of extras?.triggers?.triggers ?? []) triggers.set(t.id, t);

  // Validate + index the top-level `variables` declarations (E014: unknown
  // type/scope value). Only entries that pass become lookupable by
  // validateVariableNode (E013 "undefined variable" naturally covers any
  // reference to a name that failed here too, which is the right outcome —
  // a variable declared with a bogus type shouldn't be treated as usable).
  const localVariableDecls = new Map<string, { type: string; scope: string }>();
  const globalVariableDecls = new Map<string, { type: string; scope: string }>();
  const normalizedVariables: NormalizedVariableDecl[] = [];
  for (const decl of doc.variables) {
    const typeDef = variableTypes.get(decl.type);
    if (!typeDef) {
      messages.push({
        code: 'E014',
        severity: 'error',
        message: `変数 "${decl.name}" の type "${decl.type}" は不明です（既知の型: ${[...variableTypes.keys()].sort().join(', ') || '(variable_types.json が読み込まれていません)'}）。`,
      });
      continue;
    }
    if (!VALID_VARIABLE_SCOPES.has(decl.scope)) {
      messages.push({
        code: 'E014',
        severity: 'error',
        message: `変数 "${decl.name}" の scope "${decl.scope}" は不明です（既知のscope: ${[...VALID_VARIABLE_SCOPES].join(', ')}）。`,
      });
      continue;
    }
    checkVariableInitialValue(messages, decl);
    if (decl.scope === 'local') {
      localVariableDecls.set(decl.name, { type: decl.type, scope: decl.scope });
      // Only local declarations get a <variable> XML element — see
      // NormalizedVariableDecl's doc comment for why GLOBAL_*/PLAYER_* ones
      // don't (and safely can't collide with a same-named local one here).
      normalizedVariables.push({ name: decl.name, blocklyType: typeDef.blockly_type });
    } else {
      globalVariableDecls.set(decl.name, { type: decl.type, scope: decl.scope });
    }
  }

  const ctx: Ctx = {
    ref,
    dropdownOptions,
    messages,
    seenIds: new Set(),
    depsUsed: new Set(),
    requiredApiBlocksReported: new Set(),
    requiredApisUsed: new Set(),
    variableTypes,
    localVariableDecls,
    globalVariableDecls,
    iteratorProviders,
  };

  const stacks: NormalizedNode[][] = doc.stacks.map((stack) =>
    stack.map((node) => validateNode(ctx, node, 'statement')).filter((n): n is NormalizedNode => n !== null),
  );

  // SPEC v1.2 rule 2: W001 shows only the deps the used blocks require minus
  // what the trigger declares it provides (by name, "entity:entity" style),
  // now also merging in the real trigger catalog's dependencies_provided
  // when the trigger name matches a known one (purely additive — an
  // explicit trigger.dependencies in the input is still honored exactly as
  // before, this only adds more "provided" names on top).
  const triggerDef = doc.trigger.name ? triggers.get(doc.trigger.name) : undefined;
  const providedDeps = new Set(doc.trigger.providedDeps);
  if (triggerDef) for (const d of triggerDef.dependencies_provided) providedDeps.add(d);
  const missingDeps = [...ctx.depsUsed].filter((d) => !providedDeps.has(d));
  if (missingDeps.length > 0) {
    ctx.messages.push({
      code: 'W001',
      severity: 'warn',
      message: `このプロシージャは次の依存関係を要求: ${missingDeps.sort().join(', ')}（トリガーが提供しない場合MCreatorで警告）`,
    });
  }

  // Procedure-wide aggregate of every required_apis entry across all used
  // blocks (I002 already reports per-node; this is the "プロシージャ単位"
  // summary requested alongside it — one line covering the whole document).
  if (ctx.requiredApisUsed.size > 0) {
    ctx.messages.push({
      code: 'I003',
      severity: 'info',
      message: `このプロシージャ全体で必要な追加API: ${[...ctx.requiredApisUsed].sort().join(', ')}`,
    });
  }

  const hasError = ctx.messages.some((m) => m.severity === 'error');

  return {
    messages: ctx.messages,
    ok: !hasError,
    normalized: hasError
      ? null
      : { procedureName: doc.procedureName, trigger: doc.trigger.name, stacks, mode: doc.mode, variables: normalizedVariables },
  };
}

/** Convenience wrapper: parses raw JSON text and validates it in one call. */
export function validateProcedureText(
  text: string,
  ref: FullReferenceData,
  dropdownOptions: DropdownOptionsMap,
  extras?: ValidationExtras,
): ValidationResult {
  const parsed = parseJson(text);
  if ('error' in parsed) {
    return { messages: [parsed.error], ok: false, normalized: null };
  }
  return validateProcedure(parsed.data, ref, dropdownOptions, extras);
}

// Re-exported for convenience so callers don't need to import from two
// different modules for the common case.
export type { ResolvedDoc, ResolvedNode } from './resolvedTypes';
