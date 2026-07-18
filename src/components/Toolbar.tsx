import { useState } from 'react';

export interface ToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
  onZoomReset: () => void;
  onExportPng: (scale: number) => void;
  onExportSvg: () => void;
  disabled: boolean;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const [scale, setScale] = useState(1);
  const { disabled } = props;
  return (
    <div className="toolbar">
      <button type="button" onClick={props.onZoomIn} disabled={disabled} title="ズームイン">
        ＋
      </button>
      <button type="button" onClick={props.onZoomOut} disabled={disabled} title="ズームアウト">
        －
      </button>
      <button type="button" onClick={props.onZoomToFit} disabled={disabled} title="全体表示">
        全体表示
      </button>
      <button type="button" onClick={props.onZoomReset} disabled={disabled} title="原寸100%">
        100%
      </button>
      <span className="toolbar-sep" />
      <select
        value={scale}
        onChange={(e) => setScale(Number(e.target.value))}
        disabled={disabled}
        aria-label="PNG保存倍率"
      >
        <option value={1}>1x</option>
        <option value={2}>2x</option>
        <option value={3}>3x</option>
        <option value={4}>4x</option>
      </select>
      <button type="button" onClick={() => props.onExportPng(scale)} disabled={disabled}>
        PNG保存
      </button>
      <button type="button" onClick={props.onExportSvg} disabled={disabled}>
        SVG保存
      </button>
    </div>
  );
}
