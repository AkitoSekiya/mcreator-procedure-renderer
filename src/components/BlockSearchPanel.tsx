import { useMemo, useState } from 'react';
import type { FullReferenceData } from '../lib/referenceTypes';

const MAX_RESULTS = 50;

export function BlockSearchPanel({ full }: { full: FullReferenceData }): JSX.Element {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.values(full.blocks);
    const filtered = q
      ? all.filter((b) => {
          return (
            b.id.toLowerCase().includes(q) ||
            (b.label_ja ?? '').toLowerCase().includes(q) ||
            (b.label_en ?? '').toLowerCase().includes(q) ||
            b.category.toLowerCase().includes(q)
          );
        })
      : all;
    return filtered.slice(0, MAX_RESULTS);
  }, [query, full]);

  return (
    <div className="block-search-panel">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="block_id / 日本語名 / 英語名 / カテゴリ で検索"
        className="block-search-input"
      />
      <div className="block-search-count">
        {results.length}件表示（最大{MAX_RESULTS}件）
      </div>
      <div className="block-search-table-wrap">
        <table className="block-search-table">
          <thead>
            <tr>
              <th>block_id</th>
              <th>日本語名</th>
              <th>カテゴリ</th>
              <th>shape</th>
              <th>output_type</th>
            </tr>
          </thead>
          <tbody>
            {results.map((b) => (
              <tr key={b.id}>
                <td>{b.id}</td>
                <td>{b.label_ja ?? ''}</td>
                <td>{b.category}</td>
                <td>{b.shape}</td>
                <td>{b.output_type == null ? '' : Array.isArray(b.output_type) ? b.output_type.join(' | ') : b.output_type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
