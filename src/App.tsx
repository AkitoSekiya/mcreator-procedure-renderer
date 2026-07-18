import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { ReferenceDataProvider, useReferenceData } from './data/ReferenceDataContext';
import { validateProcedureText, type ValidationMessage } from './lib/validate';
import { formatMessagesAsText } from './lib/formatMessages';
import { procedureToXmlString, countExpectedBlocks } from './blockly/toXml';
import { injectWorkspace, loadProcedure, zoomIn, zoomOut, zoomToFit, clearWorkspace } from './blockly/workspace';
import { copyWorkspaceImage } from './blockly/clipboardExport';
import { Header } from './components/Header';
import { ValidationList } from './components/ValidationList';
import { ZoomControls } from './components/ZoomControls';
import { CopyButton } from './components/CopyButton';
import { StatusBar } from './components/StatusBar';
import { Toast } from './components/Toast';

const TOAST_DURATION_MS = 3000;

function AppInner(): JSX.Element {
  const refState = useReferenceData();
  const [jsonText, setJsonText] = useState('');
  const [messages, setMessages] = useState<ValidationMessage[]>([]);
  const [procedureName, setProcedureName] = useState('procedure');
  const [toast, setToast] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);

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

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleGenerate = useCallback(() => {
    if (refState.status !== 'ready') return;
    const result = validateProcedureText(jsonText, refState.data.full, refState.data.dropdownOptions);
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
  }, [jsonText, refState]);

  const handleZoomIn = useCallback(() => workspaceRef.current && zoomIn(workspaceRef.current), []);
  const handleZoomOut = useCallback(() => workspaceRef.current && zoomOut(workspaceRef.current), []);
  const handleZoomToFit = useCallback(() => workspaceRef.current && zoomToFit(workspaceRef.current), []);

  const handleCopyImage = useCallback(async (): Promise<boolean> => {
    const ws = workspaceRef.current;
    if (!ws) return false;
    try {
      const outcome = await copyWorkspaceImage(ws, procedureName);
      if (outcome === 'copied') return true;
      setToast('コピー非対応のためダウンロードしました');
      return false;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setToast(`画像のコピーに失敗しました: ${detail}`);
      return false;
    }
  }, [procedureName]);

  const handleCopyErrors = useCallback(async (): Promise<boolean> => {
    if (messages.length === 0) return false;
    try {
      await navigator.clipboard.writeText(formatMessagesAsText(messages));
      return true;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setToast(`コピーに失敗しました: ${detail}`);
      return false;
    }
  }, [messages]);

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
    <div className="app-shell">
      <Header />

      {refState.status === 'loading' && <div className="loading-banner">参照データを読み込み中です…</div>}

      <main className="main-grid">
        <section className="panel input-panel">
          <textarea
            className="json-textarea"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
            placeholder="ここにプロシージャJSONを貼り付け"
          />
          <button type="button" className="btn btn-primary btn-large" onClick={handleGenerate} disabled={!ready}>
            生成
          </button>
          <ValidationList messages={messages} onCopyErrors={handleCopyErrors} />
        </section>

        <section className="panel preview-panel">
          <div className="preview-header">
            <span className="preview-title">プレビュー</span>
            <CopyButton
              className="btn btn-primary btn-small"
              idleLabel="画像をコピー"
              successLabel="✓ コピーしました"
              onCopy={handleCopyImage}
              disabled={!ready}
            />
          </div>
          <div className="workspace-wrap">
            <div className="workspace-host" ref={containerRef} />
            <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onZoomToFit={handleZoomToFit} disabled={!ready} />
          </div>
        </section>
      </main>

      {counts && (
        <StatusBar
          mcreatorVersion={counts.mcreatorVersion}
          fullBlockCount={counts.fullBlockCount}
          renderDefCount={counts.renderDefCount}
        />
      )}

      <Toast message={toast} />
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
