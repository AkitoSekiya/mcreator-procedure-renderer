# -*- coding: utf-8 -*-
"""Render MCreator procedure block reference (Markdown + JSON) from blocks.json."""
import json, os, colorsys

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = '/Users/akito/mcreator-procedure-reference'
os.makedirs(OUT, exist_ok=True)

data = json.load(open(os.path.join(BASE, 'blocks.json'), encoding='utf-8'))
blocks = data['blocks']
cats = data['categories']

def hue_to_hex(h):
    r, g, b = colorsys.hsv_to_rgb((float(h) % 360) / 360.0, 0.45, 0.65)
    return '#%02X%02X%02X' % (round(r*255), round(g*255), round(b*255))

# ---------- synthetic toolbox categories ----------
SYN = {
 'mcelements':      dict(name_ja='マインクラフト コンポーネント', name_en='Minecraft components', hue=360),
 'custom_variables':dict(name_ja='カスタム変数', name_en='Custom variables', hue=150),
 'logicloops':      dict(name_ja='フロー制御', name_en='Flow control', hue=120),
 'logicoperations': dict(name_ja='論理', name_en='Logic', hue=210),
 'math':            dict(name_ja='数学', name_en='Math', hue=230),
 'text':            dict(name_ja='テキスト', name_en='Text', hue=160),
 'time':            dict(name_ja='日付と時刻', name_en='Date & time', hue=None, hex='#628C94'),
 'advanced':        dict(name_ja='高度', name_en='Advanced', hue=250),
 'special':         dict(name_ja='特殊（エディタ内部/エントリポイント）', name_en='Special / internal', hue=90),
}
for cid, m in SYN.items():
    cats[cid] = {'id': cid, 'name_ja': m['name_ja'], 'name_en': m['name_en'],
                 'colour_hue': m.get('hue'),
                 'colour_hex': m.get('hex') or (hue_to_hex(m['hue']) if m.get('hue') is not None else None),
                 'parent': None}

# ---------- Blockly built-in message placeholders ----------
BKY_MSG = {
 '%{BKY_CONTROLS_FLOW_STATEMENTS_OPERATOR_BREAK}': 'break out of loop（ループを抜ける）',
 '%{BKY_CONTROLS_FLOW_STATEMENTS_OPERATOR_CONTINUE}': 'continue with next iteration（次の周回へ）',
 '%{BKY_MATH_ROUND_OPERATOR_ROUND}': 'round（四捨五入）',
 '%{BKY_MATH_ROUND_OPERATOR_ROUNDDOWN}': 'round down（切り捨て）',
 '%{BKY_MATH_ROUND_OPERATOR_ROUNDUP}': 'round up（切り上げ）',
 '%{BKY_MATH_SINGLE_OP_ABSOLUTE}': 'absolute（絶対値）',
 '%{BKY_MATH_SINGLE_OP_ROOT}': '√（平方根）',
 '%{BKY_MATH_TRIG_SIN}': 'sin', '%{BKY_MATH_TRIG_COS}': 'cos', '%{BKY_MATH_TRIG_TAN}': 'tan',
 '%{BKY_MATH_TRIG_ASIN}': 'asin', '%{BKY_MATH_TRIG_ACOS}': 'acos', '%{BKY_MATH_TRIG_ATAN}': 'atan',
}
def sub_bky(s):
    if isinstance(s, str):
        for k, v in BKY_MSG.items():
            s = s.replace(k, v)
    return s

for b in blocks.values():
    for key in ('label_en', 'label_ja', 'label_rendered'):
        b[key] = sub_bky(b.get(key))
    for f in b.get('fields', []):
        if f.get('options'):
            f['options'] = [sub_bky(o) for o in f['options']]

fs = blocks.get('controls_flow_statements')
if fs:
    fs.update(colour_hue=120, colour_hex=hue_to_hex(120), colour_name_ja='緑',
              label_ja='ループを抜ける / 次の周回へ（break / continue）')

# ---------- category assignment for JS/builtin blocks ----------
ASSIGN = {
 'mcelements': ['coord_x','coord_y','coord_z','mcitem_allblocks','mcitem_all','entity_from_deps',
   'source_entity_from_deps','immediate_source_entity_from_deps','entity_iterator',
   'damagesource_from_deps','direction_constant','direction_from_deps'],
 'logicloops': ['controls_if','logic_ternary_op','controls_repeat_ext','controls_while','controls_flow_statements'],
 'logicoperations': ['logic_negate','logic_boolean','logic_binary_ops','math_binary_ops','text_binary_ops'],
 'math': ['math_number','math_java_constants','math_dual_ops','math_singular_ops','math_from_text'],
 'text': ['text','text_join','text_print','text_length','text_new_line','text_index_of','text_is_empty',
   'text_replace','text_replace_regex','text_substring_from','text_substring','text_contains','text_matches',
   'text_starts_with','text_ends_with','text_trim','text_uppercase','text_lowercase','text_format_number'],
 'time': [b for b in blocks if b.startswith('time_')],
 'advanced': ['cancel_event','set_event_result','call_procedure','java_code','java_code_get','debug_marker','entity_none'],
 'special': ['event_trigger','advancement_trigger','aitasks_container','args_start','feature_container',
   'old_command','direction_unspecified'],
}
for cid, ids in ASSIGN.items():
    for i in ids:
        if i in blocks and not blocks[i]['category']:
            blocks[i]['category'] = cid

# ---------- manual entries for Blockly built-ins ----------
def mk(id, cat, hue, shape, out, label_ja, label_en, rendered, inputs=None, stmts=None,
       fields=None, note=None):
    return {'id': id, 'source': 'builtin', 'category': cat, 'colour_hue': hue,
            'colour_hex': hue_to_hex(hue), 'colour_name_ja': None, 'shape': shape,
            'output_type': out, 'output_type_ja': None, 'has_prev_next': shape == 'statement',
            'inputs_inline': True, 'label_en': label_en, 'label_ja': label_ja,
            'label_rendered': rendered, 'tooltip_en': None, 'tooltip_ja': note, 'side': None,
            'value_inputs': inputs or [], 'statement_inputs': stmts or [],
            'fields': fields or [], 'dependencies': [], 'required_apis': None}

manual = [
 mk('controls_if','logicloops',120,'statement',None,
    'もし〜なら（if / else if / else）','if %1 do %2','もし ⬡条件:Boolean なら ⊏実行⊐',
    inputs=[{'name':'IF0','check':'Boolean'}], stmts=['DO0'],
    note='左上の歯車アイコン（ミューテーター）をクリックすると「そうでなくもし(else if)」「そうでなければ(else)」の節を追加できる。'),
 mk('controls_repeat_ext','logicloops',120,'statement',None,
    '%1 回繰り返す','repeat %1 times do %2','⬡回数:Number 回繰り返す ⊏実行⊐',
    inputs=[{'name':'TIMES','check':'Number'}], stmts=['DO']),
 mk('logic_negate','logicoperations',210,'value','Boolean',
    '%1 ではない（NOT）','not %1','NOT ⬡値:Boolean',
    inputs=[{'name':'BOOL','check':'Boolean'}]),
 mk('logic_boolean','logicoperations',210,'value','Boolean',
    '真/偽 定数','true / false','▼[true|false]',
    fields=[{'name':'BOOL','type':'field_dropdown','datalist':None,'options':['true','false']}]),
 mk('math_number','math',230,'value','Number',
    '数値定数','number','[数値入力: 0]',
    fields=[{'name':'NUM','type':'field_number','datalist':None,'options':None}]),
 mk('text','text',160,'value','String',
    'テキスト定数','" text "','“[テキスト入力]”',
    fields=[{'name':'TEXT','type':'field_input','datalist':None,'options':None}],
    note='両端に引用符が表示される丸みの強い小型ブロック。'),
 mk('text_join','text',160,'value','String',
    'テキストを連結','create text with %1 %2','連結 ⬡A:any ⬡B:any …',
    inputs=[{'name':'ADD0','check':None},{'name':'ADD1','check':None}],
    note='歯車ミューテーターで連結する項目数を増減できる。数値など任意の値を文字列化して結合する。'),
 mk('text_length','text',160,'value','Number',
    '%1 の長さ','length of %1','⬡テキスト:String の長さ',
    inputs=[{'name':'VALUE','check':'String'}]),
 mk('text_print','text',160,'statement',None,
    '%1 をコンソールへ出力','print %1','出力(ログ) ⬡値:any',
    inputs=[{'name':'TEXT','check':None}],
    note='ゲーム内チャットではなく実行ログ（コンソール）へ出力する。デバッグ用途。'),
]
for b in manual:
    if b['id'] not in blocks:
        blocks[b['id']] = b

# direction_from_deps fix (regex miss)
if 'direction_from_deps' not in blocks:
    blocks['direction_from_deps'] = mk('direction_from_deps','mcelements',20,'value','Direction',
        '依存関係の方向','Provided direction','方向（トリガーから供給）',
        note='イベント/トリガーが提供する direction 依存関係の値を返す。')

# mcitem labels
if 'mcitem_allblocks' in blocks:
    blocks['mcitem_allblocks'].update(label_ja='ブロック選択（全ブロック）', label_en='Block selector',
        label_rendered='[ブロック選択UI] «b.png 縦帯アイコン»',
        tooltip_ja='クリックするとブロック一覧ダイアログが開き、選んだブロックを BlockState 値として返す。')
if 'mcitem_all' in blocks:
    blocks['mcitem_all'].update(label_ja='アイテム/ブロック選択（全アイテム）', label_en='Item/block selector',
        label_rendered='[アイテム選択UI] «bi.png 縦帯アイコン»',
        tooltip_ja='クリックするとアイテム/ブロック一覧ダイアログが開き、選択物を MCItem 値として返す。')
if 'java_code_get' in blocks:
    blocks['java_code_get'].update(label_ja='カスタムコード（値）', label_en='Custom code value',
        label_rendered='[Javaコード入力] を値として評価')
if 'args_start' in blocks:
    blocks['args_start'].update(label_ja='コマンド引数エントリポイント', label_en='Command entry point')

# ---------- curated use cases ----------
USE = {
 'controls_if': '「プレイヤーの体力が10未満なら再生付与」など、ほぼ全てのプロシージャの分岐の起点。',
 'controls_repeat_ext': '「5回連続で矢を発射」「範囲内の座標を走査」など回数指定の反復。',
 'controls_while': '「足元が水である間、上昇し続ける」など条件付きループ。',
 'controls_flow_statements': 'ループ内で条件を満たしたら break で脱出／continue で次の周回へ。',
 'logic_ternary_op': '「夜なら10、昼なら5」のように1つの式で値を切り替える。',
 'math_number': 'ダメージ量・座標オフセット・回数など、あらゆる数値入力の既定パーツ。',
 'math_dual_ops': '「x + 2」「体力 × 0.5」など2項演算。ドロップダウンで + − × ÷ 剰余 べき乗 min/max などを選択。',
 'math_singular_ops': '√・絶対値・四捨五入・sin/cos など1入力の数学関数。',
 'math_java_constants': 'ランダム値 [0,1) を「Random×n」でダメージ乱数に、πを角度計算に。',
 'math_binary_ops': '「体力 < 5」「レベル ≥ 30」など数値比較。if の条件スロットに差し込む。',
 'logic_binary_ops': '複数条件の AND/OR 結合。「雨が降っている AND 屋外にいる」。',
 'text_binary_ops': '文字列の一致/不一致判定。「持ち物の名前 = "魔法の剣"」。',
 'logic_boolean': '条件の初期値や、論理型変数への代入値として使用。',
 'logic_negate': '「水中に居ない場合」など条件の反転。',
 'text': 'チャットメッセージ・NBTタグ名・コマンド文字列などテキスト入力の既定パーツ。',
 'text_join': '「"体力: " + 現在HP」のように動的メッセージを組み立てる。',
 'coord_x': 'イベント発生地点のX座標。ブロック設置/破壊系ブロックの x スロットの既定値。',
 'coord_y': 'イベント発生地点のY座標。',
 'coord_z': 'イベント発生地点のZ座標。',
 'entity_from_deps': 'トリガーの主体（右クリックしたプレイヤー等）。エンティティ操作ブロックの entity スロットの既定値。',
 'source_entity_from_deps': 'ダメージ系トリガーの攻撃者（射手など）を取得。',
 'immediate_source_entity_from_deps': '直接の加害エンティティ（矢そのもの等）を取得。',
 'entity_iterator': '「範囲内の全エンティティに対して繰り返す」系ブロックの内側で現在の対象を参照。',
 'entity_none': 'エンティティ引数を省略したい場合のnull指定。',
 'mcitem_all': '「手に持っているアイテム = ダイヤ剣」の比較対象などアイテム指定全般。',
 'mcitem_allblocks': '「座標のブロック = 草ブロック」の比較やブロック設置の指定。',
 'spawn_entity': 'ボス出現ギミック: 特定ブロックを右クリックした座標にカスタムMobを出現させる。',
 'call_procedure': '共通処理（例: 爆発エフェクト一式）を別プロシージャ化して呼び出す。引数付き呼び出しも可能。',
 'java_code': 'ブロックで表現できない処理をJavaコード1行で挿入。上級者向け。',
 'java_code_get': 'Java式の評価結果を値として利用。上級者向け。',
 'cancel_event': '「爆発によるブロック破壊をキャンセル」などバニラ挙動の抑止。対応トリガーのみ有効。',
 'set_event_result': 'イベントの結果を ALLOW/DENY/DEFAULT に上書きする。',
 'debug_marker': 'コンソールにマーカーログを出す。プロシージャがどこまで実行されたかの確認用。',
 'event_trigger': '全プロシージャの起点。「グローバルトリガー」（例: プレイヤーがログインしたとき）をドロップダウンで選択。',
}

# ---------- heuristics ----------
def usecase(b):
    if b['id'] in USE:
        return USE[b['id']]
    cid = b['category'] or ''
    val = b['shape'] == 'value'
    idl = b['id']
    if cid in ('blockdata','entitydata','itemdata','playerdata','worlddata'):
        subj = {'blockdata':'対象ブロック','entitydata':'対象エンティティ','itemdata':'対象アイテム',
                'playerdata':'対象プレイヤー','worlddata':'ワールド'}[cid]
        if val:
            return f'{subj}の状態を取得し、if の条件・計算式・表示メッセージの材料として使う。'
        return f'{subj}の状態を書き換える。'
    if cid in ('blockactions','entitymanagement','itemmanagement','playermanagement','worldmanagement'):
        subj = {'blockactions':'指定座標のブロック','entitymanagement':'指定エンティティ',
                'itemmanagement':'アイテム','playermanagement':'プレイヤー','worldmanagement':'ワールド'}[cid]
        if val:
            return f'{subj}に作用しつつ結果値を返す。'
        return f'トリガーやif分岐の後に置き、{subj}へ効果を適用する。'
    if cid == 'energyandfluid':
        return 'エネルギー(FE)・流体タンクを持つブロック/アイテムの残量確認や入出力に使う。'
    if cid == 'guimanagement':
        return 'カスタムGUIのスロット操作・画面表示制御に使う。'
    if cid == 'projectilemanagement':
        return '矢・カスタム弾などの発射体の発射/操作に使う。'
    if cid == 'scoreboard':
        return 'スコアボード目標の作成・スコア加算などバニラのスコア機構との連携に使う。'
    if cid == 'damagesources':
        return 'ダメージ処理ブロックの damagesource スロットに differentiator として渡す。'
    if cid == 'directionactions':
        return '方向(Direction)値の生成・変換・比較に使う。'
    if cid == 'commands':
        return 'コマンド実行や /execute 相当の文脈指定に使う。'
    if cid == 'time':
        return '現実時刻を取得し、シーズンイベント等の条件に使う。'
    if cid == 'text':
        return '文字列の加工・判定に使う。'
    if cid == 'math':
        return '数値計算に使う。'
    if val:
        return '取得値を他ブロックの入力スロットへ差し込んで使う。'
    return 'ステートメント列に連結して使う。'

SHAPE_JA = {
 'value': '値ブロック：横長・角丸。左端に六角形/パズル型の差し込みコネクタがあり、他ブロックの入力スロットにはめ込む。上下の接続はない。',
 'statement': 'ステートメントブロック：長方形。上辺に凹ノッチ・下辺に凸ノッチがあり、上下に積み重ねて実行順を作る。',
 'hat': 'ハットブロック：上辺が丸い帽子型。プロシージャの開始点で、下方向にのみ接続する。',
 'other': 'コンテナ/特殊ブロック。',
}

def visual(b):
    parts = []
    hexc = b.get('colour_hex')
    hue = b.get('colour_hue')
    cname = b.get('colour_name_ja')
    if hexc:
        h = f'色: {hexc}'
        if cname:
            h += f'（{cname}系'
            if isinstance(hue, (int, float)):
                h += f'・色相{int(hue)}°'
            h += '）'
        parts.append(h)
    parts.append(SHAPE_JA.get(b['shape'], ''))
    if b['shape'] == 'value' and b.get('output_type'):
        parts.append(f"出力型: {b['output_type']}（{b.get('output_type_ja') or b['output_type']}）のスロットにのみ接続可能")
    if b.get('side') == 'server':
        parts.append('右端に紫の縦帯「サーバー側実行」アイコン')
    if b.get('side') == 'client':
        parts.append('右端に青の縦帯「クライアント側実行」アイコン')
    if b.get('statement_inputs'):
        parts.append('C字型（コの字型）に口を開けた内部スロットを持ち、中に別のステートメント列を格納する')
    return ' / '.join(p for p in parts if p)

def fmt_inputs(b):
    rows = []
    for vi in b['value_inputs']:
        chk = vi.get('check')
        if isinstance(chk, list):
            chk = ' or '.join(chk)
        rows.append(f"`{vi['name']}` ← {chk or '任意型'}")
    for si in b['statement_inputs']:
        rows.append(f"`{si}` ← ステートメント列")
    for f in b['fields']:
        t = f['type']
        if t == 'field_dropdown':
            opts = f.get('options') or []
            s = '/'.join(str(o) for o in opts[:8]) + ('…' if len(opts) > 8 else '')
            rows.append(f"`{f.get('name')}`: ドロップダウン({s})")
        elif t in ('field_data_list_selector', 'field_data_list_dropdown'):
            rows.append(f"`{f.get('name')}`: セレクタ[{f.get('datalist')}]")
        elif t == 'field_input':
            rows.append(f"`{f.get('name')}`: テキスト入力欄")
        elif t == 'field_number':
            rows.append(f"`{f.get('name')}`: 数値入力欄")
        elif t == 'field_checkbox':
            rows.append(f"`{f.get('name')}`: チェックボックス")
        else:
            rows.append(f"`{f.get('name')}`: {t}")
    return rows

# ---------- grouping ----------
GROUPS = [
 ('10-components',  'マインクラフト コンポーネント', ['mcelements']),
 ('12-flow-control','フロー制御', ['logicloops']),
 ('13-logic',       '論理', ['logicoperations']),
 ('14-math',        '数学', ['math']),
 ('15-text',        'テキスト', ['text']),
 ('16-time',        '日付と時刻', ['time']),
 ('20-block',       'ブロックプロシージャ', ['blockactions','blockdata','blockprocedures']),
 ('21-entity',      'エンティティプロシージャ', ['entitymanagement','entitydata']),
 ('22-item',        'アイテムプロシージャ', ['itemmanagement','itemdata']),
 ('23-player',      'プレイヤープロシージャ', ['playermanagement','playerdata']),
 ('24-world',       'ワールドプロシージャ', ['worldmanagement','worlddata']),
 ('25-damage',      'ダメージプロシージャ', ['damagesources']),
 ('26-direction',   '方向プロシージャ', ['directionactions']),
 ('27-energy-fluid','エネルギー & 流体', ['energyandfluid']),
 ('28-gui',         'スロット & GUI', ['guimanagement']),
 ('29-projectile',  '飛び道具プロシージャ', ['projectilemanagement']),
 ('30-scoreboard',  'スコアボード', ['scoreboard']),
 ('31-command',     'コマンドパラメーター', ['commands']),
 ('32-advanced',    '高度', ['advanced']),
 ('33-special',     '特殊/内部', ['special']),
]

def render_block(b):
    L = []
    name = b.get('label_ja') or b.get('label_en') or b['id']
    L.append(f"### `{b['id']}`")
    L.append('')
    L.append(f"- **表示名(日本語ラベル)**: {b.get('label_ja') or '—'}")
    L.append(f"- **英語ラベル**: {b.get('label_en') or '—'}")
    if b.get('label_rendered') and b['label_rendered'] != b.get('label_ja'):
        L.append(f"- **ブロック面の構成**: {b['label_rendered']}")
    L.append(f"- **視覚的特徴**: {visual(b)}")
    ios = fmt_inputs(b)
    if ios:
        L.append('- **入力/フィールド**: ' + ' ／ '.join(ios))
    if b.get('output_type'):
        ot = b['output_type']
        L.append(f"- **出力**: {ot}（{b.get('output_type_ja') or ot}）")
    if b.get('dependencies'):
        L.append('- **依存関係(実行文脈に必要な値)**: ' + ', '.join(f'`{d}`' for d in b['dependencies']))
    tip = b.get('tooltip_ja') or b.get('tooltip_en')
    if tip:
        L.append(f"- **補足(ツールチップ)**: {tip}")
    L.append(f"- **ユースケース**: {usecase(b)}")
    L.append('')
    return '\n'.join(L)

index_lines = []
total = 0
for fname, title, cids in GROUPS:
    members = [b for b in blocks.values() if b['category'] in cids]
    members.sort(key=lambda x: (x['shape'] != 'statement', x['id']))
    if not members:
        continue
    total += len(members)
    c0 = cats.get(cids[0], {})
    hexc = c0.get('colour_hex')
    lines = [f"# {title}", '']
    lines.append(f"カテゴリ色: {hexc or '—'}（色相 {c0.get('colour_hue')}） / ブロック数: {len(members)}")
    lines.append('')
    if len(cids) > 1:
        for cid in cids:
            sub = [b for b in members if b['category'] == cid]
            if not sub:
                continue
            cj = cats.get(cid, {})
            lines.append(f"## サブカテゴリ: {cj.get('name_ja') or cid} ({cid})")
            lines.append('')
            for b in sub:
                lines.append(render_block(b))
    else:
        for b in members:
            lines.append(render_block(b))
    with open(os.path.join(OUT, fname + '.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    index_lines.append(f"- [{title}]({fname}.md) — {len(members)}ブロック（色 {hexc}）")

# full JSON dump (with use cases and visual descriptions embedded)
for b in blocks.values():
    b['visual_description_ja'] = visual(b)
    b['use_case_ja'] = usecase(b)
with open(os.path.join(OUT, 'blocks_full.json'), 'w', encoding='utf-8') as f:
    json.dump({'mcreator_version': data['mcreator_version'],
               'categories': cats, 'blocks': blocks}, f, ensure_ascii=False, indent=1)

print('rendered', total, 'blocks into', OUT)
print('\n'.join(index_lines))
