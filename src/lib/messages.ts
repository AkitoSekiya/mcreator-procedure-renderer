/** Shared message types used by both normalizeInput.ts and validate.ts,
 * split out to avoid a circular import between the two (normalizeInput
 * produces messages; validate consumes normalizeInput's output and produces
 * more of the same). */

export type Severity = 'error' | 'warn' | 'info';

export interface ValidationMessage {
  code: string;
  severity: Severity;
  message: string;
  nodeId?: string;
  blockId?: string;
}
