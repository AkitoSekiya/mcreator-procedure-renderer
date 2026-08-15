export function Header(): JSX.Element {
  return (
    <header className="app-header">
      <div className="app-title">MCreator Procedure Renderer</div>
      <div className="app-version" title={`commit ${__APP_COMMIT__}`}>
        v{__APP_VERSION__} ({__APP_COMMIT__})
      </div>
    </header>
  );
}
