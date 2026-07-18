export interface StatusBarProps {
  mcreatorVersion: string;
  fullBlockCount: number;
  renderDefCount: number;
  searchOpen: boolean;
  onToggleSearch: () => void;
}

export function StatusBar(props: StatusBarProps): JSX.Element {
  return (
    <div className="status-bar">
      <span>
        MCreator {props.mcreatorVersion} | 検証データ: {props.fullBlockCount}ブロック / 描画定義: {props.renderDefCount}
      </span>
      <button type="button" className="search-toggle" onClick={props.onToggleSearch}>
        {props.searchOpen ? 'ブロック検索を閉じる' : 'ブロック検索'}
      </button>
    </div>
  );
}
