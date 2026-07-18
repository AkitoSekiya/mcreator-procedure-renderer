# MCreator Procedure Renderer

GPTなどが出力した「MCreatorプロシージャ構造化JSON」を入力すると、MCreator 2025.1 のプロシージャブロックを
[Google Blockly](https://developers.google.com/blockly) で機械的に描画し、画像としてクリップボードにコピーできる
1画面Webアプリです。画像生成AIは使用していません。GitHub Pagesでの静的配信を前提としています。

「JSONを貼る → 生成 → 画像をコピーしてChatGPTに貼る」だけの、迷わないシンプルな導線を意図したUIです。

## 概要

- 左ペインの大きなテキストエリアにプロシージャ構造化JSONを貼り付け、「生成」ボタン1つで検証・描画を実行
- `blocks_full.json`（検証用マスターデータ）に基づいて厳密に検証し、エラー・警告・情報をカード形式で一覧表示
- 検証にエラーが1件もなければ右ペインのBlocklyワークスペースに実際のMCreatorブロックと同じ見た目で描画
- 右上の「画像をコピー」で描画結果を2倍解像度のPNG画像としてクリップボードにコピー（ChatGPT等に直接貼り付け可能）
- 検証メッセージ一覧の「エラーをコピー」でメッセージ全文をプレーンテキストとしてコピー（ChatGPTへの修正依頼用）
- プレビュー右下にズームイン／ズームアウト／全体表示のフローティングアイコンボタン

## 起動方法

```bash
npm install
npm run dev
```

`http://localhost:5173` を開いてください。

## ビルド

```bash
npm run build
```

`dist/` に静的ファイル一式（`reference/`・`res/`・`samples/` を含む）が生成されます。
`vite.config.ts` の `base: './'` により相対パス構成になっているため、任意のサブパスに配置しても動作します。

動作確認のみ行う場合:

```bash
npm run preview
```

## 型チェック・検証スクリプト

```bash
npm run typecheck     # tsc -b --noEmit
npm run check-samples # public/samples/*.json をアプリと同じ validate.ts で検証し、全件エラー0であることを確認
npm run check-broken  # 壊れ入力（unknown block_id / 未知input名 / 型不一致）がE003/E004/E006になることを確認
npm run check-graph   # フラットなグラフ形式の正規化（node_id参照解決・循環検出・多重参照・ルート分類等）を確認
```

## GitHub Pages への公開手順

1. このリポジトリを GitHub にプッシュする
2. リポジトリの Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定する
3. `main` ブランチに push すると `.github/workflows/deploy.yml` が自動的に `npm ci && npm run build` を実行し、
   `dist/` を GitHub Pages にデプロイする
4. 公開URL（`https://<user>.github.io/<repo>/` 等）はサブパスになるが、相対パス構成のため追加設定は不要

## 入力JSONスキーマ

```jsonc
{
  "format_version": 1,              // 必須。1, "1", 1.0, "1.0" を受理し数値1へ正規化。それ以外はE002
  "mcreator_version": "2025.1",    // 任意。"2025.1"以外は警告W003
  "procedure_name": "my_proc",     // 必須
  "description": "説明",            // 任意
  "trigger": "onRightClickedOnBlock", // 任意。string | null | {type, dependencies?} を受理（後述）
  "blocks": [ /* BlockNode[]（ネスト形式・フラットなグラフ形式・混在のいずれも可） */ ]
}
```

```jsonc
// BlockNode（ネスト形式）
{
  "node_id": "n1",                 // 必須・一意。全エラーメッセージに含める
  "block_id": "controls_if",       // 必須。blocks_full.jsonに存在しなければエラーE003（推測・置換禁止）
  "fields": { "OP": "EQ" },        // 任意。field_dropdownは機械値を使用（後述）。チェックボックスは "TRUE"/"FALSE"
  "value_inputs": { "IF0": {/*BlockNode*/} },   // または "IF0": "他ノードのnode_id文字列"
  "statement_inputs": { "DO0": [ /*BlockNode[]*/ ] }, // 単一のBlockNode/node_id文字列も受理し配列化
  "next": {/*BlockNode*/}          // 任意。BlockNodeの代わりにnode_id文字列も可
}
```

- `type`, `parent`, `previous`, `children` キーは既知のキーとして静かに受理する（解決結果と矛盾する場合のみ
  警告W007。本当に未知のキーは、ノード毎ではなく文書全体で1件の情報メッセージI001に集約）
- `next` と配列並びの併用も可（配列要素の後に next チェーンを展開して正規化する）
- アプリはロジックや階層を一切推測しない。入力構造をそのまま描画する

### フラットなグラフ形式（node_id参照）

`value_inputs`/`statement_inputs`/`next` の値には、ネストしたBlockNodeオブジェクトの代わりに、
`blocks` 配列内の他ノードの `node_id` を**文字列**で書いて参照できます。ネスト形式・文字列参照は
自由に混在できます。`public/samples/sample4_graph.json` は `sample2_if_else.json` と全く同じ
プロシージャをこの形式で書いた例です（両者は完全に同一のXMLへ正規化されます）。

```jsonc
{
  "format_version": 1,
  "procedure_name": "example",
  "trigger": { "type": "onRightClickedOnBlock", "dependencies": ["entity:entity"] },
  "blocks": [
    {
      "node_id": "block_001",
      "block_id": "controls_if",
      "value_inputs": { "IF0": "block_002" },
      "statement_inputs": { "DO0": ["block_003"] },
      "next": "block_004"
    },
    { "node_id": "block_002", "block_id": "entity_isinwater", "value_inputs": { "entity": "block_005" } },
    { "node_id": "block_005", "block_id": "entity_from_deps" }
    // ... block_003, block_004 なども blocks 配列にフラットに列挙する
  ]
}
```

正規化ルール（`src/lib/normalizeInput.ts`。検証（`validate.ts`）より必ず先に実行される）:

- **trigger のオブジェクト形式**: `{type, dependencies?}` を受理。`type` をトリガー名として扱い、
  `dependencies`（`"name:type"` 形式の配列、例: `"entity:entity"`）を「トリガーが提供する依存関係」として
  保持する。下記W001の依存関係警告は、使用ブロックが要求するdepsからトリガー提供分を差し引いた差分のみを
  表示し、全て提供されていれば警告は出ない
- **node_id参照解決**: 存在しない参照先は **E008**。循環参照（例: `A.next="B"`, `B.next="A"`）は **E009**
  （循環パスをメッセージに含める）
- **statement_inputsの単数値**: `"DO0": "block_003"` のように単一の文字列/オブジェクトも受理し、自動的に
  1要素の配列として扱う
- **ルート自動分類・複数スタック描画**: どこからも参照されていないノードのうち、実際のshapeが
  statement/hat のものを独立ルートとして扱い、その `next` チェーンを展開する。最初のルート（`blocks`
  配列での出現順）がメイン列としてtriggerに接続され、2本目以降は接続されていない独立スタックとして
  警告 **W004** 付きでそのまま描画される（Blockly XMLは複数の最上位ブロックを正当にサポートする）
- **未参照のshape=valueブロック**: 警告 **W005** を出し、描画しない
- **多重参照**: 同一ノードが複数箇所（例えば2つの異なる `value_inputs`）から参照された場合、
  優先順位 `value_inputs > statement_inputs > next` で1箇所だけを採用し、他は警告 **W006** を出して切断する

### field_dropdown は機械値を使う

`fields` に `field_dropdown` 型の値を書く場合は、必ずBlocklyの**機械値**（例: `"EQ"`, `"NEQ"`, `"LT"`）を使ってください。
`blocks_full.json` の `fields[].options` は一部のブロック（`math_binary_ops.OP` の `"="`,`"≠"`,`"<"` など）で
**表示ラベル**を記録しており、機械値と一致しません。本アプリは `blocks_render.json` の実際のBlockly定義から
正しい機械値一覧を導出して検証します（`src/lib/dropdownOptions.ts`）:

- 機械値を指定した場合 → 警告なし
- 表示ラベルを指定した場合 → 警告・情報メッセージを一切出さずに自動的に機械値へ変換して描画する（例: `"="` → `"EQ"`）
- どちらにも一致しない値 → 警告W002（機械値の一覧を提示）

また `field_checkbox` と組み込み `logic_boolean` ブロックの `BOOL` フィールドは、大文字小文字を問わず
`"true"/"TRUE"/"false"/"FALSE"` を受理し、内部的に `"TRUE"/"FALSE"` へ正規化してから検証・描画します
（GPT出力での大文字小文字の揺れ対策）。

### mutator付きブロックの動的な入力名

`controls_if` の `IF1../DO1../ELSE`、`text_join` の `ADD2..`、`call_procedure` の `arg1../name0..` は
Blockly側のミューテーター機能で動的に追加される入力/フィールドであり、`blocks_full.json` の
`value_inputs`/`statement_inputs`/`fields` には既定形状（`IF0`/`DO0`/`ADD0`/`ADD1` など）しか列挙されていません。
本アプリの検証はこれらの命名パターンを追加ルールとして特別に認識します（詳細は `src/lib/validate.ts` の
`DYNAMIC_*_PATTERNS` を参照）。

## エラーコード表

| code | 種別 | 内容 |
|---|---|---|
| E001 | error | JSONパース不能 |
| E002 | error | スキーマ違反（必須キー欠落、blocksが配列でない、node_id重複等） |
| E003 | error | block_id が blocks_full.json に存在しない |
| E004 | error | value_inputs/statement_inputs のキー名がそのブロック定義に存在しない |
| E005 | error | fields のキー名が定義に存在しない |
| E006 | error | 型不一致: 子の output_type と 入力の check の不整合 |
| E007 | error | 形状違反: ステートメント列に value ブロック、value_inputs に statement ブロック等 |
| E008 | error | node_id 参照先が blocks 配列内に見つからない |
| E009 | error | node_id参照による循環参照を検出 |
| W001 | warn | 使用ブロックの dependencies 集約表示（trigger オブジェクト形式の提供分を差し引いた差分のみ） |
| W002 | warn | field_dropdown の値が機械値・表示ラベルのいずれにも一致しない |
| W003 | warn | mcreator_version 不一致 |
| W004 | warn | メイン列に接続されていない、独立したステートメント列 |
| W005 | warn | どこからも参照されていない value ブロック（描画されない） |
| W006 | warn | 同一ノードが複数箇所から参照され、優先順位により一部が切断された |
| W007 | warn | type/parent/previous/children が解決結果と矛盾している |
| I001 | info | 本当に未知のキー（文書全体で1件に集約） |
| I002 | info | blocks_full.jsonで required_apis を持つブロックが使われている |

E001〜E009 が1件でもあれば描画を中止し、エラー一覧のみを表示します。warn/infoは描画を継続します。

なお `E999` はSPEC.mdが定義する表には無い、本アプリ独自の安全網用コードです。検証自体は通過したにも関わらず
Blockly側が接続を拒否した（読み込み後のブロック数が期待値と不一致）場合や、描画・エクスポート処理自体が
例外を投げた場合にのみ表示されます。

## 画像のコピー方法

プレビュー右上の**「画像をコピー」**ボタンを押すと、ワークスペースの内容を2倍解像度・背景白固定のPNGとして
`navigator.clipboard.write` でクリップボードにコピーします。成功するとボタンの表示が2秒間
「✓ コピーしました」に変わります。そのままChatGPTなどの入力欄に `Cmd/Ctrl+V` で直接貼り付け可能です。

`ClipboardItem` 非対応のブラウザや、クリップボード権限が得られずコピーが失敗した場合は自動的に
`<procedure_name>@2x.png` としてPNGファイルのダウンロードにフォールバックし、画面下部に
「コピー非対応のためダウンロードしました」というトーストを表示します。

検証メッセージ一覧の**「エラーをコピー」**ボタンは、表示中の全メッセージを
`[E003] node n5 (block_id: xxx): メッセージ本文` 形式のプレーンテキストとして
`navigator.clipboard.writeText` でコピーします（ChatGPTに貼ってエラー修正を依頼する用途）。
成功時は画像コピーと同様、ボタン表示が2秒間「✓ コピーしました」に変わります。

## 制限事項

- `call_procedure` の引数表示は簡易的なものです（動的な `arg0../name0..` の検証は特別ルールに基づく近似）
- `field_multilinetext` は改行を `⏎` に置き換えた1行表示のみで、実際の複数行レイアウトは再現しません
- カスタム変数ブロック（ユーザー定義変数の get/set 等）は対象外です
- AIタスク／コマンド引数エディタ等、特殊な複合エディタ系フィールドの再現は対象外です（テキスト表示のみ）
- トリガー名（`trigger` の文字列値）はMCreator側のグローバルトリガー一覧との整合性を検証しません
- `field_dropdown` の機械値は `blocks_render.json` の実際のBlockly定義から導出しています（`blocks_full.json`
  の `fields[].options` は一部のブロックで表示ラベルを記録しており、機械値と異なるため）。組み込み
  `logic_boolean` ブロックのように `blocks_render.json` に定義が存在しないもの（`blockly/blocks` が内部提供）は
  `src/lib/dropdownOptions.ts` に個別ハードコードしています。現時点で必要なのは `logic_boolean.BOOL` のみです。

## ディレクトリ構成（抜粋）

```
src/
  lib/            # 参照データ型・入力型・messages.ts・normalizeInput.ts（構造正規化）・
                  # validate.ts（blocks_full.jsonに基づく厳格検証）・純粋関数、Node上でテスト可能
  blockly/        # registerBlocks / fields / toXml / workspace / export / clipboardExport
  components/     # Header / ValidationList / ZoomControls / CopyButton / StatusBar / Toast
  data/           # ReferenceDataContext（参照JSONの起動時1回フェッチ）
  App.tsx / main.tsx / index.css
public/
  reference/      # blocks_full.json / blocks_render.json / FULL-REFERENCE.md（同梱・変更禁止）
  res/            # field_image 用画像（同梱・変更禁止）
  samples/        # サンプル4種（UIからは参照しなくなったが、check-samples.mjs/check-graph.mjs による
                  # 機械的な検証・CI用に残置）
scripts/
  check-samples.mjs
  check-broken.mjs
  check-graph.mjs  # フラットなグラフ形式の正規化テスト
```

`public/samples/` はUI上の「サンプル」選択機能としては提供していません（UIの簡素化のため削除）。
`npm run check-samples` / `npm run check-graph` から引き続き参照される、検証ロジックの回帰テスト用
データとして残しています。

### 正規化と検証の分離（`src/lib/`）

- `normalizeInput.ts` — 入力JSON（ネスト形式・フラットなグラフ形式・混在のいずれか）を、node_id参照解決・
  循環検出・多重参照排他・ルート自動分類などの**構造的な**処理を経て、単一の内部表現
  （`ResolvedDoc`/`ResolvedNode`、`resolvedTypes.ts`）へ正規化する。blocks_full.jsonの`shape`のみを参照する
  （ルート/孤立valueブロックの分類に必要なため）
- `validate.ts` — `normalizeInput.ts` が返した `ResolvedDoc` を受け取り、block_idの存在確認・
  入力/フィールド名の妥当性・型整合性など、blocks_full.jsonの詳細な意味論に基づく**厳格な検証**に専念する
- どちらもReact/Blockly/DOMに依存しない純粋関数群で、`scripts/*.mjs` からNode上で直接実行できる
