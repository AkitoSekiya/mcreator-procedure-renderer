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

/** Builds the full workspace XML document (as a string) for a normalized
 * procedure, including the synthetic event_trigger hat block when present. */
export function procedureToXmlString(proc: NormalizedProcedure): string {
  const mainXml = sequenceToXml(proc.sequence);
  let rootXml: string;
  if (proc.trigger !== null) {
    const triggerField = `<field name="trigger">${escapeText(proc.trigger)}</field>`;
    const nextXml = mainXml ? `<next>${mainXml}</next>` : '';
    rootXml = `<block type="event_trigger">${triggerField}${nextXml}</block>`;
  } else {
    rootXml = mainXml;
  }
  return `<xml xmlns="https://developers.google.com/blockly/xml">${rootXml}</xml>`;
}

/** Recursively counts how many blocks a normalized procedure should produce
 * once loaded into a Blockly workspace (including the event_trigger hat, if
 * any). Used as a safety-net cross-check against
 * `workspace.getAllBlocks().length` after domToWorkspace (SPEC.md §5.3). */
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
  countSequence(proc.sequence);
  return count;
}
