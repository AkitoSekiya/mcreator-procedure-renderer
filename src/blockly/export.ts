/**
 * SVG/PNG export of a Blockly workspace (SPEC.md §5.5). Produces a
 * standalone SVG string (embedded styles, inlined images as data URIs) and
 * rasterizes it to PNG at a chosen scale via an offscreen canvas.
 */
import * as Blockly from 'blockly/core';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const PADDING = 16;

const dataUriCache = new Map<string, Promise<string>>();

function toDataUri(url: string): Promise<string> {
  let cached = dataUriCache.get(url);
  if (!cached) {
    cached = fetch(url)
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error(`画像の読み込みに失敗しました: ${url}`));
            reader.readAsDataURL(blob);
          }),
      );
    dataUriCache.set(url, cached);
  }
  return cached;
}

async function inlineImages(root: SVGElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('image'));
  await Promise.all(
    images.map(async (img) => {
      const href = img.getAttribute('href') || img.getAttributeNS(XLINK_NS, 'href') || img.getAttribute('xlink:href');
      if (!href || href.startsWith('data:')) return;
      const dataUri = await toDataUri(href);
      img.setAttribute('href', dataUri);
      img.setAttributeNS(XLINK_NS, 'xlink:href', dataUri);
    }),
  );
}

function collectBlocklyStyles(): string {
  const styleEls = Array.from(document.querySelectorAll('style[id^="blockly"]'));
  return styleEls.map((el) => el.textContent ?? '').join('\n');
}

export interface SvgExportResult {
  svgString: string;
  width: number;
  height: number;
}

/** Builds a standalone SVG document string for the current workspace
 * contents (SPEC.md §5.5). */
export async function buildSvgExport(workspace: Blockly.WorkspaceSvg): Promise<SvgExportResult> {
  const canvas = workspace.getCanvas();
  const clone = canvas.cloneNode(true) as SVGGElement;
  clone.removeAttribute('transform');

  const bbox = workspace.getBlocksBoundingBox();
  const x = bbox.left - PADDING;
  const y = bbox.top - PADDING;
  const width = Math.max(1, bbox.right - bbox.left + PADDING * 2);
  const height = Math.max(1, bbox.bottom - bbox.top + PADDING * 2);

  await inlineImages(clone);

  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('xmlns', SVG_NS);
  root.setAttribute('xmlns:xlink', XLINK_NS);
  root.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  // Blockly's renderer/theme classes (e.g. "geras-renderer classic-theme")
  // live on the injectionDiv wrapping the <svg>, not on the canvas itself.
  // The injected stylesheet's selectors (e.g.
  // ".geras-renderer.classic-theme .blocklyNonEditableText>rect") require an
  // ancestor with those classes, so without this, field text/rect colours
  // silently fall back to SVG defaults (opaque black rects hiding the text).
  const injectionDivClass = workspace.getInjectionDiv().getAttribute('class');
  if (injectionDivClass) root.setAttribute('class', injectionDivClass);

  const styleEl = document.createElementNS(SVG_NS, 'style');
  styleEl.textContent = collectBlocklyStyles();
  root.appendChild(styleEl);

  const parentSvg = workspace.getParentSvg();
  for (const defsEl of Array.from(parentSvg.querySelectorAll('defs'))) {
    root.appendChild(defsEl.cloneNode(true));
  }

  root.appendChild(clone);

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(root);
  return { svgString, width, height };
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function baseFileName(procedureName: string): string {
  return procedureName && procedureName.trim().length > 0 ? procedureName.trim() : 'procedure';
}

/** Exports the workspace as an SVG file download. */
export async function exportSvg(workspace: Blockly.WorkspaceSvg, procedureName: string): Promise<void> {
  const { svgString } = await buildSvgExport(workspace);
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  download(blob, `${baseFileName(procedureName)}.svg`);
}

/** Exports the workspace as a PNG file download at the given integer scale
 * (1x-4x), with a solid white background (SPEC.md §5.5). */
export async function exportPng(workspace: Blockly.WorkspaceSvg, procedureName: string, scale: number): Promise<void> {
  const { svgString, width, height } = await buildSvgExport(workspace);
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

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('PNGへの変換に失敗しました。'));
      }, 'image/png');
    });

    const suffix = scale === 1 ? '.png' : `@${scale}x.png`;
    download(pngBlob, `${baseFileName(procedureName)}${suffix}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
