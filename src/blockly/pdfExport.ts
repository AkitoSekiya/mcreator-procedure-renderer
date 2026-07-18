/**
 * "PDFで保存" (save as PDF) export. New UI-support code, NOT a change to
 * export.ts's SVG/PNG generation logic (off-limits for this task) — it only
 * *calls* export.ts's existing, unmodified `buildSvgExport` to get the SVG
 * string + px size, then rasterizes it itself (export.ts has no function
 * that hands back a raw canvas/ImageData, only ever a file download) and
 * lays it out across one or more A4 pages via the pure functions in
 * src/lib/pdfLayout.ts (also unmodified — this is the module that was added
 * for this feature, not an existing one).
 */
import jsPDF from 'jspdf';
import * as Blockly from 'blockly/core';
import { buildSvgExport } from './export';
import { computePdfLayout, MARGIN_MM, PAGE_WIDTH_MM, PAGE_HEIGHT_MM } from '../lib/pdfLayout';

const TARGET_DPI = 200;
const MIN_RASTER_SCALE = 2;
const MAX_RASTER_SCALE = 4;
const MM_PER_INCH = 25.4;

function baseFileName(procedureName: string): string {
  return procedureName && procedureName.trim().length > 0 ? procedureName.trim() : 'procedure';
}

async function loadImage(svgString: string): Promise<HTMLImageElement> {
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVGの画像化に失敗しました。'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sliceToDataUrl(fullCanvas: HTMLCanvasElement, srcY: number, srcH: number, rasterScale: number): string {
  const sliceCanvas = document.createElement('canvas');
  sliceCanvas.width = fullCanvas.width;
  sliceCanvas.height = Math.max(1, Math.round(srcH * rasterScale));
  const ctx = sliceCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D コンテキストを取得できませんでした。');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
  ctx.drawImage(
    fullCanvas,
    0,
    Math.round(srcY * rasterScale),
    fullCanvas.width,
    sliceCanvas.height,
    0,
    0,
    sliceCanvas.width,
    sliceCanvas.height,
  );
  return sliceCanvas.toDataURL('image/png');
}

/**
 * Exports the workspace as an A4 PDF, sized as large as possible without
 * overflowing the page, splitting into multiple overlapping pages only when
 * the procedure image is too tall for a single page (SPEC.md-style layout,
 * computed by src/lib/pdfLayout.ts).
 */
export async function exportPdf(workspace: Blockly.WorkspaceSvg, procedureName: string): Promise<void> {
  const { svgString, width, height } = await buildSvgExport(workspace);
  const layout = computePdfLayout({ width, height });

  const printAreaWidthMm = layout.orientation === 'portrait' ? PAGE_WIDTH_MM - MARGIN_MM * 2 : PAGE_HEIGHT_MM - MARGIN_MM * 2;
  const rasterScale = Math.min(
    MAX_RASTER_SCALE,
    Math.max(MIN_RASTER_SCALE, Math.ceil(((printAreaWidthMm / MM_PER_INCH) * TARGET_DPI) / width)),
  );

  const img = await loadImage(svgString);

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = Math.max(1, Math.round(width * rasterScale));
  fullCanvas.height = Math.max(1, Math.round(height * rasterScale));
  const ctx = fullCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D コンテキストを取得できませんでした。');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, fullCanvas.width, fullCanvas.height);
  ctx.drawImage(img, 0, 0, fullCanvas.width, fullCanvas.height);

  const doc = new jsPDF({ orientation: layout.orientation, unit: 'mm', format: 'a4' });
  const totalPages = layout.pages.length;

  layout.pages.forEach((page, index) => {
    if (index > 0) doc.addPage('a4', layout.orientation);
    const dataUrl = sliceToDataUrl(fullCanvas, page.srcY, page.srcH, rasterScale);
    const x = MARGIN_MM + layout.offsetXMm;
    const y = MARGIN_MM;
    const drawWidthMm = layout.imageWidthMm;
    const drawHeightMm = page.srcH * layout.scaleMmPerPx;
    doc.addImage(dataUrl, 'PNG', x, y, drawWidthMm, drawHeightMm);

    if (totalPages > 1) {
      const pageWidthMm = layout.orientation === 'portrait' ? PAGE_WIDTH_MM : PAGE_HEIGHT_MM;
      const pageHeightMm = layout.orientation === 'portrait' ? PAGE_HEIGHT_MM : PAGE_WIDTH_MM;
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`${index + 1} / ${totalPages}`, pageWidthMm - MARGIN_MM, pageHeightMm - 3, { align: 'right' });
    }
  });

  doc.save(`${baseFileName(procedureName)}.pdf`);
}
