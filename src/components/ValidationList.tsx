import type { ValidationMessage } from '../lib/validate';
import { CopyButton } from './CopyButton';

const SEVERITY_ICON: Record<ValidationMessage['severity'], string> = {
  error: '✕',
  warn: '!',
  info: 'i',
};

const SEVERITY_LABEL: Record<ValidationMessage['severity'], string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
};

export interface ValidationListProps {
  messages: ValidationMessage[];
  onCopyErrors: () => Promise<boolean>;
}

export function ValidationList({ messages, onCopyErrors }: ValidationListProps): JSX.Element {
  if (messages.length === 0) {
    return <div className="validation-empty">検証メッセージはありません。</div>;
  }
  return (
    <div className="validation-section">
      <div className="validation-header">
        <span className="validation-count">{messages.length}件のメッセージ</span>
        <CopyButton
          className="btn btn-ghost btn-small"
          idleLabel="エラーをコピー"
          successLabel="✓ コピーしました"
          onCopy={onCopyErrors}
        />
      </div>
      <ul className="validation-list">
        {messages.map((m, i) => (
          <li key={i} className={`validation-card severity-${m.severity}`}>
            <span className="validation-icon" aria-hidden="true">
              {SEVERITY_ICON[m.severity]}
            </span>
            <div className="validation-body">
              <div className="validation-meta">
                <span className="validation-severity">{SEVERITY_LABEL[m.severity]}</span>
                <span className="validation-code">{m.code}</span>
                {m.nodeId && <span className="validation-node">node {m.nodeId}</span>}
                {m.blockId && <span className="validation-node">block_id: {m.blockId}</span>}
              </div>
              <div className="validation-message">{m.message}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
