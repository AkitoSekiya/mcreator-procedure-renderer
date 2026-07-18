/**
 * Converts a validated+normalized procedure (see src/lib/validate.ts) into
 * Blockly workspace XML (SPEC.md §5.3). Pure string building — no Blockly
 * import needed here, which keeps it testable from plain Node.
 */
import type { NormalizedNode, NormalizedProcedure } from '../lib/normalizedTypes';

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Builds the `<mutation .../>` element (self-closing) for the three special
 * blocks called out in SPEC.md §5.3. Returns '' for every other block. */
function mutationXml(node: NormalizedNode): string {
  if (node.blockId === 'controls_if') {
    let elseifMax = 0;
    for (const key of Object.keys(node.valueInputs)) {
      const m = /^IF(\d+)$/.exec(key);
      if (m) elseifMax = Math.max(elseifMax, Number(m[1]));
    }
    const hasElse = Object.prototype.hasOwnProperty.call(node.statementInputs, 'ELSE');
    return `<mutation elseif="${elseifMax}" else="${hasElse ? 1 : 0}"></mutation>`;
  }
  if (node.blockId === 'text_join') {
    let count = 0;
    for (const key of Object.keys(node.valueInputs)) {
      if (/^ADD\d+$/.test(key)) count += 1;
    }
    return `<mutation items="${count}"></mutation>`;
  }
  if (node.blockId === 'call_procedure') {
    let count = 0;
    for (const key of Object.keys(node.valueInputs)) {
      if (/^arg\d+$/.test(key)) count += 1;
    }
    if (count === 0) return '';
    return `<mutation inputs="${count}"></mutation>`;
  }
  return '';
}

function fieldsXml(node: NormalizedNode): string {
  let xml = '';
  for (const [name, value] of Object.entries(node.fields)) {
    xml += `<field name="${escapeAttr(name)}">${escapeText(value)}</field>`;
  }
  return xml;
}

function valuesXml(node: NormalizedNode): string {
  let xml = '';
  for (const [name, child] of Object.entries(node.valueInputs)) {
    xml += `<value name="${escapeAttr(name)}">${blockToXml(child, '')}</value>`;
  }
  return xml;
}

function statementsXml(node: NormalizedNode): string {
  let xml = '';
  for (const [name, children] of Object.entries(node.statementInputs)) {
    xml += `<statement name="${escapeAttr(name)}">${sequenceToXml(children)}</statement>`;
  }
  return xml;
}

/** Renders a single block (with its fields/values/statements) plus a
 * pre-built `<next>...</next>` fragment (or '' if none). */
function blockToXml(node: NormalizedNode, nextXml: string): string {
  return (
    `<block type="${escapeAttr(node.blockId)}">` +
    mutationXml(node) +
    fieldsXml(node) +
    valuesXml(node) +
    statementsXml(node) +
    nextXml +
    `</block>`
  );
}

/** Renders an ordered sequence of statement blocks as a `<next>`-chained tree,
 * starting from `nodes[startIdx]`. Returns '' if the sequence is empty. */
function sequenceToXml(nodes: NormalizedNode[], startIdx = 0): string {
  if (startIdx >= nodes.length) return '';
  const node = nodes[startIdx];
  const restXml = sequenceToXml(nodes, startIdx + 1);
  const nextXml = restXml ? `<next>${restXml}</next>` : '';
  return blockToXml(node, nextXml);
}

/** Vertical spacing (workspace px) between independent top-level stacks, so
 * SPEC.md v1.2's extra/disconnected stacks don't land exactly on top of the
 * main stack — Blockly places any top-level `<block>` lacking `x`/`y` at the
 * same default origin, which would otherwise make every stack but the last
 * invisible (fully overlapping). Only the *root* block of a stack gets a
 * position; nested/next-chained blocks are never positioned individually. */
const STACK_VERTICAL_GAP = 300;

/** Renders a top-level, unconnected stack with an explicit `x`/`y` on its
 * root block. `stackIndex` 0 is the main stack (kept at the origin so it
 * matches pre-multi-stack XML byte-for-byte); each extra stack is offset
 * further down. */
function rootStackToXml(nodes: NormalizedNode[], stackIndex: number): string {
  const xml = sequenceToXml(nodes);
  if (!xml || stackIndex === 0) return xml;
  const y = stackIndex * STACK_VERTICAL_GAP;
  // `xml` always starts with exactly `<block type="...">` (see blockToXml) —
  // safe to inject position attributes into that first opening tag only.
  return xml.replace(/^<block type="([^"]*)">/, `<block type="$1" x="0" y="${y}">`);
}

/** Builds the full workspace XML document (as a string) for a normalized
 * procedure, including the synthetic event_trigger hat block when present.
 *
 * SPEC.md v1.2 §5: `stacks[0]` is the main sequence, connected after the
 * trigger (or the sole root when there's no trigger). `stacks[1..]` are
 * independent, disconnected stacks (each produced a W004 warning during
 * normalization) — Blockly XML legally supports multiple top-level `<block>`
 * siblings under `<xml>`, so each extra stack is rendered as its own
 * unconnected top-level block group alongside the main one.
 */
export function procedureToXmlString(proc: NormalizedProcedure): string {
  const [mainStack, ...extraStacks] = proc.stacks;
  const mainXml = mainStack ? sequenceToXml(mainStack) : '';

  let mainRootXml: string;
  if (proc.trigger !== null) {
    const triggerField = `<field name="trigger">${escapeText(proc.trigger)}</field>`;
    const nextXml = mainXml ? `<next>${mainXml}</next>` : '';
    mainRootXml = `<block type="event_trigger">${triggerField}${nextXml}</block>`;
  } else {
    mainRootXml = mainXml;
  }

  // Extra stacks always get an explicit position (offset further down each
  // time) so they render as visibly separate block groups instead of piling
  // up on top of the main stack at Blockly's default origin.
  const extraXml = extraStacks.map((stack, i) => rootStackToXml(stack, i + 1)).join('');

  return `<xml xmlns="https://developers.google.com/blockly/xml">${mainRootXml}${extraXml}</xml>`;
}

/** Recursively counts how many blocks a normalized procedure should produce
 * once loaded into a Blockly workspace (including the event_trigger hat, if
 * any, and every independent stack). Used as a safety-net cross-check
 * against `workspace.getAllBlocks().length` after domToWorkspace (SPEC.md
 * §5.3). */
export function countExpectedBlocks(proc: NormalizedProcedure): number {
  let count = proc.trigger !== null ? 1 : 0;
  const countSequence = (nodes: NormalizedNode[]): void => {
    for (const node of nodes) {
      count += 1;
      for (const child of Object.values(node.valueInputs)) countNode(child);
      for (const children of Object.values(node.statementInputs)) countSequence(children);
    }
  };
  const countNode = (node: NormalizedNode): void => {
    count += 1;
    for (const child of Object.values(node.valueInputs)) countNode(child);
    for (const children of Object.values(node.statementInputs)) countSequence(children);
  };
  for (const stack of proc.stacks) countSequence(stack);
  return count;
}
