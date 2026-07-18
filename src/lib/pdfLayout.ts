/**
 * Pure layout math for "PDFで保存" (PDF export). Given the pixel size of the
 * rendered procedure image, decides the A4 page orientation, the display
 * scale (mm per source px), and — when the image is too tall to fit a single
 * page at the width-filling scale — how to slice it into multiple
 * vertically-overlapping pages. No DOM/canvas/jsPDF dependency, so this can
 * be unit-tested directly under Node (scripts/check-pdf-layout.mjs).
 *
 * Deliberately NOT touching src/lib/validate.ts / normalizeInput.ts (off
 * limits for this task) and not depending on Blockly — this module only
 * consumes a plain {width, height} pixel size.
 */

/** A4 in mm. */
export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;
/** Printable-area margin on every edge, in mm. */
export const MARGIN_MM = 10;
/** Overlap between adjacent sliced pages, in mm (so nothing is lost at the
 * cut and a reader can visually confirm continuity across pages). */
export const OVERLAP_MM = 8;

export type PdfOrientation = 'portrait' | 'landscape';

/** Printable area (page minus margins) for each orientation, in mm. */
const PRINTABLE: Record<PdfOrientation, { width: number; height: number }> = {
  portrait: { width: PAGE_WIDTH_MM - MARGIN_MM * 2, height: PAGE_HEIGHT_MM - MARGIN_MM * 2 },
  landscape: { width: PAGE_HEIGHT_MM - MARGIN_MM * 2, height: PAGE_WIDTH_MM - MARGIN_MM * 2 },
};

export interface PdfPageSlice {
  /** Source-pixel Y offset (top) of this page's slice within the full image. */
  srcY: number;
  /** Source-pixel height of this page's slice. */
  srcH: number;
}

export interface PdfLayout {
  orientation: PdfOrientation;
  /** Display scale, in mm per source px. Uniform across width & height (no
   * distortion) and identical for every page. */
  scaleMmPerPx: number;
  /** One entry per output PDF page, top-to-bottom, covering the full image
   * height with OVERLAP_MM-ish overlap between neighbours. Always at least
   * one entry. */
  pages: PdfPageSlice[];
  /** Displayed image width in mm (== source width * scaleMmPerPx). */
  imageWidthMm: number;
  /** Horizontal offset (in mm, added on top of MARGIN_MM) to center the
   * image within the printable area. Always >= 0. */
  offsetXMm: number;
}

/** Computes the "fits everything on one page" scale (mm per px) for a given
 * orientation's printable area. */
function wholeFitScale(orientation: PdfOrientation, width: number, height: number): number {
  const area = PRINTABLE[orientation];
  return Math.min(area.width / width, area.height / height);
}

/** Computes the "fills the printable width exactly" scale (mm per px). */
function widthFitScale(orientation: PdfOrientation, width: number): number {
  return PRINTABLE[orientation].width / width;
}

/**
 * Computes the PDF layout for an image of the given pixel size. See the
 * module doc comment for the algorithm; mirrors the spec in the task prompt:
 *
 * 1. Compute the whole-image single-page fit scale for both orientations;
 *    pick whichever orientation lets the image display larger.
 * 2. For that orientation, if the width-filling scale is larger than the
 *    whole-fit scale (i.e. height is the binding constraint — the image is
 *    "too tall" relative to the page), switch to the width-filling scale and
 *    slice the image vertically across multiple pages with OVERLAP_MM
 *    overlap between neighbours. Otherwise a single page at the whole-fit
 *    scale is enough.
 *
 * Always produces a layout that fits within the printable area — for both
 * extremely wide and extremely tall/huge images.
 */
export function computePdfLayout(px: { width: number; height: number }): PdfLayout {
  const width = Math.max(1, px.width);
  const height = Math.max(1, px.height);

  const portraitFit = wholeFitScale('portrait', width, height);
  const landscapeFit = wholeFitScale('landscape', width, height);
  const orientation: PdfOrientation = landscapeFit > portraitFit ? 'landscape' : 'portrait';
  const fitScale = orientation === 'landscape' ? landscapeFit : portraitFit;
  const widthScale = widthFitScale(orientation, width);

  const area = PRINTABLE[orientation];

  let scaleMmPerPx: number;
  let pages: PdfPageSlice[];

  if (widthScale > fitScale) {
    // Height is the binding constraint at width-fill scale: the image would
    // overflow vertically. Fill the width exactly and slice vertically.
    scaleMmPerPx = widthScale;
    const sliceHeightPx = area.height / scaleMmPerPx;
    const overlapPx = OVERLAP_MM / scaleMmPerPx;

    if (height <= sliceHeightPx) {
      // Shouldn't normally hit this branch (fitScale would have been >=
      // widthScale otherwise), but guard for float edge cases.
      pages = [{ srcY: 0, srcH: height }];
    } else {
      // step < sliceHeightPx (since OVERLAP_MM < the printable height), so
      // each next page starts OVERLAP_MM-equivalent px before the previous
      // one ends. The final page is a *shorter* trailing slice (not another
      // full-height slice pinned backward) so it ends exactly at the image
      // end while keeping every overlap ~OVERLAP_MM, in order.
      const step = sliceHeightPx - overlapPx;
      const slices: PdfPageSlice[] = [];
      let srcY = 0;
      while (height - srcY > sliceHeightPx) {
        slices.push({ srcY, srcH: sliceHeightPx });
        srcY += step;
      }
      slices.push({ srcY, srcH: height - srcY });
      pages = slices;
    }
  } else {
    scaleMmPerPx = fitScale;
    pages = [{ srcY: 0, srcH: height }];
  }

  const imageWidthMm = width * scaleMmPerPx;
  const offsetXMm = Math.max(0, (area.width - imageWidthMm) / 2);

  return { orientation, scaleMmPerPx, pages, imageWidthMm, offsetXMm };
}
