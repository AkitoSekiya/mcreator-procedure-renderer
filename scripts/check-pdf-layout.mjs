// Tests for the pure PDF page-layout math (src/lib/pdfLayout.ts), added for
// the "PDFで保存" feature. Covers: near-square single page, wide landscape
// single page, tall portrait multi-page splitting (continuity/overlap/last
// page reaching the image end), and huge images in both dimensions never
// overflowing the printable area.
// Run with: npm run check-pdf-layout
import {
  computePdfLayout,
  PAGE_WIDTH_MM,
  PAGE_HEIGHT_MM,
  MARGIN_MM,
  OVERLAP_MM,
} from '../src/lib/pdfLayout.ts';

let failures = 0;
function fail(message) {
  failures += 1;
  console.log(`  FAIL: ${message}`);
}
function ok(name, condition, detail) {
  console.log(`${name}: ${condition ? 'OK' : 'FAIL'}${detail ? ` (${detail})` : ''}`);
  if (!condition) fail(name);
}

function printableFor(orientation) {
  return orientation === 'portrait'
    ? { width: PAGE_WIDTH_MM - MARGIN_MM * 2, height: PAGE_HEIGHT_MM - MARGIN_MM * 2 }
    : { width: PAGE_HEIGHT_MM - MARGIN_MM * 2, height: PAGE_WIDTH_MM - MARGIN_MM * 2 };
}

// Asserts every page of a layout actually fits inside the printable area for
// its orientation (the hard "never overflow" requirement), for a given
// source pixel size.
function assertNeverOverflows(name, layout, px) {
  const area = printableFor(layout.orientation);
  const EPS = 1e-6;
  ok(`${name}: image width fits within printable width`, layout.imageWidthMm <= area.width + EPS, `${layout.imageWidthMm} <= ${area.width}`);
  ok(`${name}: offsetXMm is non-negative`, layout.offsetXMm >= -EPS, String(layout.offsetXMm));
  ok(
    `${name}: offsetXMm + imageWidthMm fits within printable width`,
    layout.offsetXMm + layout.imageWidthMm <= area.width + EPS,
    `${layout.offsetXMm} + ${layout.imageWidthMm} vs ${area.width}`,
  );
  for (const [i, page] of layout.pages.entries()) {
    const heightMm = page.srcH * layout.scaleMmPerPx;
    ok(`${name}: page ${i} height fits within printable height`, heightMm <= area.height + EPS, `${heightMm} <= ${area.height} (srcH=${page.srcH})`);
    ok(`${name}: page ${i} srcH is positive`, page.srcH > 0, String(page.srcH));
    ok(`${name}: page ${i} srcY is within [0, height)`, page.srcY >= -EPS && page.srcY < px.height, String(page.srcY));
  }
}

// --- 1. near-square image -> single page, sensible orientation ---
{
  const px = { width: 1000, height: 1050 };
  const layout = computePdfLayout(px);
  ok('near-square: single page', layout.pages.length === 1, JSON.stringify(layout.pages));
  ok('near-square: orientation is portrait or landscape', layout.orientation === 'portrait' || layout.orientation === 'landscape', layout.orientation);
  assertNeverOverflows('near-square', layout, px);
}

// --- 2. wide landscape image -> landscape orientation, single page ---
{
  const px = { width: 2000, height: 800 };
  const layout = computePdfLayout(px);
  ok('landscape-2000x800: orientation is landscape', layout.orientation === 'landscape', layout.orientation);
  ok('landscape-2000x800: single page', layout.pages.length === 1, JSON.stringify(layout.pages));
  ok('landscape-2000x800: page covers full image height', layout.pages[0].srcY === 0 && layout.pages[0].srcH === px.height, JSON.stringify(layout.pages));
  assertNeverOverflows('landscape-2000x800', layout, px);
}

// --- 3. tall portrait image -> portrait orientation, multiple pages,
// contiguous with ~OVERLAP_MM overlap, last page ends at the image end ---
{
  const px = { width: 800, height: 4000 };
  const layout = computePdfLayout(px);
  ok('portrait-tall: orientation is portrait', layout.orientation === 'portrait', layout.orientation);
  ok('portrait-tall: more than one page', layout.pages.length > 1, String(layout.pages.length));
  assertNeverOverflows('portrait-tall', layout, px);

  const pages = layout.pages;
  const firstPage = pages[0];
  ok('portrait-tall: first page starts at image top', firstPage.srcY === 0, String(firstPage.srcY));

  const lastPage = pages[pages.length - 1];
  ok(
    'portrait-tall: last page ends exactly at the image end',
    Math.abs(lastPage.srcY + lastPage.srcH - px.height) < 1e-6,
    `${lastPage.srcY} + ${lastPage.srcH} vs ${px.height}`,
  );

  const overlapPxTarget = OVERLAP_MM / layout.scaleMmPerPx;
  for (let i = 0; i < pages.length - 1; i += 1) {
    const cur = pages[i];
    const next = pages[i + 1];
    const curEnd = cur.srcY + cur.srcH;
    ok(`portrait-tall: page ${i}->${i + 1} is contiguous (no gap)`, next.srcY <= curEnd + 1e-6, `next.srcY=${next.srcY} curEnd=${curEnd}`);
    ok(`portrait-tall: page ${i}->${i + 1} starts after the previous page's start (monotonic order)`, next.srcY > cur.srcY, `${next.srcY} vs ${cur.srcY}`);
    const overlap = curEnd - next.srcY;
    ok(
      `portrait-tall: page ${i}->${i + 1} overlap is ~${OVERLAP_MM}mm (${overlapPxTarget.toFixed(2)}px)`,
      Math.abs(overlap - overlapPxTarget) < 1,
      `overlap=${overlap}`,
    );
  }
}

// --- 4. huge width AND height -> never overflows, still a sane layout ---
{
  const px = { width: 20000, height: 30000 };
  const layout = computePdfLayout(px);
  assertNeverOverflows('huge-both', layout, px);
  ok('huge-both: at least one page', layout.pages.length >= 1, String(layout.pages.length));
}

// --- 5. huge, extremely wide + moderately tall -> landscape, still fits ---
{
  const px = { width: 50000, height: 3000 };
  const layout = computePdfLayout(px);
  ok('huge-wide: orientation is landscape', layout.orientation === 'landscape', layout.orientation);
  assertNeverOverflows('huge-wide', layout, px);
}

// --- 6. huge, extremely tall + moderately wide -> portrait, multi-page, fits ---
{
  const px = { width: 1500, height: 100000 };
  const layout = computePdfLayout(px);
  ok('huge-tall: orientation is portrait', layout.orientation === 'portrait', layout.orientation);
  ok('huge-tall: multiple pages', layout.pages.length > 1, String(layout.pages.length));
  assertNeverOverflows('huge-tall', layout, px);
  const lastPage = layout.pages[layout.pages.length - 1];
  ok(
    'huge-tall: last page ends exactly at the image end',
    Math.abs(lastPage.srcY + lastPage.srcH - px.height) < 1e-6,
    `${lastPage.srcY} + ${lastPage.srcH} vs ${px.height}`,
  );
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} pdf-layout test(s) did not produce the expected result.`);
  process.exit(1);
} else {
  console.log('\nOK: all pdf-layout tests produced their expected result.');
}
