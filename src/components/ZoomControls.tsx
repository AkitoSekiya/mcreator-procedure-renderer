export interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
  disabled: boolean;
}

export function ZoomControls(props: ZoomControlsProps): JSX.Element {
  const { disabled } = props;
  return (
    <div className="zoom-controls">
      <button type="button" className="icon-btn" onClick={props.onZoomIn} disabled={disabled} title="ズームイン" aria-label="ズームイン">
        +
      </button>
      <button type="button" className="icon-btn" onClick={props.onZoomOut} disabled={disabled} title="ズームアウト" aria-label="ズームアウト">
        −
      </button>
      <button
        type="button"
        className="icon-btn icon-btn-wide"
        onClick={props.onZoomToFit}
        disabled={disabled}
        title="全体表示"
        aria-label="全体表示"
      >
        ⤢
      </button>
    </div>
  );
}
