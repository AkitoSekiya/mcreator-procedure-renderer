export interface StatusBarProps {
  mcreatorVersion: string;
  fullBlockCount: number;
  renderDefCount: number;
}

export function StatusBar(props: StatusBarProps): JSX.Element {
  return (
    <footer className="app-footer">
      MCreator {props.mcreatorVersion} ・ 検証データ{props.fullBlockCount}ブロック ・ 描画定義{props.renderDefCount}
    </footer>
  );
}
