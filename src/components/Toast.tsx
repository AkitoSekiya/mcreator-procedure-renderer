export interface ToastProps {
  message: string | null;
}

export function Toast({ message }: ToastProps): JSX.Element | null {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
