# MCreator Procedure Renderer — 実装仕様書 (v1.2)

> v1.2 変更点（正規化レイヤーの追加）:
> - **新パイプライン**: 入力JSON → `normalizeInput.ts`（新設、構造の正規化に専念）→ `ResolvedDoc`/`ResolvedNode` → `validate.ts`（blocks_full.json に基づく厳格検証に専念）→ `toXml.ts` → Blockly。正規化は検証より必ず先に走る
> - **フラットなグラフ形式を受理**: `blocks` に全ノードをフラットに列挙し、`value_inputs`/`statement_inputs`/`next` の値に他ノードの `node_id` 文字列を書いて参照する形式を、従来のネスト形式と**混在可**で受理（§3参照）。既存のネスト形式は完全に従来通り動作する
> - **ルート自動分類・複数スタック描画**: 参照されていないノードのうち shape=statement/hat を独立ルートとし、最初のルートをtriggerに接続するメイン列、以降は独立スタックとして描画（W004）。shape=valueで未参照のものは描画しない（W005）。同一ノードが複数箇所から参照された場合は `value_inputs > statement_inputs > next` の優先順位で1つを採用し、他は切断（W006）
> - **trigger のオブジェクト形式**: `trigger` は `string | null | {type, dependencies?}` を受理。`dependencies` は「トリガーが提供する依存関係」として扱われ、W001は「使用ブロックの要求deps − トリガー提供deps」の差分のみを表示
> - **format_version の正規化**: `1`, `"1"`, `1.0`, `"1.0"` をすべて受理し数値1として扱う
> - **フィールド表示ラベルの自動変換を完全サイレント化**: 従来はW002警告つきで変換していたが、v1.2では警告・情報メッセージ一切なしで機械値へ変換する（未知の値のみ引き続きW002）
> - **type/parent/previous/children を静かに受理**: ノード毎のI001スパムを廃止。矛盾がある場合のみ新設のW007を出す。本当に未知のキーは文書全体で1件のI001に集約
> - **required_apis の情報表示**: 新設I002で「追加APIが必要」を通知
> - エラーコード追加: `E008`（node_id参照が見つからない）, `E009`（循環参照）, `W004`〜`W007`, `I002`（詳細は§4）
>
> v1.1 変更点（実装レビューで確定）:
> - W002: 照合対象を blocks_full.json の表示ラベルではなく、blocks_render.json 由来の**ドロップダウン機械値**に変更（`src/lib/dropdownOptions.ts`）。表示ラベル入力は警告付きで機械値へ自動変換（→ v1.2でサイレント化）。`field_checkbox` と `logic_boolean.BOOL` は大文字小文字を問わず TRUE/FALSE に正規化
> - E999 を追加: domToWorkspace後のブロック数不一致（Blocklyによる接続拒否の安全網）および描画/出力時の予期しない例外
> - controls_if / text_join / call_procedure のミューテーション由来入力名（IF1../DO1../ELSE, ADDn, argn/nameN）は blocks_full.json に載らないため、検証で明示的に特別扱い（validate.ts冒頭の例外表参照）
>
> 注: §6（UI）はv1版アプリの当初設計の記録。実装済みUIは複数回の刷新を経ており、最新のUI仕様は README.md を正とする。

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
  "format_version": 1,              // 必須。1, "1", 1.0, "1.0" を受理し数値1へ正規化。それ以外はE002
  "mcreator_version": "2025.1",    // 任意。"2025.1"以外は警告W003
  "procedure_name": "my_proc",     // 必須
  "description": "説明",            // 任意
  "trigger": "onRightClickedOnBlock", // 任意。string | null | {type, dependencies?} を受理（後述）
  "blocks": [ /* BlockNode[]（後述: ネスト形式・フラットなグラフ形式・混在のいずれも可） */ ]
}
```

```jsonc
// BlockNode（ネスト形式の例。value_inputs/statement_inputs/next の値は
// オブジェクトの代わりに他ノードの node_id 文字列でもよい — フラットな
// グラフ形式。ネストされたオブジェクトと文字列参照は自由に混在できる）
{
  "node_id": "n1",                 // 必須・一意。全エラーメッセージに含める
  "block_id": "controls_if",       // 必須。blocks_full.jsonに存在しなければエラーE003（推測・置換禁止）
  "fields": { "OP": "EQ" },        // 任意。field_dropdownは機械値（例:'EQ'）。表示ラベル（例:'='）は警告なしで自動変換。チェックボックスは "TRUE"/"FALSE"（大文字小文字は問わない）
  "value_inputs": { "IF0": {/*BlockNode*/} },   // または "IF0": "node_idの文字列"
  "statement_inputs": { "DO0": [ /*BlockNode[]*/ ] }, // 単一のBlockNode/node_id文字列も受理し配列化
  "next": {/*BlockNode*/}          // 任意。BlockNodeの代わりにnode_id文字列も可。配列形式の代替として正規化
}
```

### フラットなグラフ形式（v1.2で追加）

```jsonc
{
  "format_version": 1,
  "procedure_name": "example",
  "trigger": { "type": "onRightClickedOnBlock", "dependencies": ["entity:entity"] },
  "blocks": [
    { "node_id": "block_001", "block_id": "controls_if",
      "value_inputs": { "IF0": "block_002" },
      "statement_inputs": { "DO0": ["block_003"] },
      "next": "block_004" },
    { "node_id": "block_002", "block_id": "entity_isinwater", "value_inputs": { "entity": "block_005" } },
    { "node_id": "block_003", "block_id": "entity_send_chat", "value_inputs": { /* ... */ } },
    { "node_id": "block_004", "block_id": "entity_send_chat", "value_inputs": { /* ... */ } },
    { "node_id": "block_005", "block_id": "entity_from_deps" }
  ]
}
```

`blocks` に全ノードをフラットに列挙し、`value_inputs`/`statement_inputs`/`next` の値に他ノードの
`node_id` 文字列を書いて参照する。`normalizeInput.ts` が以下の規則で単一の内部形式へ正規化してから
`validate.ts` の厳格検証に渡す（正規化は検証より必ず先に走る）:

1. **format_version正規化**: `1`, `"1"`, `1.0`, `"1.0"` を数値1として受理。それ以外はE002
2. **trigger**: `string | null | {type, dependencies?: string[]}` を受理。objectなら `type` をトリガー名、
   `dependencies`（"name:type"形式の配列）を「トリガーが提供する依存関係」として保持。W001は
   「使用ブロックの要求deps − トリガー提供deps」の差分のみを表示し、全て提供されていれば警告なし
3. **node_id参照解決**: 文字列参照を `blocks` 配列内の同一 `node_id` へ解決。存在しなければ **E008**
   「node_id "x" が見つかりません」。循環参照は **E009**（循環パスをメッセージに含める）
4. **statement_inputsの単数値**: 単一の文字列/オブジェクトも受理して配列化
5. **ルート自動分類**: どこからも参照されていないノードのうち shape=statement/hat をルートとし、
   その `next` チェーンを展開する。最初のルート（`blocks` 配列順）のチェーンをメイン列としてtriggerに
   接続。2本目以降の未接続チェーンは **W004**「接続されていないステートメント列」を出したうえで、
   独立したスタックとして描画する（Blockly XMLは複数の独立した最上位 `<block>` を正当にサポートする）
6. **未参照のshape=valueブロック**: **W005** を出して描画しない
7. **多重参照**（同一ノードが複数箇所から参照される）: 優先順位 `value_inputs > statement_inputs > next`
   で1箇所だけ採用し、他は **W006** で切断する
8. **補助フィールド `type`/`parent`/`previous`/`children`**: 既知のキーとして静かに受理する（ノード毎の
   I001は出さない）。`type` がblocks_full.jsoの実際の shape と矛盾する場合、または `parent`/`previous`/
   `children`（node_id文字列 or その配列）が解決結果と矛盾する場合のみ **W007**。一致すれば何も出さない。
   本当に未知のキーは、ノード毎ではなく文書全体で1件の **I001** に集約する
9. **field表示ラベル→機械値の自動変換**: `field_dropdown` の値が `blocks_render.json` 由来の機械値でなく
   表示ラベル（例: `math_binary_ops.OP` の `'='`）だった場合、警告・情報メッセージを一切出さずに機械値へ
   自動変換する（例: `'='` → `'EQ'`）。どちらにも一致しない値のみ引き続き **W002**
10. **required_apis**: blocks_full.jsonで `required_apis` を持つブロックが使われたら **I002**
    「このブロックは追加API(名前)が必要」

- アプリ側でロジックや階層を推測してはならない。入力構造をそのまま描画する（node_id参照の解決とルート
  自動分類は「推測」ではなく、入力に明示された参照関係の機械的な展開である）

## 4. 検証（normalizeInput.ts + validate.ts）— エラーコード表

| code | 種別 | 内容 |
|---|---|---|
| E001 | error | JSONパース不能 |
| E002 | error | スキーマ違反（必須キー欠落、blocksが配列でない、node_id重複等） |
| E003 | error | block_id が blocks_full.json に存在しない |
| E004 | error | value_inputs/statement_inputs のキー名がそのブロック定義に存在しない |
| E005 | error | fields のキー名が定義に存在しない |
| E006 | error | 型不一致: 子の output_type と 入力の check の不整合（Blocklyと同じ規則: どちらかがnull/未定義なら適合、配列同士は積集合非空で適合） |
| E007 | error | 形状違反: ステートメント列に value ブロック、value_inputs に statement ブロック等（blocks_full.jsonのshapeで判定） |
| E008 | error | （v1.2）value_inputs/statement_inputs/next の node_id 参照先が見つからない |
| E009 | error | （v1.2）node_id参照による循環参照を検出 |
| W001 | warn | 使用ブロックの dependencies 集約表示。trigger オブジェクト形式の `dependencies` が提供する分は差し引く |
| W002 | warn | field_dropdown の値が機械値・表示ラベルのいずれにも一致しない |
| W003 | warn | mcreator_version 不一致 |
| W004 | warn | （v1.2）ルートのnextチェーンのうち、メイン列に接続されていない独立したステートメント列 |
| W005 | warn | （v1.2）どこからも参照されていない shape=value ブロック（描画されない） |
| W006 | warn | （v1.2）同一ノードが複数箇所から参照され、優先順位により一部が切断された |
| W007 | warn | （v1.2）type/parent/previous/children が解決結果と矛盾している |
| I001 | info | 本当に未知のキー（文書全体で1件に集約。type/parent/previous/childrenは既知のキーとして静かに受理） |
| I002 | info | （v1.2）blocks_full.jsonで required_apis を持つブロックが使われている |

- エラーメッセージは必ず `node_id` と `block_id` を含む日本語文（ドキュメント全体に関する一部のE002/I001を除く）
- E001–E009 が1件でもあれば描画中止（エラー一覧表示）。warn/infoは描画続行
- ブロック定義に関する判定は blocks_full.json / blocks_render.json のみを根拠にする。**推測禁止**。
  ただしnode_id参照解決・循環検出・ルート分類などのグラフ構造処理は `normalizeInput.ts` が担当し、
  blocks_full.jsonの `shape` のみを参照する（block_idの存在確認や入力/フィールド名の妥当性は
  `validate.ts` が担当）

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

### 5.3 toXml.ts — 正規化済みプロシージャ → Blockly XML
- 入力は `validate.ts` が返す `NormalizedProcedure { procedureName, trigger, stacks }`。`stacks[0]` がメイン列、
  `stacks[1..]` はv1.2で追加された独立スタック（ルート自動分類・W004由来）
- `trigger` があれば `<block type="event_trigger"><field name="trigger">値</field><next>…</next></block>` を根に、
  メイン列（`stacks[0]`）を接続。なければメイン列先頭が根
- `stacks[1..]` の各独立スタックは、メイン列の根と同じ `<xml>` ルート直下に、接続されない兄弟 `<block>` として
  そのまま並べる（Blockly XMLは複数の最上位 `<block>` を正当にサポートする）
- 各BlockNode → `<block type><field/><value name><block…></value><statement name><block…(nextチェーン)></statement></block>`
- ステートメント列は `<next>` チェーンに変換
- **ミューテーション**（この3種のみ特別扱い、他は不要）:
  - `controls_if`: 入力名から `IF1..IFn/DO1..DOn` と `ELSE` を検出し `<mutation elseif="n" else="0|1"/>` を先頭子要素に付与
  - `text_join`: `ADD0..ADDn` の個数で `<mutation items="n+1"/>`
  - `call_procedure`: `arg0..argn` があれば `<mutation inputs="n+1"/>` と `<field name="name0">…`（fields の `name0..` を使用）
- ワークスペースへ: `Blockly.Xml.domToWorkspace`。ロード後 `workspace.getAllBlocks().length` が期待ブロック数
  （event_trigger含む・全スタック合算）と一致するか確認し、不一致なら「Blocklyが接続を拒否した」旨のエラー表示
  （型検証E006をすり抜けたケースの安全網）

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

## 7. サンプルJSON（public/samples/ に4ファイル、実在IDのみ使用）

1. `sample1_hello.json` — trigger なし。`entity_send_chat`(text←`text`"こんにちは！", actbar←`logic_boolean` FALSE, entity←`entity_from_deps`) 1個
2. `sample2_if_else.json` — trigger:"onRightClickedOnBlock"。`controls_if`（IF0←`entity_isinwater`(entity←`entity_from_deps`), DO0:[`entity_send_chat`…], ELSE:[`strike_lightning`(x←`coord_x`,y←`coord_y`,z←`coord_z`, fields:{effectOnly:"FALSE"})]）→ 次に `entity_send_chat`(text←`text_join`(ADD0←`text`"体力: ", ADD1←`entity_health`(entity←`entity_from_deps`)))
3. `sample3_repeat.json` — `controls_repeat_ext`(TIMES←`math_number` NUM:10, DO:[`spawn_particle`(x/y/z←coord_x/y/z, xs/ys/zs←`math_number` 0, fields:{particle:"minecraft:heart"})])
4. `sample4_graph.json`（v1.2で追加）— `sample2_if_else.json` と同一構造を、フラットなグラフ形式（`blocks`に
   全ノードをフラット列挙し `node_id` 文字列で相互参照、`trigger` はオブジェクト形式）で表現したもの。UIからは
   参照しないが、`normalizeInput.ts` が両形式から同一のXMLを生成することのテスト・ドキュメント用に用いる

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
3. サンプル4種がバリデータを通過する（nodeまたはvitestで機械的に確認、`npm run check-samples`）
4. 意図的な壊れ入力（unknown block_id / 未知input名 / 型不一致）が E003/E004/E006 になるテストがある（`npm run check-broken`）
5. dist/index.html をサブパス配信しても動く相対パス構成（絶対パス`/`参照が無いこと）
6. （v1.2）フラットなグラフ形式の正規化テスト（node_id参照解決・循環検出・多重参照・ルート分類・W004-W007等）
   が `npm run check-graph` で全green
