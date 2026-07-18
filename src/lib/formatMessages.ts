import type { ValidationMessage } from './validate';

/** Formats validation messages as plain text suitable for pasting into
 * ChatGPT etc., one line per message: "[E003] node n5 (block_id: xxx): ...". */
export function formatMessagesAsText(messages: ValidationMessage[]): string {
  return messages
    .map((m) => {
      let prefix = `[${m.code}]`;
      if (m.nodeId && m.blockId) {
        prefix += ` node ${m.nodeId} (block_id: ${m.blockId})`;
      } else if (m.nodeId) {
        prefix += ` node ${m.nodeId}`;
      } else if (m.blockId) {
        prefix += ` (block_id: ${m.blockId})`;
      }
      return `${prefix}: ${m.message}`;
    })
    .join('\n');
}
