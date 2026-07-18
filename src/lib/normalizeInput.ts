/**
 * Structural normalization layer (SPEC.md v1.2 §3/§5): reconciles the
 * original nested-object input form with the newer flat graph form (node_id
 * string references) — and any mix of the two — into a single internal
 * representation (`ResolvedDoc`/`ResolvedNode`) that validate.ts can walk
 * without caring which form the input used.
 *
 * This module purposely knows about blocks_full.json's `shape` (needed for
 * root/orphan classification, rule 5/6) but nothing else about block
 * semantics — it never checks whether a block_id exists, whether an input
 * name is valid, or field values. That's validate.ts's job, run afterwards
 * on the ResolvedDoc this module produces.
 *
 * Pipeline: raw JSON -> normalizeInput() -> ResolvedDoc -> validate.ts.
 * Normalization always runs before validation.
 */
import type { FullReferenceData } from './referenceTypes';
import type { RawProcedureDoc } from './inputTypes';
import { KNOWN_NODE_KEYS } from './inputTypes';
import type { ResolvedDoc, ResolvedNode, ResolvedTrigger } from './resolvedTypes';
import type { ValidationMessage } from './messages';

const EXPECTED_MCREATOR_VERSION = '2025.1';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** SPEC v1.2 rule 1: 1, "1", 1.0, "1.0" all normalize to the number 1. */
function isAcceptableFormatVersion(v: unknown): boolean {
  if (v === 1) return true;
  if (typeof v === 'string' && (v === '1' || v === '1.0')) return true;
  if (typeof v === 'number' && v === 1.0) return true;
  return false;
}

/** SPEC v1.2 rule 4: a statement_inputs value may be a single string/object
 * (wrapped into a one-element array), an array, or absent/null (empty). */
function toArrayValue(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
}

/** Precedence tiers for SPEC v1.2 rule 7 (multi-reference dedup):
 * value_inputs > statement_inputs > next. Lower wins. */
type EdgeTier = 0 | 1 | 2;
const TIER_LABEL: Record<EdgeTier, string> = { 0: 'value_inputs', 1: 'statement_inputs', 2: 'next' };

interface Edge {
  targetId: string;
  tier: EdgeTier;
  /** node_id of the node that owns this reference (the "from" side). */
  sourceNodeId: string;
  /** Stable identity for this reference occurrence, independent of
   * traversal order, so the resolution pass can re-derive it and check
   * "did I win?" without needing to replay collection order. */
  slotKey: string;
  /** Human-readable description of where this reference occurs, for W006 messages. */
  sourceLabel: string;
}

function ownNodeId(node: Record<string, unknown>): string {
  return typeof node.node_id === 'string' && node.node_id.length > 0 ? node.node_id : '<invalid>';
}

function isStructurallyResolvable(node: unknown): node is Record<string, unknown> {
  return (
    isPlainObject(node) &&
    typeof node.node_id === 'string' &&
    node.node_id.length > 0 &&
    typeof node.block_id === 'string' &&
    node.block_id.length > 0
  );
}

/**
 * Walks a node (top-level or inline) collecting every node_id-string
 * reference it (or anything nested inline inside it) makes, plus every
 * distinct node object encountered (for the global unknown-key aggregation).
 * Does not follow string references — those targets get their own
 * collectRefs call when the top-level loop reaches them (or, if only
 * reachable via reference, they aren't walked further here at all, which is
 * fine: we only need edges *out of* nodes that exist, and inline objects are
 * walked in place since they aren't otherwise reachable).
 */
function collectRefs(node: unknown, edges: Edge[], unknownKeys: Set<string>): void {
  if (!isStructurallyResolvable(node)) return;
  const nid = ownNodeId(node);

  for (const key of Object.keys(node)) {
    if (!KNOWN_NODE_KEYS.has(key)) unknownKeys.add(key);
  }

  const valueInputs = node.value_inputs;
  if (isPlainObject(valueInputs)) {
    for (const [key, val] of Object.entries(valueInputs)) {
      const slotKey = `V:${nid}:${key}`;
      if (typeof val === 'string') {
        edges.push({ targetId: val, tier: 0, sourceNodeId: nid, slotKey, sourceLabel: `ノード ${nid} の value_inputs["${key}"]` });
      } else if (isPlainObject(val)) {
        collectRefs(val, edges, unknownKeys);
      }
    }
  }

  const statementInputs = node.statement_inputs;
  if (isPlainObject(statementInputs)) {
    for (const [key, rawVal] of Object.entries(statementInputs)) {
      const arr = toArrayValue(rawVal);
      arr.forEach((item, idx) => {
        const slotKey = `S:${nid}:${key}:${idx}`;
        if (typeof item === 'string') {
          edges.push({
            targetId: item,
            tier: 1,
            sourceNodeId: nid,
            slotKey,
            sourceLabel: `ノード ${nid} の statement_inputs["${key}"][${idx}]`,
          });
        } else if (isPlainObject(item)) {
          collectRefs(item, edges, unknownKeys);
        }
      });
    }
  }

  const next = node.next;
  if (typeof next === 'string') {
    edges.push({ targetId: next, tier: 2, sourceNodeId: nid, slotKey: `N:${nid}`, sourceLabel: `ノード ${nid} の next` });
  } else if (isPlainObject(next)) {
    collectRefs(next, edges, unknownKeys);
  }
}

interface WinnerInfo {
  edge: Edge;
  sourceNodeId: string;
}

/** Resolves multi-reference conflicts (SPEC v1.2 rule 7): groups edges by
 * target, keeps the highest-precedence one, and emits W006 for the rest. */
function resolveWinners(
  edges: Edge[],
  messages: ValidationMessage[],
): { winningSlotKeys: Set<string>; referencedIds: Set<string> } {
  const byTarget = new Map<string, Edge[]>();
  for (const e of edges) {
    const list = byTarget.get(e.targetId);
    if (list) list.push(e);
    else byTarget.set(e.targetId, [e]);
  }

  const winningSlotKeys = new Set<string>();
  for (const [targetId, list] of byTarget) {
    if (list.length === 1) {
      winningSlotKeys.add(list[0].slotKey);
      continue;
    }
    const sorted = [...list].sort((a, b) => a.tier - b.tier);
    winningSlotKeys.add(sorted[0].slotKey);
    for (const loser of sorted.slice(1)) {
      messages.push({
        code: 'W006',
        severity: 'warn',
        message: `node_id "${targetId}" が複数箇所から参照されています。${loser.sourceLabel}（${TIER_LABEL[loser.tier]}）からの参照は他の参照（優先順位: value_inputs > statement_inputs > next）により無視され、切断されました。`,
      });
    }
  }

  return { winningSlotKeys, referencedIds: new Set(byTarget.keys()) };
}

interface ResolveCtx {
  registry: Map<string, Record<string, unknown>>;
  winningSlotKeys: Set<string>;
  messages: ValidationMessage[];
  visited: Set<string>;
  parentOfTarget: Map<string, WinnerInfo>; // targetId -> winning edge + its source node id
  childrenOfSource: Map<string, string[]>; // sourceId -> [targetId, ...] (value/statement tiers only)
}

function resolveSlot(val: unknown, slotKey: string, path: ReadonlySet<string>, ctx: ResolveCtx): ResolvedNode | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    if (!ctx.winningSlotKeys.has(slotKey)) return null; // lost a multi-reference race; already warned (W006)
    const target = ctx.registry.get(val);
    if (!target) {
      ctx.messages.push({
        code: 'E008',
        severity: 'error',
        message: `node_id "${val}" が見つかりません。`,
      });
      return null;
    }
    return resolveNode(target, path, ctx);
  }
  if (isPlainObject(val)) {
    return resolveNode(val, path, ctx);
  }
  ctx.messages.push({
    code: 'E002',
    severity: 'error',
    message: `ブロックノードとして解釈できない値です: ${JSON.stringify(val)}`,
  });
  return null;
}

function resolveNode(raw: unknown, path: ReadonlySet<string>, ctx: ResolveCtx): ResolvedNode | null {
  if (!isPlainObject(raw)) {
    ctx.messages.push({
      code: 'E002',
      severity: 'error',
      message: `ブロックノードがオブジェクトではありません: ${JSON.stringify(raw)}`,
    });
    return null;
  }

  const node_id = raw.node_id;
  const block_id = raw.block_id;

  if (typeof node_id !== 'string' || node_id.length === 0) {
    ctx.messages.push({
      code: 'E002',
      severity: 'error',
      message: `node_id が欠落しているか不正です（block_id: ${typeof block_id === 'string' ? block_id : '不明'}）。`,
      blockId: typeof block_id === 'string' ? block_id : undefined,
    });
    return null;
  }
  const nodeId = node_id;

  if (path.has(nodeId)) {
    const cyclePath = [...path, nodeId];
    ctx.messages.push({
      code: 'E009',
      severity: 'error',
      message: `循環参照を検出しました: ${cyclePath.join(' -> ')}`,
      nodeId,
    });
    return null;
  }

  if (typeof block_id !== 'string' || block_id.length === 0) {
    ctx.messages.push({
      code: 'E002',
      severity: 'error',
      message: `ノード ${nodeId} の block_id が欠落しているか不正です。`,
      nodeId,
    });
    return null;
  }
  const blockId = block_id;

  ctx.visited.add(nodeId);
  const newPath = new Set(path);
  newPath.add(nodeId);

  let fieldsRaw: Record<string, unknown> = {};
  if (raw.fields !== undefined) {
    if (!isPlainObject(raw.fields)) {
      ctx.messages.push({
        code: 'E002',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の fields はオブジェクトではありません。`,
        nodeId,
        blockId,
      });
    } else {
      fieldsRaw = raw.fields;
    }
  }

  const valueInputs: Record<string, ResolvedNode> = {};
  if (raw.value_inputs !== undefined) {
    if (!isPlainObject(raw.value_inputs)) {
      ctx.messages.push({
        code: 'E002',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の value_inputs はオブジェクトではありません。`,
        nodeId,
        blockId,
      });
    } else {
      for (const [key, val] of Object.entries(raw.value_inputs)) {
        const slotKey = `V:${nodeId}:${key}`;
        const child = resolveSlot(val, slotKey, newPath, ctx);
        if (child) valueInputs[key] = child;
      }
    }
  }

  const statementInputs: Record<string, ResolvedNode[]> = {};
  if (raw.statement_inputs !== undefined) {
    if (!isPlainObject(raw.statement_inputs)) {
      ctx.messages.push({
        code: 'E002',
        severity: 'error',
        message: `ノード ${nodeId}（block_id: ${blockId}）の statement_inputs はオブジェクトではありません。`,
        nodeId,
        blockId,
      });
    } else {
      for (const [key, rawVal] of Object.entries(raw.statement_inputs)) {
        const arr = toArrayValue(rawVal);
        const children: ResolvedNode[] = [];
        arr.forEach((item, idx) => {
          const slotKey = `S:${nodeId}:${key}:${idx}`;
          const child = resolveSlot(item, slotKey, newPath, ctx);
          if (child) children.push(child);
        });
        statementInputs[key] = children;
      }
    }
  }

  const next = resolveSlot(raw.next, `N:${nodeId}`, newPath, ctx);

  const winner = ctx.parentOfTarget.get(nodeId);
  return {
    nodeId,
    blockId,
    fieldsRaw,
    valueInputs,
    statementInputs,
    next,
    rawType: typeof raw.type === 'string' ? raw.type : undefined,
    rawParent: raw.parent,
    rawPrevious: raw.previous,
    rawChildren: raw.children,
    actualParentId: winner && winner.edge.tier !== 2 ? winner.sourceNodeId : undefined,
    actualPreviousId: winner && winner.edge.tier === 2 ? winner.sourceNodeId : undefined,
    actualChildrenIds: [...(ctx.childrenOfSource.get(nodeId) ?? [])].sort(),
  };
}

/** Flattens a resolved node's `next`-chain into an ordered array (mirrors
 * the old flattenChain, just operating on already-resolved nodes). */
function flattenNextChain(head: ResolvedNode): ResolvedNode[] {
  const out: ResolvedNode[] = [];
  let cur: ResolvedNode | null = head;
  let guard = 0;
  while (cur && guard < 100000) {
    out.push(cur);
    cur = cur.next;
    guard += 1;
  }
  return out;
}

export interface NormalizeInputResult {
  messages: ValidationMessage[];
  doc: ResolvedDoc | null;
}

function resolveTrigger(raw: unknown, messages: ValidationMessage[]): ResolvedTrigger {
  if (raw === undefined || raw === null) {
    return { name: null, providedDeps: new Set() };
  }
  if (typeof raw === 'string') {
    return { name: raw, providedDeps: new Set() };
  }
  if (isPlainObject(raw)) {
    const typeVal = raw.type;
    if (typeof typeVal !== 'string' || typeVal.length === 0) {
      messages.push({
        code: 'E002',
        severity: 'error',
        message: `trigger オブジェクトの type が欠落しているか不正です（実際: ${JSON.stringify(raw)}）。`,
      });
      return { name: null, providedDeps: new Set() };
    }
    const deps = new Set<string>();
    if (raw.dependencies !== undefined) {
      if (Array.isArray(raw.dependencies)) {
        for (const d of raw.dependencies) {
          if (typeof d === 'string' && d.length > 0) {
            const name = d.split(':')[0];
            if (name) deps.add(name);
          }
        }
      } else {
        messages.push({
          code: 'E002',
          severity: 'error',
          message: `trigger.dependencies は配列である必要があります（実際: ${JSON.stringify(raw.dependencies)}）。`,
        });
      }
    }
    return { name: typeVal, providedDeps: deps };
  }
  messages.push({
    code: 'E002',
    severity: 'error',
    message: `trigger は string、null、または {type, dependencies?} オブジェクトである必要があります（実際: ${JSON.stringify(raw)}）。`,
  });
  return { name: null, providedDeps: new Set() };
}

/** Normalizes any accepted input shape (nested, flat graph, or a mix) into a
 * ResolvedDoc. Returns `doc: null` only when the document is too malformed
 * to proceed at all (not an object, blocks not an array, etc) — otherwise
 * returns a ResolvedDoc even in the presence of E-level messages, since
 * validate.ts (and the overall E00x-gates-rendering rule) is what decides
 * whether to stop; normalizeInput always tries to surface as many structural
 * problems as it can in one pass. */
export function normalizeInput(raw: unknown, ref: FullReferenceData): NormalizeInputResult {
  const messages: ValidationMessage[] = [];

  if (!isPlainObject(raw)) {
    messages.push({
      code: 'E002',
      severity: 'error',
      message: '入力JSONのルートはオブジェクトである必要があります。',
    });
    return { messages, doc: null };
  }
  const rawDoc = raw as RawProcedureDoc;

  if (!isAcceptableFormatVersion(rawDoc.format_version)) {
    messages.push({
      code: 'E002',
      severity: 'error',
      message: `format_version は 1（1, "1", 1.0, "1.0" のいずれか）のみ受理されます（実際: ${JSON.stringify(rawDoc.format_version)}）。`,
    });
  }

  if (typeof rawDoc.procedure_name !== 'string' || rawDoc.procedure_name.length === 0) {
    messages.push({
      code: 'E002',
      severity: 'error',
      message: 'procedure_name が欠落しているか不正です。',
    });
  }
  const procedureName = typeof rawDoc.procedure_name === 'string' ? rawDoc.procedure_name : 'procedure';

  let mcreatorVersion: string | undefined;
  if (rawDoc.mcreator_version !== undefined && rawDoc.mcreator_version !== null) {
    mcreatorVersion = String(rawDoc.mcreator_version);
    if (mcreatorVersion !== EXPECTED_MCREATOR_VERSION) {
      messages.push({
        code: 'W003',
        severity: 'warn',
        message: `mcreator_version "${mcreatorVersion}" は想定 "${EXPECTED_MCREATOR_VERSION}" と一致しません。`,
      });
    }
  }

  const trigger = resolveTrigger(rawDoc.trigger, messages);

  if (!Array.isArray(rawDoc.blocks)) {
    messages.push({
      code: 'E002',
      severity: 'error',
      message: 'blocks は配列である必要があります。',
    });
    return { messages, doc: null };
  }

  // --- Phase 1: registry of top-level entries (dedup by node_id, E002 on
  // true top-level duplicates). Entries too malformed to even have a usable
  // node_id are reported immediately and excluded from the graph entirely —
  // there's nothing meaningful to reference-track for them.
  const registry = new Map<string, Record<string, unknown>>();
  const topLevelOrder: string[] = [];
  for (const entry of rawDoc.blocks) {
    if (!isPlainObject(entry)) {
      messages.push({
        code: 'E002',
        severity: 'error',
        message: `ブロックノードがオブジェクトではありません: ${JSON.stringify(entry)}`,
      });
      continue;
    }
    if (typeof entry.node_id !== 'string' || entry.node_id.length === 0) {
      messages.push({
        code: 'E002',
        severity: 'error',
        message: `node_id が欠落しているか不正です（block_id: ${typeof entry.block_id === 'string' ? entry.block_id : '不明'}）。`,
        blockId: typeof entry.block_id === 'string' ? entry.block_id : undefined,
      });
      continue;
    }
    const nodeId = entry.node_id;
    if (registry.has(nodeId)) {
      messages.push({
        code: 'E002',
        severity: 'error',
        message: `node_id "${nodeId}" が重複しています（blocks配列のトップレベル）。`,
        nodeId,
      });
      continue;
    }
    registry.set(nodeId, entry);
    topLevelOrder.push(nodeId);
  }

  // --- Phase 2: collect every node_id-string reference in the document ---
  const unknownKeys = new Set<string>();
  const edges: Edge[] = [];
  for (const nodeId of topLevelOrder) {
    const entry = registry.get(nodeId);
    if (entry) collectRefs(entry, edges, unknownKeys);
  }
  if (unknownKeys.size > 0) {
    messages.push({
      code: 'I001',
      severity: 'info',
      message: `未知のキーを無視しました: ${[...unknownKeys].sort().join(', ')}`,
    });
  }

  // --- Mode detection (v1 compatibility) ---
  // v1's public contract was "blocks array = one top-to-bottom main
  // sequence" (README/SPEC v1). A document that contains *zero* node_id
  // string references anywhere is, by definition, a pure old-style nested
  // document — nothing in it could possibly rely on the new flat graph
  // semantics, since that's exactly what a string reference is. For such
  // documents we must keep the v1 behavior of auto-chaining every
  // unreferenced top-level entry into a single main sequence in array order
  // (no W004) — otherwise a v1-style multi-entry document (never tested by
  // the original 3 samples, but promised by the original README/SPEC) would
  // silently break into disconnected stacks under v1.2. Any document with at
  // least one string reference is unambiguously using the new graph format,
  // where connections are only ever explicit (next/statement_inputs/
  // value_inputs) — array order carries no meaning there.
  const mode: 'graph' | 'legacy' = edges.length > 0 ? 'graph' : 'legacy';

  // --- Phase 3: resolve multi-reference precedence (rule 7, W006) ---
  const { winningSlotKeys, referencedIds } = resolveWinners(edges, messages);

  // Derive actual-parent/previous/children maps from the winning edges only,
  // for the W007 metadata-contradiction checks (validate.ts consumes these).
  const parentOfTarget = new Map<string, WinnerInfo>();
  const childrenOfSource = new Map<string, string[]>();
  for (const e of edges) {
    if (!winningSlotKeys.has(e.slotKey)) continue;
    parentOfTarget.set(e.targetId, { edge: e, sourceNodeId: e.sourceNodeId });
    if (e.tier !== 2) {
      const list = childrenOfSource.get(e.sourceNodeId);
      if (list) list.push(e.targetId);
      else childrenOfSource.set(e.sourceNodeId, [e.targetId]);
    }
  }

  const ctx: ResolveCtx = {
    registry,
    winningSlotKeys,
    messages,
    visited: new Set(),
    parentOfTarget,
    childrenOfSource,
  };

  // --- Phase 4: root/orphan classification (rules 5 & 6) ---
  const stacks: ResolvedNode[][] = [];

  const tryRoot = (nodeId: string): void => {
    if (ctx.visited.has(nodeId)) return;
    const entry = registry.get(nodeId);
    if (!entry) return;
    const blockIdRaw = entry.block_id;
    const shape = typeof blockIdRaw === 'string' ? ref.blocks[blockIdRaw]?.shape : undefined;
    if (shape === 'value') {
      ctx.visited.add(nodeId);
      messages.push({
        code: 'W005',
        severity: 'warn',
        message: `ノード ${nodeId}（block_id: ${String(blockIdRaw)}）はどこからも参照されていない値(value)ブロックのため描画しません。`,
        nodeId,
        blockId: typeof blockIdRaw === 'string' ? blockIdRaw : undefined,
      });
      return;
    }
    // shape is 'statement', 'hat', or unknown (invalid block_id — treated as
    // a root candidate anyway so validate.ts's E003 still surfaces it).
    const resolved = resolveNode(entry, new Set(), ctx);
    if (resolved) {
      stacks.push(flattenNextChain(resolved));
    }
  };

  // Primary pass: genuinely unreferenced top-level entries, in document order.
  for (const nodeId of topLevelOrder) {
    if (referencedIds.has(nodeId)) continue;
    tryRoot(nodeId);
  }
  // Sweep pass: anything left over (only reachable through cyclic islands
  // that never got visited by the primary pass) still gets a resolution
  // attempt, so purely-cyclic islands still surface E009 (SPEC v1.2 rule 3)
  // instead of silently vanishing.
  for (const nodeId of topLevelOrder) {
    tryRoot(nodeId);
  }

  let finalStacks: ResolvedNode[][];
  if (mode === 'legacy') {
    // v1 compatibility: no string references anywhere means this can only be
    // a pure nested-format document. Honor v1's contract by auto-chaining
    // every unreferenced root, in blocks-array order, into a single main
    // sequence — no W004, and no notification either (this was simply normal
    // v1 behavior, not something worth flagging).
    finalStacks = stacks.length > 0 ? [stacks.flat()] : [];
  } else {
    finalStacks = stacks;
    if (finalStacks.length > 1) {
      for (let i = 1; i < finalStacks.length; i += 1) {
        const first = finalStacks[i][0];
        messages.push({
          code: 'W004',
          severity: 'warn',
          message: `ノード ${first?.nodeId ?? '?'} から始まる接続されていないステートメント列があります。独立したスタックとして描画します。`,
          nodeId: first?.nodeId,
          blockId: first?.blockId,
        });
      }
    }
  }

  return {
    messages,
    doc: {
      procedureName,
      mcreatorVersion,
      trigger,
      stacks: finalStacks,
      mode,
    },
  };
}
