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
  "format_version": 1,              // 必須。1のみ受理
  "mcreator_version": "2025.1",    // 任意。"2025.1"以外は警告W003
  "procedure_name": "my_proc",     // 必須
  "description": "説明",            // 任意
  "trigger": "onRightClickedOnBlock", // 任意(string|null)。あればevent_triggerハットブロックを先頭に描画しtriggerフィールドに表示
  "blocks": [ /* BlockNode[] メインのステートメント列（上から下） */ ]
}
```

```jsonc
// BlockNode
{
  "node_id": "n1",                 // 必須・一意。全エラーメッセージに含める
  "block_id": "controls_if",       // 必須。blocks_full.jsonに存在しなければエラーE003（推測・置換禁止）
  "fields": { "OP": "EQ" },        // 任意。チェックボックスは "TRUE"/"FALSE"
  "value_inputs": { "IF0": {/*BlockNode*/} },
  "statement_inputs": { "DO0": [ /*BlockNode[]*/ ] },
  "next": {/*BlockNode*/}          // 任意。配列形式の代替。正規化して配列に統合
}
```

- `type`, `parent`, `previous`, `children` キーは受理するが無視する（情報メッセージI001）
- `next` と配列並びの併用も可（配列要素の後に next チェーンを展開して正規化する）
- アプリはロジックや階層を一切推測しない。入力構造をそのまま描画する

### field_dropdown は機械値を使う

`fields` に `field_dropdown` 型の値を書く場合は、必ずBlocklyの**機械値**（例: `"EQ"`, `"NEQ"`, `"LT"`）を使ってください。
`blocks_full.json` の `fields[].options` は一部のブロック（`math_binary_ops.OP` の `"="`,`"≠"`,`"<"` など）で
**表示ラベル**を記録しており、機械値と一致しません。本アプリは `blocks_render.json` の実際のBlockly定義から
正しい機械値一覧を導出して検証します（`src/lib/dropdownOptions.ts`）:

- 機械値を指定した場合 → 警告なし
- 表示ラベルを指定した場合 → 警告W002を出しつつ、自動的に機械値へ変換して描画する（例: `"="` → `"EQ"`）
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
| W001 | warn | 使用ブロックの dependencies 集約表示 |
| W002 | warn | field_dropdown の値が options の機械値に含まれない |
| W003 | warn | mcreator_version 不一致 |
| I001 | info | 無視したキー（type/parent/previous/children） |

E001〜E007 が1件でもあれば描画を中止し、エラー一覧のみを表示します。warn/infoは描画を継続します。

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
  lib/            # 参照データ型・入力型・validate.ts（純粋関数、Node上でテスト可能）
  blockly/        # registerBlocks / fields / toXml / workspace / export / clipboardExport
  components/     # Header / ValidationList / ZoomControls / CopyButton / StatusBar / Toast
  data/           # ReferenceDataContext（参照JSONの起動時1回フェッチ）
  App.tsx / main.tsx / index.css
public/
  reference/      # blocks_full.json / blocks_render.json / FULL-REFERENCE.md（同梱・変更禁止）
  res/            # field_image 用画像（同梱・変更禁止）
  samples/        # サンプル3種（UIからは参照しなくなったが、check-samples.mjs による
                  # 機械的な検証・CI用に残置）
scripts/
  check-samples.mjs
  check-broken.mjs
```

`public/samples/` はUI上の「サンプル」選択機能としては提供していません（UIの簡素化のため削除）。
`npm run check-samples` から引き続き参照される、検証ロジックの回帰テスト用データとして残しています。
