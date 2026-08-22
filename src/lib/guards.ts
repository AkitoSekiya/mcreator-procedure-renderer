/**
 * Structural safety limits shared by normalizeInput.ts and validate.ts
 * (SPEC.md security/perf review): prototype-pollution-prone key rejection,
 * and size/depth caps against pathological or malicious input. Pure,
 * data-independent logic — no reference-data lookups, so it's exercisable
 * from plain Node scripts/tests like the rest of src/lib.
 */

/**
 * `__proto__`/`constructor`/`prototype` are reserved on every plain object.
 * `JSON.parse` itself is safe (it defines these as ordinary *own* data
 * properties, not accessors), but code elsewhere in this app re-keys parsed
 * data into *fresh* `{}` accumulators via bracket assignment
 * (`obj[key] = value`) — e.g. building `ResolvedNode.valueInputs` /
 * `NormalizedNode.fields` from `Object.entries(...)`. Assigning through
 * `"__proto__"` there invokes `Object.prototype`'s accessor and can silently
 * repoint that *one* object's own prototype chain (dropping whatever value
 * was meant to be stored under that key, since it's no longer a plain data
 * property), which reads to callers as data quietly vanishing rather than an
 * obvious crash. `"constructor"`/`"prototype"` are excluded too since MCreator
 * itself never emits blocks using them and letting them through buys nothing.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

/** Max nesting depth for inline (non-string-reference) BlockNode graphs —
 * guards resolveNode's recursion against a stack overflow from pathological
 * or malicious input (e.g. thousands of levels of inline value_inputs).
 * Real MCreator procedures never come close to this. */
export const MAX_NESTING_DEPTH = 500;

/** Max raw JSON text length accepted before even attempting JSON.parse
 * (bytes, as measured by `string.length`). 5MB is already far beyond any
 * realistic MCreator procedure (a single block averages well under 1KB
 * serialized), so this only ever rejects deliberately-oversized input. */
export const MAX_INPUT_JSON_LENGTH = 5_000_000;

/** Max number of top-level entries in the `blocks` array. Bounds "wide but
 * shallow" pathological input the same way MAX_NESTING_DEPTH bounds "deep"
 * input — 20,000 nodes is already an order of magnitude past any real
 * procedure. */
export const MAX_TOP_LEVEL_BLOCKS = 20_000;
