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
npm run check-compat  # MCreator 2025.1互換性チェック（安全ガード・call_procedure引数mutator・捕獲/再召喚サンプル等）
```

`.github/workflows/ci.yml` が `push`/`pull_request` のたびに上記5コマンド全てとPDFレイアウト検証を自動実行します
（`.github/workflows/deploy.yml` はビルド＋GitHub Pagesデプロイ専任で、テストは実行しません）。

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
- **ルート自動分類とモード判別（v1後方互換）**: どこからも参照されていないノードのうち、実際のshapeが
  statement/hat のものを独立ルートとして扱い、その `next` チェーンを展開する。ここで文書全体を見て
  自動的に次の2モードいずれかで扱う:
  - **グラフ形式**（`value_inputs`/`statement_inputs`/`next` のどこかに node_id 文字列参照が1つでもある
    文書）: 最初のルート（`blocks` 配列での出現順）がメイン列としてtriggerに接続され、2本目以降は
    接続されていない独立スタックとして警告 **W004** 付きでそのまま描画される（Blockly XMLは複数の
    最上位ブロックを正当にサポートする）
  - **旧形式**（文字列参照を一切含まない、純粋なネスト形式の文書）: 「`blocks` 配列＝上から下へ繋がる
    メインのステートメント列」という当初の契約をそのまま維持する。未参照ルートが複数あっても
    `blocks` 配列の出現順で自動的に `next` 連結し、1本のメイン列として描画する。**W004は出ない**
    （これは元々の正常な動作であり、警告や通知の対象ではない）
- **未参照のshape=valueブロック**: 警告 **W005** を出し、描画しない
- **多重参照**: 同一ノードが複数箇所（例えば2つの異なる `value_inputs`）から参照された場合、
  優先順位 `value_inputs > statement_inputs > next` で1箇所だけを採用し、他は警告 **W006** を出して切断する

> **要点**: 旧形式（文字列参照を含まない文書）では配列順が実行順になります。グラフ形式（文字列参照を
> 含む文書）では接続は `next`/参照のみが正であり、配列内の並び順そのものには意味がありません。

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

`controls_if`/`text_join` は Blockly 組み込みブロック（`blockly/blocks`）なので、実際のミューテーター
（elseif/else の追加、ADD2..の追加）もBlockly本体がそのまま提供しており、検証さえ通れば正しく描画されます。

一方 `call_procedure` は `blocks_full.json` 上で `"source": "js-imperative"` と記録されている、MCreator側の
手書きJSコードによるブロックです。そのため実際の引数ミューテーター実装は `blocks_render.json` の静的JSON定義
（`args0`）には一切含まれておらず（`mutator`/`extensions` キーも無し）、`<mutation inputs="N">` +
`<value name="argN">` + `<field name="nameN">` のXMLをそのままBlocklyへ読み込ませても、対応する入力/フィールドが
存在しないため**サイレントに破棄されていました**（接続した引数ブロックごと消え、検証は素通りしてしまう）。
`src/blockly/registerBlocks.ts` の `applyCallProcedureArgsMutator()` が、`call_procedure` の
`domToMutation`/`mutationToDom` を独自に実装することでこれを修正しています。MCreator実際の内部レイアウトに
一致する保証はなく（データが無いため）、「引数が消えず見える」ことを目標にしたレンダリング上の近似です。

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
| E010 | error | `value_inputs`/`statement_inputs`/`fields` のキー名に `__proto__`/`constructor`/`prototype` 等の予約済みキー名が使われている |
| E011 | error | 入力が大きすぎる（入力テキスト長 or `blocks` 配列の要素数が上限を超過） |
| E012 | error | value_inputs/statement_inputs/next の入れ子が深すぎる（再帰上限超過） |
| W001 | warn | 使用ブロックの dependencies 集約表示（trigger オブジェクト形式の提供分を差し引いた差分のみ） |
| W002 | warn | field_dropdown の値が機械値・表示ラベルのいずれにも一致しない |
| W003 | warn | mcreator_version 不一致 |
| W004 | warn | メイン列に接続されていない、独立したステートメント列 |
| W005 | warn | どこからも参照されていない value ブロック（描画されない） |
| W006 | warn | 同一ノードが複数箇所から参照され、優先順位により一部が切断された |
| W007 | warn | type/parent/previous/children が解決結果と矛盾している |
| W008 | warn | call_procedure の動的引数 `argN`/`nameN` の番号が0始まりの連番になっていない |
| W009 | warn | `field_number` 型のfieldの値が数値として解釈できない |
| I001 | info | 本当に未知のキー（文書全体で1件に集約） |
| I002 | info | blocks_full.jsonで required_apis を持つブロックが使われている（ノード単位） |
| I003 | info | プロシージャ全体で必要な追加APIの集約一覧（`required_apis` を持つ全ノードの和集合） |

E001〜E012 が1件でもあれば描画を中止し、エラー一覧のみを表示します。warn/infoは描画を継続します。

なお `E999` はSPEC.mdが定義する表には無い、本アプリ独自の安全網用コードです。検証自体は通過したにも関わらず
Blockly側が接続を拒否した（読み込み後のブロック数が期待値と不一致）場合や、描画・エクスポート処理自体が
例外を投げた場合にのみ表示されます。

## 入力の安全性・サイズ上限（`src/lib/guards.ts`）

- **予約済みキー名の拒否（E010）**: `value_inputs`/`statement_inputs`/`fields` のキー名として
  `__proto__`/`constructor`/`prototype` を使うことはできません。`JSON.parse` 自体はこれらを安全な
  通常のプロパティとして扱いますが、本アプリの正規化・検証処理は解決結果を毎回新しいオブジェクトへ
  詰め直す（`obj[key] = value` 形式のブラケット代入）箇所があり、キー名が `__proto__` の場合は
  Object.prototypeのアクセサ経由でそのオブジェクトの内部prototypeが書き換わってしまいます
  （対象オブジェクトはリクエスト毎に新規生成される、UIから直接触れないローカル変数なので、
  アプリ全体やブラウザ全体を汚染するような深刻な影響はありませんが、対象のキーが黙って消える
  という分かりにくい壊れ方をするため、この形のキーは正規化の入口で明示的に拒否しエラーとして
  報告します）
- **入力サイズ上限（E011）**: 入力テキストは`JSON.parse`前に文字数上限（`MAX_INPUT_JSON_LENGTH`、
  5,000,000文字）を、`blocks` 配列は要素数上限（`MAX_TOP_LEVEL_BLOCKS`、20,000件）をそれぞれ超えると
  即座に拒否します。実在するMCreatorプロシージャがこの規模になることはまず無いため、意図的に
  巨大化させた入力に対する安全網です
- **ネスト深さ上限（E012）**: `value_inputs`/`statement_inputs`/`next` を用いた入れ子構造は
  `MAX_NESTING_DEPTH`（500段）を超えると拒否します。JSONオブジェクトを再帰的にたどる正規化処理が
  スタックオーバーフローで異常終了することを防ぎます
- **参照/フィールドのMap/Set化**: node_idレジストリ・多重参照の勝者判定・訪問済み集合はいずれも
  `Map`/`Set` で管理しており、O(n²)の線形探索にはなっていません（`src/lib/normalizeInput.ts`）

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

## PDFとして保存

プレビュー右上の**「PDFで保存」**ボタンを押すと、A4のコピー用紙への印刷を想定した
`<procedure_name>.pdf` をダウンロードします。

- **A4・余白10mm**の印字領域に、はみ出さない範囲で**できるだけ大きく**配置します
- 画像の縦横比から**縦向き / 横向きを自動選択**します（横に広いプロシージャは自動で横向きになります）
- プロシージャが縦に長すぎて1ページに収まらない場合のみ、**幅いっぱいのサイズを維持したまま複数ページに分割**します。
  ページ境界で切れたブロックが読めるよう、隣接ページ間には**8mmの重複領域**があります。
  複数ページ時は右下に小さくページ番号（例: `1 / 3`）が入ります
- 画像は印刷200dpi以上を目標にした高解像度PNGとして埋め込まれるため、日本語ラベルも印刷で潰れません

レイアウト計算は `src/lib/pdfLayout.ts` の純関数で行っており、`npm run check-pdf-layout` で機械検証できます。

## 制限事項

### 対応済み・仕組みの説明

- `call_procedure` の引数（`arg0../name0..`）は `src/blockly/registerBlocks.ts` の独自mutatorにより実際に
  描画・接続されます（詳細は上記「mutator付きブロックの動的な入力名」）。ただしMCreator実際の内部レイアウトに
  一致する保証はない近似表示です。番号が0始まりの連番になっていない場合はW008で警告します
- `field_multilinetext` は改行を `⏎` に置き換えた1行表示のみで、実際の複数行レイアウトは再現しません
- AIタスク／コマンド引数エディタ等、特殊な複合エディタ系フィールドの再現は対象外です（テキスト表示のみ）
- `field_dropdown` の機械値は `blocks_render.json` の実際のBlockly定義から導出しています（`blocks_full.json`
  の `fields[].options` は一部のブロックで表示ラベルを記録しており、機械値と異なるため）。組み込み
  `logic_boolean` ブロックのように `blocks_render.json` に定義が存在しないもの（`blockly/blocks` が内部提供）は
  `src/lib/dropdownOptions.ts` に個別ハードコードしています。現時点で必要なのは `logic_boolean.BOOL` のみです
- `required_apis` を持つブロックはノード単位（I002）・プロシージャ全体の集約（I003）の両方で表示します
  （ただし現行の `blocks_full.json` には `required_apis` を持つブロックが1件も存在せず、実データでは
  発火しません — 発火条件自体は合成データで検証済みです）

### 未対応：根拠データ不足

以下は明示的に調査した上で、`public/reference/`（`FULL-REFERENCE.md`・`blocks_full.json`・`blocks_render.json`、
MCreator 2025.1の実データから抽出された計516ブロックの完全カタログ）のどこにも根拠データが存在しないため、
**推測実装をせず**未対応としているものです。もしMCreator側の実データ（実際のblock_id・field名・input名・
XML構造）を追加提供いただければ、その範囲で対応可能です。

- **カスタム変数（get/set、9型×6スコープ）**: `FULL-REFERENCE.md` はカテゴリとして
  `variables_get_<型>`/`variables_set_<型>` という命名パターンと型/スコープの一覧を説明していますが、
  これは「ワークスペースの変数定義に応じてMCreatorが動的生成する」ブロックのカテゴリ説明であり、
  具体的なBlockly block_id・field名（変数名をどのキーで持つか）・スコープの表現方法・PLAYER系スコープの
  Entity入力のinput名は一切記載がありません。`blocks_full.json`/`blocks_render.json` にも
  `variables_get_*`/`variables_set_*` に類するエントリは1件も存在しません（516ブロック全件を機械的に
  確認済み）。そのためこのブロックIDをJSONで指定した場合は未知のblock_idとして安全にE003になります
  （黙って誤描画するよりも安全側）
- **call_procedure の戻り値**: `blocks_full.json`/`FULL-REFERENCE.md` のいずれにも「プロシージャ呼び出しの
  戻り値を受け取る」ための値ブロックは存在しません。MCreator 2025.1のプロシージャは（このデータで見る限り）
  戻り値を持たない手続き（void）として扱われています
- **trigger の実在チェック・トリガー別dependencies**: `event_trigger` の実際のフィールドはセレクタ
  （`field_data_list_selector`, `datalist: "global_triggers"`）であり、`blocks_render.json`/`blocks_full.json`
  のどちらにも実際の `global_triggers` の選択肢一覧や、トリガー種別ごとに供給されるdependenciesの対応表は
  含まれていません。そのため `trigger` の文字列値そのものの実在検証はできず、トリガーが提供するdeps情報は
  引き続き入力JSON側の `trigger: {type, dependencies}` で明示してもらう方式のままです
- **iteratorスコープ外使用の検出**: `entity_iterator`/`direction_iterator`/`itemstack_iterator` は
  `blocks_full.json` 上ただの値ブロック（`shape: "value"`）で、`entity_iterator` に至っては
  `dependencies` すら空です。「どのステートメントブロックのDO0内でだけ有効か」を示すデータが
  存在しないため、スコープ外使用を検出する仕組みを実装する根拠がありません

## ディレクトリ構成（抜粋）

```
src/
  lib/            # 参照データ型・入力型・messages.ts・guards.ts（安全ガード）・
                  # normalizeInput.ts（構造正規化）・
                  # validate.ts（blocks_full.jsonに基づく厳格検証）・純粋関数、Node上でテスト可能
  blockly/        # registerBlocks（call_procedure引数mutator含む） / fields / toXml / workspace / export / clipboardExport
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
  check-graph.mjs   # フラットなグラフ形式の正規化テスト
  check-compat.mjs  # MCreator 2025.1互換性テスト（安全ガード・call_procedure引数mutator・捕獲/再召喚サンプル等）
.github/workflows/
  ci.yml            # push/PR毎にtypecheck + check-*系4本 + check-pdf-layoutを実行
  deploy.yml        # mainへのpush時にビルド＋GitHub Pagesデプロイ（テストは実行しない）
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
