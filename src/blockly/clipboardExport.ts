/**
 * "Copy image to clipboard" for the simplified UI. This is new UI-support
 * code, NOT a change to export.ts's SVG/PNG generation logic (off-limits for
 * this task) — it only *calls* export.ts's existing, unmodified
 * `buildSvgExport` and `exportPng` exports. export.ts has no function that
 * hands back a PNG Blob (its exports only ever trigger a file download), so
 * the small canvas-rasterization step below is necessarily duplicated here
 * rather than refactoring export.ts.
 */
import * as Blockly from 'blockly/core';
import { buildSvgExport, exportPng } from './export';

const CLIPBOARD_SCALE = 2;

async function rasterizeToPngBlob(svgString: string, width: number, height: number, scale: number): Promise<Blob> {
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVGの画像化に失敗しました。'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D コンテキストを取得できませんでした。');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('PNGへの変換に失敗しました。'));
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function clipboardWriteSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.ClipboardItem === 'function'
  );
}

export type CopyImageOutcome = 'copied' | 'downloaded';

/**
 * Copies the workspace's rendering as a fixed-2x PNG to the clipboard so it
 * can be pasted straight into ChatGPT etc. Falls back to downloading the PNG
 * (via export.ts's unmodified `exportPng`) when the Clipboard API is
 * unavailable, unsupported, or the write is rejected (e.g. no permission).
 */
export async function copyWorkspaceImage(
  workspace: Blockly.WorkspaceSvg,
  procedureName: string,
): Promise<CopyImageOutcome> {
  if (clipboardWriteSupported()) {
    try {
      const { svgString, width, height } = await buildSvgExport(workspace);
      const blob = await rasterizeToPngBlob(svgString, width, height, CLIPBOARD_SCALE);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    } catch {
      // Fall through to the download fallback below.
    }
  }

  await exportPng(workspace, procedureName, CLIPBOARD_SCALE);
  return 'downloaded';
}
