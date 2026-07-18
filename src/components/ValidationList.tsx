import type { ValidationMessage } from '../lib/validate';

const SEVERITY_LABEL: Record<ValidationMessage['severity'], string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
};

export function ValidationList({ messages }: { messages: ValidationMessage[] }): JSX.Element {
  if (messages.length === 0) {
    return <div className="validation-empty">検証メッセージはありません。</div>;
  }
  return (
    <ul className="validation-list">
      {messages.map((m, i) => (
        <li key={i} className={`validation-item severity-${m.severity}`}>
          <span className="validation-badge">{SEVERITY_LABEL[m.severity]}</span>
          <span className="validation-code">{m.code}</span>
          {m.nodeId && <span className="validation-node">[{m.nodeId}]</span>}
          <span className="validation-message">{m.message}</span>
        </li>
      ))}
    </ul>
  );
}
