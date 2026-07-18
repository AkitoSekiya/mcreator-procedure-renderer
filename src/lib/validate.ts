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
import type { FullReferenceData, FullBlockDef } from './referenceTypes';
import type { ResolvedNode } from './resolvedTypes';
import { normalizeInput } from './normalizeInput';
import type { NormalizedNode, NormalizedProcedure } from './normalizedTypes';
import { findDropdownOptions, type DropdownOptionsMap } from './dropdownOptions';
import type { ValidationMessage } from './messages';

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
 */
function validateNode(ctx: Ctx, node: ResolvedNode, expectedShape: 'statement' | 'value'): NormalizedNode | null {
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
    for (const child of Object.values(node.valueInputs)) validateNode(ctx, child, 'value');
    for (const children of Object.values(node.statementInputs)) {
      for (const child of children) validateNode(ctx, child, 'statement');
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

  for (const depName of def.dependencies) {
    const name = depName.split(':')[0];
    if (name) ctx.depsUsed.add(name);
  }

  if (def.required_apis && def.required_apis.length > 0 && !ctx.requiredApiBlocksReported.has(nodeId)) {
    ctx.requiredApiBlocksReported.add(nodeId);
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
      validateNode(ctx, childNode, 'value');
      continue;
    }
    const effectiveCheck = inputDef ? inputDef.check : dynamicValueInputCheck(blockId, key);
    const child = validateNode(ctx, childNode, 'value');
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
    const children: NormalizedNode[] = [];
    for (const childNode of childList) {
      const child = validateNode(ctx, childNode, 'statement');
      if (child) children.push(child);
    }
    statementInputs[key] = children;
  }

  return { nodeId, blockId, fields, valueInputs, statementInputs };
}

export function validateProcedure(
  raw: unknown,
  ref: FullReferenceData,
  dropdownOptions: DropdownOptionsMap,
): ValidationResult {
  const { messages: normalizeMessages, doc } = normalizeInput(raw, ref);

  if (!doc) {
    return { messages: normalizeMessages, ok: false, normalized: null };
  }

  const ctx: Ctx = {
    ref,
    dropdownOptions,
    messages: [...normalizeMessages],
    seenIds: new Set(),
    depsUsed: new Set(),
    requiredApiBlocksReported: new Set(),
  };

  const stacks: NormalizedNode[][] = doc.stacks.map((stack) =>
    stack.map((node) => validateNode(ctx, node, 'statement')).filter((n): n is NormalizedNode => n !== null),
  );

  // SPEC v1.2 rule 2: W001 shows only the deps the used blocks require minus
  // what the trigger declares it provides (by name, "entity:entity" style).
  const missingDeps = [...ctx.depsUsed].filter((d) => !doc.trigger.providedDeps.has(d));
  if (missingDeps.length > 0) {
    ctx.messages.push({
      code: 'W001',
      severity: 'warn',
      message: `このプロシージャは次の依存関係を要求: ${missingDeps.sort().join(', ')}（トリガーが提供しない場合MCreatorで警告）`,
    });
  }

  const hasError = ctx.messages.some((m) => m.severity === 'error');

  return {
    messages: ctx.messages,
    ok: !hasError,
    normalized: hasError ? null : { procedureName: doc.procedureName, trigger: doc.trigger.name, stacks },
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

// Re-exported for convenience so callers don't need to import from two
// different modules for the common case.
export type { ResolvedDoc, ResolvedNode } from './resolvedTypes';
