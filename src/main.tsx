import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as ja from 'blockly/msg/ja';
import App from './App';
import './index.css';

// Must run before any block definitions are registered: builtin block
// labels (blockly/blocks) and colour references like "%{BKY_MATH_HUE}" in
// blocks_render.json's definitions both resolve against Blockly.Msg
// (SPEC.md §1/§5.1).
Blockly.setLocale(ja as unknown as { [key: string]: string });

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root 要素が見つかりません。');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
