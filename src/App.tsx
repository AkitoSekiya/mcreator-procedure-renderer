import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { ReferenceDataProvider, useReferenceData } from './data/ReferenceDataContext';
import { validateProcedureText, type ValidationMessage } from './lib/validate';
import { procedureToXmlString, countExpectedBlocks } from './blockly/toXml';
import { injectWorkspace, loadProcedure, zoomIn, zoomOut, zoomToFit, zoomReset, clearWorkspace } from './blockly/workspace';
import { exportPng, exportSvg } from './blockly/export';
import { ValidationList } from './components/ValidationList';
import { Toolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { BlockSearchPanel } from './components/BlockSearchPanel';

const SAMPLES = [
  { file: 'sample1_hello.json', label: 'サンプル1: hello' },
  { file: 'sample2_if_else.json', label: 'サンプル2: if/else' },
  { file: 'sample3_repeat.json', label: 'サンプル3: repeat' },
];

function AppInner(): JSX.Element {
  const refState = useReferenceData();
  const [jsonText, setJsonText] = useState('');
  const [messages, setMessages] = useState<ValidationMessage[]>([]);
  const [procedureName, setProcedureName] = useState('procedure');
  const [searchOpen, setSearchOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (refState.status !== 'ready') return;
    if (!containerRef.current) return;
    if (workspaceRef.current) return;
    workspaceRef.current = injectWorkspace(containerRef.current);
    return () => {
      workspaceRef.current?.dispose();
      workspaceRef.current = null;
    };
  }, [refState.status]);

  const runValidation = useCallback(
    (text: string) => {
      if (refState.status !== 'ready') return null;
      return validateProcedureText(text, refState.data.full, refState.data.dropdownOptions);
    },
    [refState],
  );

  const handleValidateOnly = useCallback(() => {
    const result = runValidation(jsonText);
    if (!result) return;
    setMessages(result.messages);
  }, [jsonText, runValidation]);

  const handleGenerate = useCallback(() => {
    const result = runValidation(jsonText);
    if (!result) return;
    const ws = workspaceRef.current;
    if (!result.ok || !result.normalized) {
      setMessages(result.messages);
      if (ws) clearWorkspace(ws);
      return;
    }
    setProcedureName(result.normalized.procedureName);
    if (!ws) {
      setMessages(result.messages);
      return;
    }
    try {
      const xml = procedureToXmlString(result.normalized);
      const { blockCount } = loadProcedure(ws, xml);
      const expected = countExpectedBlocks(result.normalized);
      const finalMessages = [...result.messages];
      if (blockCount !== expected) {
        finalMessages.push({
          code: 'E999',
          severity: 'error',
          message: `Blocklyが接続を拒否した可能性があります。期待ブロック数 ${expected} に対し実際は ${blockCount} 個でした。`,
        });
      }
      setMessages(finalMessages);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setMessages([
        ...result.messages,
        {
          code: 'E999',
          severity: 'error',
          message: `描画中にエラーが発生しました: ${detail}`,
        },
      ]);
    }
  }, [jsonText, runValidation]);

  const handleClear = useCallback(() => {
    setJsonText('');
    setMessages([]);
    if (workspaceRef.current) clearWorkspace(workspaceRef.current);
  }, []);

  const handleFileButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setJsonText(String(reader.result ?? ''));
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleSampleSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const file = e.target.value;
    e.target.value = '';
    if (!file) return;
    const base = import.meta.env.BASE_URL;
    fetch(`${base}samples/${file}`)
      .then((r) => r.text())
      .then((text) => setJsonText(text))
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        setMessages([{ code: 'E999', severity: 'error', message: `サンプルの読み込みに失敗しました: ${detail}` }]);
      });
  }, []);

  const handleZoomIn = useCallback(() => workspaceRef.current && zoomIn(workspaceRef.current), []);
  const handleZoomOut = useCallback(() => workspaceRef.current && zoomOut(workspaceRef.current), []);
  const handleZoomToFit = useCallback(() => workspaceRef.current && zoomToFit(workspaceRef.current), []);
  const handleZoomReset = useCallback(() => workspaceRef.current && zoomReset(workspaceRef.current), []);

  const handleExportSvg = useCallback(() => {
    const ws = workspaceRef.current;
    if (!ws) return;
    setBusy(true);
    exportSvg(ws, procedureName)
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [...prev, { code: 'E999', severity: 'error', message: `SVG保存に失敗しました: ${detail}` }]);
      })
      .finally(() => setBusy(false));
  }, [procedureName]);

  const handleExportPng = useCallback(
    (scale: number) => {
      const ws = workspaceRef.current;
      if (!ws) return;
      setBusy(true);
      exportPng(ws, procedureName, scale)
        .catch((err: unknown) => {
          const detail = err instanceof Error ? err.message : String(err);
          setMessages((prev) => [...prev, { code: 'E999', severity: 'error', message: `PNG保存に失敗しました: ${detail}` }]);
        })
        .finally(() => setBusy(false));
    },
    [procedureName],
  );

  const counts = useMemo(() => {
    if (refState.status !== 'ready') return null;
    return {
      mcreatorVersion: refState.data.full.mcreator_version,
      fullBlockCount: Object.keys(refState.data.full.blocks).length,
      renderDefCount: refState.data.render.definitions.length,
    };
  }, [refState]);

  if (refState.status === 'error') {
    return (
      <div className="fatal-error">
        <h1>参照データを読み込めませんでした</h1>
        <p>reference/ が配信されていない可能性があります。</p>
        <pre>{refState.message}</pre>
      </div>
    );
  }

  const ready = refState.status === 'ready';

  return (
    <div className="app-root">
      {refState.status === 'loading' && <div className="loading-banner">参照データを読み込み中です…</div>}
      <div className="main-panes">
        <section className="left-pane">
          <h2>プロシージャJSON</h2>
          <div className="button-row">
            <button type="button" onClick={handleFileButtonClick}>
              ファイル読込
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden-file-input"
              onChange={handleFileChange}
            />
            <select defaultValue="" onChange={handleSampleSelect} aria-label="サンプル選択">
              <option value="" disabled>
                サンプル▼
              </option>
              {SAMPLES.map((s) => (
                <option key={s.file} value={s.file}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={handleClear}>
              クリア
            </button>
            <button type="button" onClick={handleValidateOnly} disabled={!ready}>
              検証のみ
            </button>
            <button type="button" onClick={handleGenerate} disabled={!ready}>
              生成
            </button>
          </div>
          <textarea
            className="json-textarea"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
            placeholder="ここにMCreatorプロシージャ構造化JSONを貼り付け"
          />
          <div className="validation-panel">
            <ValidationList messages={messages} />
          </div>
        </section>

        <section className="right-pane">
          <h2>プレビュー</h2>
          <Toolbar
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onZoomToFit={handleZoomToFit}
            onZoomReset={handleZoomReset}
            onExportPng={handleExportPng}
            onExportSvg={handleExportSvg}
            disabled={!ready || busy}
          />
          <div className="workspace-host" ref={containerRef} />
        </section>
      </div>

      {counts && (
        <StatusBar
          mcreatorVersion={counts.mcreatorVersion}
          fullBlockCount={counts.fullBlockCount}
          renderDefCount={counts.renderDefCount}
          searchOpen={searchOpen}
          onToggleSearch={() => setSearchOpen((v) => !v)}
        />
      )}

      {searchOpen && ready && (
        <div className="search-overlay">
          <BlockSearchPanel full={refState.data.full} />
        </div>
      )}
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <ReferenceDataProvider>
      <AppInner />
    </ReferenceDataProvider>
  );
}
