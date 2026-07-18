/**
 * Pure validation of the MCreator procedure input JSON against
 * `blocks_full.json` (SPEC.md §4). Contains no DOM/Blockly/React
 * dependencies so it can be exercised from plain Node scripts/tests.
 *
 * Validation is based *only* on blocks_full.json — block shapes, input
 * names, field names and type-compatibility rules are never guessed.
 */
import type { FullReferenceData, FullBlockDef } from './referenceTypes';
import type { RawProcedureDoc } from './inputTypes';
import { IGNORED_NODE_KEYS } from './inputTypes';
import type { NormalizedNode, NormalizedProcedure } from './normalizedTypes';
import { findDropdownOptions, type DropdownOptionsMap } from './dropdownOptions';

export type Severity = 'error' | 'warn' | 'info';

export interface ValidationMessage {
  code: string;
  severity: Severity;
  message: string;
  nodeId?: string;
  blockId?: string;
}

export interface ValidationResult {
  messages: ValidationMessage[];
  /** True iff there are zero error-severity messages (E001-E007). */
  ok: boolean;
  /** Present only when ok === true. */
  normalized: NormalizedProcedure | null;
}

const EXPECTED_MCREATOR_VERSION = '2025.1';

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

/** Effective `check` type to use for E006 when a value input is one of the
 * dynamic mutator-added names above (not present in blocks_full.json). */
function dynamicValueInputCheck(blockId: string, key: string): string | string[] | null {
  if (blockId === 'controls_if' && /^IF\d+$/.test(key)) return 'Boolean';
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Step 1: JSON.parse with E001 on failure. Kept separate so callers can
 * show a parse error before ever touching schema validation. */
export function parseJson(text: string): { data: unknown } | { error: ValidationMessage } {
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

/** Flattens `next`-chains within a sequence array into a flat ordered array. */
function flattenChain(nodes: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const n of nodes) {
    if (!isPlainObject(n)) {
      // Non-object entries: keep them as-is so downstream reports E002.
      out.push(n);
      continue;
    }
    let cur: Record<string, unknown> = n;
    let guard = 0; // guard against pathological next-cycles
    for (;;) {
      const { next, ...rest } = cur;
      out.push(rest);
      if (!isPlainObject(next) || guard >= 10000) break;
      cur = next;
      guard += 1;
    }
  }
  return out;
}

interface Ctx {
  ref: FullReferenceData;
  dropdownOptions: DropdownOptionsMap;
  messages: ValidationMessage[];
  seenIds: Set<string>;
  depsUsed: Set<string>;
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

function pushMsg(ctx: Ctx, msg: ValidationMessage): void {
  ctx.messages.push(msg);
}

function checkIgnoredKeys(ctx: Ctx, raw: Record<string, unknown>, nodeId: string, blockId: string): void {
  for (const key of IGNORED_NODE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      pushMsg(ctx, {
        code: 'I001',
        severity: 'info',
        message: `ノード ${nodeId}（block_id: ${blockId}）のキー "${key}" は無視しました。`,
        nodeId,
        blockId,
      });
    }
  }
}

/**
 * Validates + normalizes a single BlockNode. Returns null when the node
 * cannot be normalized (missing/invalid shape, unknown block_id, etc) —
 * callers should not attach a null result into the normalized tree, but
 * MUST still have let this function run so nested errors are surfaced.
 */
function validateNode(ctx: Ctx, raw: unknown, expectedShape: 'statement' | 'value'): NormalizedNode | null {
  if (!isPlainObject(raw)) {
    pushMsg(ctx, {
      code: 'E002',
      severity: 'error',
      message: `ブロックノードがオブジェクトではありません: ${JSON.stringify(raw)}`,
    });
    return null;
  }

  const node_id = raw.node_id;
  const block_id = raw.block_id;

  if (typeof node_id !== 'string' || node_id.length === 0) {
    pushMsg(ctx, {
      code: 'E002',
      severity: 'error',
      message: `node_id が欠落しているか不正です（block_id: ${typeof block_id === 'string' ? block_id : '不明'}）。`,
      blockId: typeof block_id === 'string' ? block_id : undefined,
    });
    return null;
  }
  const nodeId = node_id;

  if (typeof block_id !== 'string' || block_id.length === 0) {
    pushMsg(ctx, {
      code: 'E002',
      severity: 'error',
      message: `ノード ${nodeId} の block_id が欠落しているか不正です。`,
      nodeId,
    });
    return null;
  }
  const blockId = block_id;

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

  checkIgnoredKeys(ctx, raw, nodeId, blockId);

  const def: FullBlockDef | undefined = ctx.ref.blocks[blockId];
  if (!def) {
    pushMsg(ctx, {
      code: 'E003',
      severity: 'error',
      message: `ノード ${nodeId} の block_id "${blockId}" は blocks_full.json に存在しません。`,
      nodeId,
      blockId,
    });
    // Still recurse into children so nested problems are also reported,
    // even though this node itself can't be normalized.
    recurseUnknownChildren(ctx, raw);
    return null;
  }

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

  for (const depName of def.dependencies) {
    const name = depName.split(':')[0];
    if (name) ctx.depsUsed.add(name);
  }

  // --- fields ---
  const fields: Record<string, string> = {};
  const rawFields = raw.fields;
  if (rawFields !== undefined) {
    if (!isPlainObject(rawFields)) {
      pushMsg(ctx, {
        code: 'E002',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の fields はオブジェクトではありません。`,
        nodeId,
        blockId,
      });
    } else {
      for (const [key, value] of Object.entries(rawFields)) {
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
                // Display label used instead of the machine value: accept it,
                // auto-convert for rendering, but warn (this is the general
                // form of the math_binary_ops/logic_boolean casing issue).
                const originalValue = strValue;
                strValue = labelMatch[1];
                fields[key] = strValue;
                pushMsg(ctx, {
                  code: 'W002',
                  severity: 'warn',
                  message: `ノード ${nodeId}（block_id: ${blockId}）の field "${key}" の値 "${originalValue}" はBlocklyの機械値ではなく表示ラベルです。機械値 "${labelMatch[1]}" として解釈して描画します（本来は機械値を指定してください）。`,
                  nodeId,
                  blockId,
                });
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
        }
      }
    }
  }

  // --- value_inputs ---
  const valueInputs: Record<string, NormalizedNode> = {};
  const rawValueInputs = raw.value_inputs;
  if (rawValueInputs !== undefined) {
    if (!isPlainObject(rawValueInputs)) {
      pushMsg(ctx, {
        code: 'E002',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の value_inputs はオブジェクトではありません。`,
        nodeId,
        blockId,
      });
    } else {
      for (const [key, childRaw] of Object.entries(rawValueInputs)) {
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
          validateNode(ctx, childRaw, 'value');
          continue;
        }
        const effectiveCheck = inputDef ? inputDef.check : dynamicValueInputCheck(blockId, key);
        const child = validateNode(ctx, childRaw, 'value');
        // Type-compatibility check (E006), performed whenever the child's
        // block_id resolves to a known definition (independent of whether
        // the child fully validated, so a shape mismatch doesn't hide a
        // separate type mismatch).
        const childBlockId = isPlainObject(childRaw) ? childRaw.block_id : undefined;
        if (typeof childBlockId === 'string' && ctx.ref.blocks[childBlockId]) {
          const childOutputType = ctx.ref.blocks[childBlockId].output_type;
          if (!isCheckCompatible(childOutputType, effectiveCheck)) {
            pushMsg(ctx, {
              code: 'E006',
              severity: 'error',
              message: `ノード ${nodeId}（block_id: ${blockId}）の入力 "${key}" は型 ${JSON.stringify(effectiveCheck)} を要求しますが、接続されたブロック（block_id: ${childBlockId}）の出力型 ${JSON.stringify(childOutputType)} と適合しません。`,
              nodeId,
              blockId,
            });
          }
        }
        if (child) valueInputs[key] = child;
      }
    }
  }

  // --- statement_inputs ---
  const statementInputs: Record<string, NormalizedNode[]> = {};
  const rawStatementInputs = raw.statement_inputs;
  if (rawStatementInputs !== undefined) {
    if (!isPlainObject(rawStatementInputs)) {
      pushMsg(ctx, {
        code: 'E002',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の statement_inputs はオブジェクトではありません。`,
        nodeId,
        blockId,
      });
    } else {
      for (const [key, listRaw] of Object.entries(rawStatementInputs)) {
        const has =
          def.statement_inputs.includes(key) || matchesDynamicPattern(DYNAMIC_STATEMENT_INPUT_PATTERNS, blockId, key);
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
        if (!Array.isArray(listRaw)) {
          pushMsg(ctx, {
            code: 'E002',
            severity: 'error',
            message: `ノード ${nodeId}（block_id: ${blockId}）の statement_inputs["${key}"] は配列ではありません。`,
            nodeId,
            blockId,
          });
          continue;
        }
        const flat = flattenChain(listRaw);
        const children: NormalizedNode[] = [];
        for (const childRaw of flat) {
          const child = validateNode(ctx, childRaw, 'statement');
          if (child) children.push(child);
        }
        statementInputs[key] = children;
      }
    }
  }

  return { nodeId, blockId, fields, valueInputs, statementInputs };
}

/** When block_id itself is unknown (E003), we still recurse into whatever
 * value_inputs/statement_inputs are present so nested errors are reported. */
function recurseUnknownChildren(ctx: Ctx, raw: Record<string, unknown>): void {
  const vi = raw.value_inputs;
  if (isPlainObject(vi)) {
    for (const childRaw of Object.values(vi)) {
      validateNode(ctx, childRaw, 'value');
    }
  }
  const si = raw.statement_inputs;
  if (isPlainObject(si)) {
    for (const listRaw of Object.values(si)) {
      if (Array.isArray(listRaw)) {
        for (const childRaw of flattenChain(listRaw)) {
          validateNode(ctx, childRaw, 'statement');
        }
      }
    }
  }
}

export function validateProcedure(
  raw: unknown,
  ref: FullReferenceData,
  dropdownOptions: DropdownOptionsMap,
): ValidationResult {
  const messages: ValidationMessage[] = [];
  const ctx: Ctx = { ref, dropdownOptions, messages, seenIds: new Set(), depsUsed: new Set() };

  if (!isPlainObject(raw)) {
    messages.push({
      code: 'E002',
      severity: 'error',
      message: '入力JSONのルートはオブジェクトである必要があります。',
    });
    return { messages, ok: false, normalized: null };
  }
  const doc = raw as RawProcedureDoc;

  if (doc.format_version !== 1) {
    messages.push({
      code: 'E002',
      severity: 'error',
      message: `format_version は 1 のみ受理されます（実際: ${JSON.stringify(doc.format_version)}）。`,
    });
  }

  if (typeof doc.procedure_name !== 'string' || doc.procedure_name.length === 0) {
    messages.push({
      code: 'E002',
      severity: 'error',
      message: 'procedure_name が欠落しているか不正です。',
    });
  }

  if (
    doc.mcreator_version !== undefined &&
    doc.mcreator_version !== null &&
    doc.mcreator_version !== EXPECTED_MCREATOR_VERSION
  ) {
    messages.push({
      code: 'W003',
      severity: 'warn',
      message: `mcreator_version "${String(doc.mcreator_version)}" は想定 "${EXPECTED_MCREATOR_VERSION}" と一致しません。`,
    });
  }

  let trigger: string | null = null;
  if (doc.trigger !== undefined && doc.trigger !== null) {
    if (typeof doc.trigger !== 'string') {
      messages.push({
        code: 'E002',
        severity: 'error',
        message: `trigger は string または null である必要があります（実際: ${JSON.stringify(doc.trigger)}）。`,
      });
    } else {
      trigger = doc.trigger;
    }
  }

  if (!Array.isArray(doc.blocks)) {
    messages.push({
      code: 'E002',
      severity: 'error',
      message: 'blocks は配列である必要があります。',
    });
    return { messages, ok: false, normalized: null };
  }

  const flatTop = flattenChain(doc.blocks);
  const sequence: NormalizedNode[] = [];
  for (const childRaw of flatTop) {
    const child = validateNode(ctx, childRaw, 'statement');
    if (child) sequence.push(child);
  }

  if (ctx.depsUsed.size > 0) {
    const names = Array.from(ctx.depsUsed).sort();
    messages.push({
      code: 'W001',
      severity: 'warn',
      message: `このプロシージャは次の依存関係を要求: ${names.join(', ')}（トリガーが提供しない場合MCreatorで警告）`,
    });
  }

  const hasError = messages.some((m) => m.severity === 'error');
  const procedureName = typeof doc.procedure_name === 'string' ? doc.procedure_name : 'procedure';

  return {
    messages,
    ok: !hasError,
    normalized: hasError ? null : { procedureName, trigger, sequence },
  };
}

/** Convenience wrapper: parses raw JSON text and validates it in one call. */
export function validateProcedureText(
  text: string,
  ref: FullReferenceData,
  dropdownOptions: DropdownOptionsMap,
): ValidationResult {
  const parsed = parseJson(text);
  if ('error' in parsed) {
    return { messages: [parsed.error], ok: false, normalized: null };
  }
  return validateProcedure(parsed.data, ref, dropdownOptions);
}
