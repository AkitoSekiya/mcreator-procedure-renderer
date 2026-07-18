import { useEffect, useRef, useState } from 'react';

export interface CopyButtonProps {
  idleLabel: string;
  successLabel: string;
  className?: string;
  disabled?: boolean;
  /** Performs the copy action. Return true to flash the success label for a
   * couple seconds; return false when falling back to some other behaviour
   * (e.g. a download) — the caller is expected to surface that via a toast
   * instead of this button's own success state. */
  onCopy: () => Promise<boolean>;
}

/** A button that briefly shows a "✓ copied" state after a successful copy
 * action, shared by the "画像をコピー" and "エラーをコピー" buttons. */
export function CopyButton(props: CopyButtonProps): JSX.Element {
  const [showSuccess, setShowSuccess] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleClick = async (): Promise<void> => {
    const success = await props.onCopy();
    if (success) {
      setShowSuccess(true);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setShowSuccess(false), 2000);
    }
  };

  return (
    <button type="button" className={props.className} onClick={handleClick} disabled={props.disabled}>
      {showSuccess ? props.successLabel : props.idleLabel}
    </button>
  );
}
