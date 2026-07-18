// Runs the app's own validate.ts against all public/samples/*.json and
// asserts each sample validates with zero errors (SPEC.md §7/§9-3).
// Run with: npm run check-samples  (uses tsx to execute TS directly)
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProcedureText } from '../src/lib/validate.ts';
import { buildDropdownOptionsMap } from '../src/lib/dropdownOptions.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const full = JSON.parse(readFileSync(path.join(root, 'public/reference/blocks_full.json'), 'utf-8'));
const render = JSON.parse(readFileSync(path.join(root, 'public/reference/blocks_render.json'), 'utf-8'));
const dropdownOptions = buildDropdownOptionsMap(render);

const samplesDir = path.join(root, 'public/samples');
const files = readdirSync(samplesDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error('No sample files found in public/samples/.');
  process.exit(1);
}

let hasFailure = false;
for (const file of files) {
  const text = readFileSync(path.join(samplesDir, file), 'utf-8');
  const result = validateProcedureText(text, full, dropdownOptions);
  const errorCount = result.messages.filter((m) => m.severity === 'error').length;
  const warnCount = result.messages.filter((m) => m.severity === 'warn').length;
  const infoCount = result.messages.filter((m) => m.severity === 'info').length;
  console.log(`${file}: error=${errorCount} warn=${warnCount} info=${infoCount}`);
  for (const m of result.messages) {
    console.log(`  [${m.severity}] ${m.code} ${m.message}`);
  }
  if (errorCount > 0) hasFailure = true;
}

if (hasFailure) {
  console.error('\nFAILED: one or more samples have errors.');
  process.exit(1);
} else {
  console.log('\nOK: all samples passed with 0 errors.');
}
