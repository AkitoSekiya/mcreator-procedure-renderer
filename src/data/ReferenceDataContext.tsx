import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { FullReferenceData, RenderReferenceData } from '../lib/referenceTypes';
import { buildDropdownOptionsMap, type DropdownOptionsMap } from '../lib/dropdownOptions';
import { registerBlocks } from '../blockly/registerBlocks';

export interface ReferenceData {
  full: FullReferenceData;
  render: RenderReferenceData;
  dropdownOptions: DropdownOptionsMap;
}

export type ReferenceLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ReferenceData };

const ReferenceDataContext = createContext<ReferenceLoadState>({ status: 'loading' });

let loadPromise: Promise<ReferenceData> | null = null;

/**
 * Fetches blocks_full.json + blocks_render.json exactly once per page load
 * (module-level singleton, SPEC.md §1: "大きいJSONのfetchは起動時1回"),
 * regardless of how many times ReferenceDataProvider mounts (e.g. React
 * StrictMode double-invoking effects in dev).
 */
function loadReferenceData(): Promise<ReferenceData> {
  if (!loadPromise) {
    const base = import.meta.env.BASE_URL;
    loadPromise = Promise.all([
      fetch(`${base}reference/blocks_full.json`).then((r) => {
        if (!r.ok) throw new Error(`blocks_full.json の取得に失敗しました (HTTP ${r.status})`);
        return r.json() as Promise<FullReferenceData>;
      }),
      fetch(`${base}reference/blocks_render.json`).then((r) => {
        if (!r.ok) throw new Error(`blocks_render.json の取得に失敗しました (HTTP ${r.status})`);
        return r.json() as Promise<RenderReferenceData>;
      }),
    ]).then(([full, render]) => {
      registerBlocks(render, base);
      const dropdownOptions = buildDropdownOptionsMap(render);
      return { full, render, dropdownOptions };
    });
  }
  return loadPromise;
}

export function ReferenceDataProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<ReferenceLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadReferenceData()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setState({ status: 'error', message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <ReferenceDataContext.Provider value={state}>{children}</ReferenceDataContext.Provider>;
}

export function useReferenceData(): ReferenceLoadState {
  return useContext(ReferenceDataContext);
}
