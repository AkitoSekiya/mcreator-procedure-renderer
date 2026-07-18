# MCreator Procedure Renderer — 実装仕様書 (v1.1)

> v1.1 変更点（実装レビューで確定）:
> - W002: 照合対象を blocks_full.json の表示ラベルではなく、blocks_render.json 由来の**ドロップダウン機械値**に変更（`src/lib/dropdownOptions.ts`）。表示ラベル入力は警告付きで機械値へ自動変換。`field_checkbox` と `logic_boolean.BOOL` は大文字小文字を問わず TRUE/FALSE に正規化
> - E999 を追加: domToWorkspace後のブロック数不一致（Blocklyによる接続拒否の安全網）および描画/出力時の予期しない例外
> - controls_if / text_join / call_procedure のミューテーション由来入力名（IF1../DO1../ELSE, ADDn, argn/nameN）は blocks_full.json に載らないため、検証で明示的に特別扱い（validate.ts冒頭の例外表参照）

設計責任者(Fable)による実装仕様。実装者はこの仕様に厳密に従うこと。
不明点は推測せず `public/reference/FULL-REFERENCE.md` と `public/reference/blocks_full.json` を確認する。

## 0. プロダクト概要

GPTが出力した「MCreatorプロシージャ構造化JSON」を入力すると、MCreator 2025.1のプロシージャブロックを **Google Blockly で機械描画**し、SVG/PNGとして保存できる1画面Webアプリ。画像生成AIは使わない。GitHub Pagesで静的配信。

## 1. 技術スタック（固定）

- Vite 5 + React 18 + TypeScript (strict)
- `blockly` **^11** （`blockly/blocks` と `blockly/msg/ja` を使用、`Blockly.setLocale(ja)`）
- 追加UIライブラリ禁止（素のCSSでよい）。状態管理はReact標準のみ
- `vite.config.ts`: `base: './'`（GitHub Pagesサブパス対応）。参照データは `fetch(import.meta.env.BASE_URL + 'reference/…')` で取得

## 2. 同梱データ（作成済み・変更禁止）

- `public/reference/blocks_full.json` — 検証用マスターデータ。`blocks[block_id]` に `shape`(`value|statement|hat`), `output_type`, `value_inputs[{name,check}]`, `statement_inputs[string[]]`, `fields[{name,type,options,datalist}]`, `dependencies["name:type"]`, `label_ja/label_en`, `category`, `colour_hex` 等
- `public/reference/blocks_render.json` — Blockly描画用定義。`definitions[]` は `Blockly.defineBlocksWithJsonArray` にほぼそのまま渡せる形式（日本語label済み）。`builtin_blocks[]` はBlockly標準ブロックで描画するID一覧（定義追加不要、`blockly/blocks`とjaロケールで日本語表示される）。`custom_field_types[]` は登録が必要なカスタムフィールド型
- `public/res/*.png` — field_imageが参照する画像（`src` は `res/server.png` 形式。描画前に `import.meta.env.BASE_URL` を前置して書き換えること）

## 3. 入力JSONスキーマ（この仕様が正）

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

- `type`, `parent`, `previous`, `children` キーは受理するが無視（存在したら情報メッセージI001「無視しました」）
- `next` と配列並びの併用も可（正規化: 配列要素の後に next チェーンを展開）
- アプリ側でロジックや階層を推測してはならない。入力構造をそのまま描画する

## 4. 検証（validate.ts）— エラーコード表

| code | 種別 | 内容 |
|---|---|---|
| E001 | error | JSONパース不能 |
| E002 | error | スキーマ違反（必須キー欠落、blocksが配列でない、node_id重複等） |
| E003 | error | block_id が blocks_full.json に存在しない |
| E004 | error | value_inputs/statement_inputs のキー名がそのブロック定義に存在しない |
| E005 | error | fields のキー名が定義に存在しない |
| E006 | error | 型不一致: 子の output_type と 入力の check の不整合（Blocklyと同じ規則: どちらかがnull/未定義なら適合、配列同士は積集合非空で適合） |
| E007 | error | 形状違反: ステートメント列に value ブロック、value_inputs に statement ブロック等（blocks_full.jsonのshapeで判定） |
| W001 | warn | 使用ブロックの dependencies 集約表示「このプロシージャは次の依存関係を要求: world, x, y, z, entity…（トリガーが提供しない場合MCreatorで警告）」 |
| W002 | warn | field_dropdown の値が options の機械値に含まれない |
| W003 | warn | mcreator_version 不一致 |
| I001 | info | 無視したキー（type/parent/previous/children） |

- エラーメッセージは必ず `node_id` と `block_id` を含む日本語文
- E001–E007 が1件でもあれば描画中止（エラー一覧表示）。warn/infoは描画続行
- 検証は blocks_full.json のみを根拠にする。**推測禁止**

## 5. Blockly描画（blockly/ ディレクトリ）

### 5.1 registerBlocks.ts
- `blocks_render.json` の `definitions` を `Blockly.defineBlocksWithJsonArray` で一括登録（アプリ起動時1回）
- 事前処理: 各defの `args0[].type==='field_image'` の `src` に BASE_URL を前置
- `hat: "cap"` キーがBlockly v11のjsonInitで無効だった場合のフォールバック: `event_trigger` の init をラップして `this.hat = 'cap'` を設定
- 既存の同名定義（js-json由来の `controls_flow_statements` 等）は上書きでよい

### 5.2 fields.ts — カスタムフィールド登録
`Blockly.fieldRegistry.register` で以下を登録。すべて「読み取り専用でテキスト表示」できれば十分:

- `field_data_list_selector` / `field_data_list_dropdown` / `field_ai_condition_selector`: `Blockly.FieldDropdown` を継承し、メニュー生成関数が「現在値のみの1択」を返す実装（`[[value||'…', value||'…']]`）。→ 見た目が本物同様「値＋▼」になる
- `field_mcitem_selector`: `Blockly.FieldTextInput` 継承（枠付き表示）。値=アイテムID文字列をそのまま表示
- `field_javaname` / `field_resourcelocation`: `FieldTextInput` 継承
- `field_multilinetext`: `FieldTextInput` 継承（改行は`⏎`置換で1行表示。制限事項としてREADMEに記載）
- fromJson では config の `datalist` 等を無視してよい。XML `<field name="x">値</field>` からの `setValue` が機能すること（バリデータは常にvalueを通す）

### 5.3 toXml.ts — 入力JSON → Blockly XML
- `trigger` があれば `<block type="event_trigger"><field name="trigger">値</field><next>…</next></block>` を根に、メイン列を接続。なければメイン列先頭が根
- 各BlockNode → `<block type><field/><value name><block…></value><statement name><block…(nextチェーン)></statement></block>`
- ステートメント列は `<next>` チェーンに変換
- **ミューテーション**（この3種のみ特別扱い、他は不要）:
  - `controls_if`: 入力名から `IF1..IFn/DO1..DOn` と `ELSE` を検出し `<mutation elseif="n" else="0|1"/>` を先頭子要素に付与
  - `text_join`: `ADD0..ADDn` の個数で `<mutation items="n+1"/>`
  - `call_procedure`: `arg0..argn` があれば `<mutation inputs="n+1"/>` と `<field name="name0">…`（fields の `name0..` を使用）
- ワークスペースへ: `Blockly.Xml.domToWorkspace`。ロード後 `workspace.getAllBlocks().length` が期待ブロック数（event_trigger含む）と一致するか確認し、不一致なら「Blocklyが接続を拒否した」旨のエラー表示（型検証E006をすり抜けたケースの安全網）

### 5.4 workspace.ts
- `Blockly.inject(el, { readOnly: true, renderer: 'geras', zoom: { controls: false, wheel: true, startScale: 0.9 }, move: { scrollbars: true, drag: true, wheel: true } })`
- API: `loadProcedure(xml): {blockCount}` / `zoomIn/zoomOut`（`workspace.zoomCenter(±1)`）/ `zoomToFit`（`workspace.zoomToFit()`）/ `zoomReset`（`setScale(1)` + `scrollCenter()`）/ `clear`
- 日本語ロケール: エントリポイントで `import * as ja from 'blockly/msg/ja'; Blockly.setLocale(ja)`（型が合わない場合 `as unknown as {[key:string]:string}`）

### 5.5 export.ts — SVG/PNG出力（文字はベクター保持）
- SVG: ワークスペースの `getCanvas()` を `cloneNode(true)`、transform除去。`workspace.getBlocksBoundingBox()` でviewBox算出（padding 16px）。親SVGの `<defs>`（グラデ・パターン）を複製。ページ内の `<style id^="blockly">` 等Blockly注入CSSテキストを全て `<style>` として埋め込み。`<image>` 要素の `href/xlink:href` は事前にfetch済みのdataURIへ置換（スタンドアロン化）。ルート `<svg xmlns=… xmlns:xlink=…>` を組み立て `XMLSerializer` で文字列化
- PNG: SVG文字列→Blob URL→`Image`→`canvas`（サイズ×scale 1/2/3/4、背景は白 or 透過選択は不要・白固定）→`toBlob('image/png')`→ダウンロード。`crossOrigin` 不要（同一オリジン＋dataURI）
- ファイル名: `procedure_name || 'procedure'` + `.svg` / `@2x.png` 等

## 6. UI（App.tsx + components/）

1画面2ペイン（CSS flex、左400px固定・右可変）。派手な装飾不要。

**左ペイン「プロシージャJSON」**: textarea（monospace）/ ボタン列: [ファイル読込] [サンプル▼(3種)] [クリア] [検証のみ] [生成] / 下部に検証結果リスト（error=赤, warn=黄, info=灰。code・node_id表示）

**右ペイン「プレビュー」**: ツールバー: [ズームイン][ズームアウト][全体表示][原寸100%] | [PNG保存 倍率select 1x-4x][SVG保存] / Blocklyワークスペースdiv（高さ100%）

**下部ステータスバー**: `MCreator 2025.1 | 検証データ: 516ブロック / 描画定義: 501` （blocks_full.json/blocks_render.jsonのロード結果から動的に算出）+ ブロック検索トグル

**ブロック検索パネル**（トグル表示）: 入力1つ。block_id / label_ja / label_en / category を部分一致検索、最大50件をテーブル表示（id, 日本語名, カテゴリ, shape, output_type）

参照データのfetch失敗時は画面全体にエラー表示（「reference/ が配信されていません」）。

## 7. サンプルJSON（public/samples/ に3ファイル、実在IDのみ使用）

1. `sample1_hello.json` — trigger なし。`entity_send_chat`(text←`text`"こんにちは！", actbar←`logic_boolean` FALSE, entity←`entity_from_deps`) 1個
2. `sample2_if_else.json` — trigger:"onRightClickedOnBlock"。`controls_if`（IF0←`entity_isinwater`(entity←`entity_from_deps`), DO0:[`entity_send_chat`…], ELSE:[`strike_lightning`(x←`coord_x`,y←`coord_y`,z←`coord_z`, fields:{effectOnly:"FALSE"})]）→ 次に `entity_send_chat`(text←`text_join`(ADD0←`text`"体力: ", ADD1←`entity_health`(entity←`entity_from_deps`)))
3. `sample3_repeat.json` — `controls_repeat_ext`(TIMES←`math_number` NUM:10, DO:[`spawn_particle`(x/y/z←coord_x/y/z, xs/ys/zs←`math_number` 0, fields:{particle:"minecraft:heart"})])

各fields名・input名は blocks_full.json と本仕様の記載に厳密一致させること（作成後に必ず自分で `node scripts/check-samples.mjs` 相当の検証を書いて確認するか、アプリのバリデータをnodeで実行して確認）。

## 8. その他成果物

- `README.md`（日本語）: 概要 / 起動(`npm install`,`npm run dev`) / ビルド(`npm run build`) / GitHub Pages公開手順 / 入力JSON仕様（§3を転記） / エラーコード表 / 画像保存方法 / 制限事項（call_procedure引数表示は簡易、field_multilinetextは1行表示、カスタム変数ブロック未対応、AIタスク/コマンド引数エディタ対象外、トリガー名は検証しない 等）
- `.github/workflows/deploy.yml`: main push → `npm ci` → `npm run build` → actions/configure-pages + upload-pages-artifact(dist) + deploy-pages。permissions: pages:write, id-token:write
- `.gitignore`（node_modules, dist）
- `package.json` scripts: `dev` / `build`（`tsc -b && vite build`） / `preview` / `typecheck`
- コミットはしなくてよい（レビュー後にこちらで行う）

## 9. 受け入れ基準（実装者が自分で確認して報告）

1. `npm install` → `npm run typecheck` エラー0
2. `npm run build` 成功、`dist/` に reference/ と res/ が含まれる
3. サンプル3種がバリデータを通過する（nodeまたはvitestで機械的に確認）
4. 意図的な壊れ入力（unknown block_id / 未知input名 / 型不一致）が E003/E004/E006 になるテストがある
5. dist/index.html をサブパス配信しても動く相対パス構成（絶対パス`/`参照が無いこと）
