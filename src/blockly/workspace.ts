/**
 * Thin wrapper around the Blockly workspace lifecycle (SPEC.md §5.4).
 */
import * as Blockly from 'blockly/core';

export function injectWorkspace(container: HTMLElement): Blockly.WorkspaceSvg {
  return Blockly.inject(container, {
    readOnly: true,
    renderer: 'geras',
    zoom: { controls: false, wheel: true, startScale: 0.9 },
    move: { scrollbars: true, drag: true, wheel: true },
  });
}

/** Loads a procedure's workspace XML (string) into the given workspace,
 * replacing whatever was there before. Returns the resulting block count so
 * callers can cross-check it against the expected count (SPEC.md §5.3). */
export function loadProcedure(workspace: Blockly.WorkspaceSvg, xmlString: string): { blockCount: number } {
  workspace.clear();
  const dom = Blockly.utils.xml.textToDom(xmlString);
  Blockly.Xml.domToWorkspace(dom, workspace);
  return { blockCount: workspace.getAllBlocks(false).length };
}

export function zoomIn(workspace: Blockly.WorkspaceSvg): void {
  workspace.zoomCenter(1);
}

export function zoomOut(workspace: Blockly.WorkspaceSvg): void {
  workspace.zoomCenter(-1);
}

export function zoomToFit(workspace: Blockly.WorkspaceSvg): void {
  workspace.zoomToFit();
}

export function zoomReset(workspace: Blockly.WorkspaceSvg): void {
  workspace.setScale(1);
  workspace.scrollCenter();
}

export function clearWorkspace(workspace: Blockly.WorkspaceSvg): void {
  workspace.clear();
}
