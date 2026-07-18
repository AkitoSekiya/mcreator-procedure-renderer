# -*- coding: utf-8 -*-
"""Extract all MCreator 2025.1 procedure blocks into structured JSON."""
import json, os, re, colorsys, ast, sys

BASE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.join(BASE, 'core')
PROC = os.path.join(CORE, 'procedures')
LANG = os.path.join(BASE, 'loc', 'lang')

# ---------- localization ----------
def load_props(path):
    d = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            d[k.strip()] = v.replace('\\:', ':').replace('\\=', '=').replace('&amp;', '&')
    return d

EN = load_props(os.path.join(LANG, 'texts.properties'))
JA = load_props(os.path.join(LANG, 'texts_ja_JP.properties'))

# ---------- category colors from $files ----------
cat_meta = {}
for fn in os.listdir(PROC):
    if fn.startswith('$'):
        with open(os.path.join(PROC, fn), encoding='utf-8') as f:
            j = json.load(f)
        cid = fn[1:-5]
        cat_meta[cid] = j

# ---------- helpers ----------
BKY_HUES = {'%{BKY_LOGIC_HUE}': 210, '%{BKY_LOOPS_HUE}': 120, '%{BKY_MATH_HUE}': 230,
            '%{BKY_TEXTS_HUE}': 160, '%{BKY_LISTS_HUE}': 260, '%{BKY_COLOUR_HUE}': 20,
            '%{BKY_VARIABLES_HUE}': 330, '%{BKY_PROCEDURES_HUE}': 290}

def hue_to_hex(h):
    try:
        h = float(h)
    except (TypeError, ValueError):
        return None
    r, g, b = colorsys.hsv_to_rgb((h % 360) / 360.0, 0.45, 0.65)
    return '#%02X%02X%02X' % (round(r*255), round(g*255), round(b*255))

COLOR_NAME_JA = [
    (15, '赤'), (45, 'オレンジ／茶'), (70, 'オリーブ（黄土色）'), (95, '黄緑'),
    (140, '緑'), (170, '青緑（ティール）'), (200, '水色'), (225, '青'),
    (245, '青紫'), (275, '紫'), (315, '赤紫（マゼンタ）'), (345, 'ピンク'), (360, '赤')]

def hue_name(h):
    try:
        h = float(h) % 360
    except (TypeError, ValueError):
        return None
    for limit, name in COLOR_NAME_JA:
        if h <= limit:
            return name
    return '赤'

def resolve_colour(c):
    if isinstance(c, str):
        if c in BKY_HUES:
            return BKY_HUES[c]
        if c.startswith('#'):
            return c
        try:
            return float(c)
        except ValueError:
            return c
    return c

TYPE_JA = {'Number': '数値', 'Boolean': '論理値(true/false)', 'String': 'テキスト',
           'Entity': 'エンティティ', 'MCItem': 'アイテム/ブロック', 'MCItemBlock': 'ブロック',
           'ItemStack': 'アイテムスタック', 'BlockState': 'ブロックステート',
           'Direction': '方向', 'DamageSource': 'ダメージソース', 'Dimension': 'ディメンション',
           'ActionResultType': 'アクション結果', 'AttributeModifierOperation': '属性修飾子の演算',
           'Pair': 'ペア'}

def t_block(name):
    en = EN.get('blockly.block.' + name)
    ja = JA.get('blockly.block.' + name)
    return en, ja

def field_placeholder(a, lang='ja'):
    ty = a.get('type')
    if ty == 'input_value':
        chk = a.get('check')
        if isinstance(chk, list):
            chk = '/'.join(chk)
        return '⬡%s:%s' % (a.get('name', ''), chk or 'any')
    if ty == 'input_statement':
        return '⊏do:%s⊐' % a.get('name', '')
    if ty == 'field_dropdown':
        opts = a.get('options', [])
        labels = []
        for o in opts[:6]:
            labels.append(o[0] if isinstance(o, list) else str(o))
        s = '▼[' + '|'.join(labels)
        if len(opts) > 6:
            s += '|…'
        return s + ']'
    if ty in ('field_data_list_selector', 'field_data_list_dropdown'):
        return '▼<%s選択>' % a.get('datalist', '')
    if ty == 'field_input':
        return '[テキスト入力]'
    if ty == 'field_number':
        return '[数値:%s]' % a.get('value', 0)
    if ty == 'field_checkbox':
        return '[✓]'
    if ty == 'field_image':
        src = a.get('src', '')
        if 'server' in src:
            return '«サーバー側アイコン»'
        if 'client' in src:
            return '«クライアント側アイコン»'
        return '«画像»'
    if ty == 'field_mcitem_selector':
        return '[アイテム選択UI]'
    if ty == 'field_javaname':
        return '[名前入力]'
    if ty == 'field_resourcelocation':
        return '[リソースID入力]'
    if ty == 'field_ai_condition_selector':
        return '[AI条件選択]'
    return '[%s]' % ty

def build_label(msg, args):
    if not msg:
        return None
    def rep(m):
        i = int(m.group(1)) - 1
        if 0 <= i < len(args):
            return field_placeholder(args[i])
        return m.group(0)
    return re.sub(r'%(\d+)', rep, msg).strip()

def side_from_args(all_args):
    for a in all_args:
        if a.get('type') == 'field_image':
            src = a.get('src', '')
            if 'server' in src:
                return 'server'
            if 'client' in src:
                return 'client'
    return None

def shape_of(j):
    if j.get('output') is not None or 'output' in j:
        out = j.get('output')
        if isinstance(out, list):
            out = '/'.join(out)
        return 'value', out
    if j.get('previousStatement', 'x') is None or j.get('nextStatement', 'x') is None or \
       'previousStatement' in j or 'nextStatement' in j:
        return 'statement', None
    return 'other', None

def collect_args(j):
    args = []
    i = 0
    while ('args%d' % i) in j or ('message%d' % i) in j:
        args.extend(j.get('args%d' % i, []))
        i += 1
    return args

def make_block(name, j, source):
    args = collect_args(j)
    en, ja = t_block(name)
    # JS-defined blocks carry message0 inline
    if not en and j.get('message0') and not j.get('message0', '').startswith('%'):
        en = ' '.join(j.get('message%d' % k, '') for k in range(0, 5)).strip() or None
    msg_parts = []
    if en:
        msg_parts.append(en)
    k = 0
    # multi-line localization (name.line1 ...)
    while True:
        k += 1
        e = EN.get('blockly.block.%s.line%d' % (name, k))
        if not e:
            break
        msg_parts.append(e)
    en_full = ' '.join(msg_parts) if msg_parts else (j.get('message0') or None)
    ja_full = ja
    jparts = []
    k = 0
    while True:
        k += 1
        x = JA.get('blockly.block.%s.line%d' % (name, k))
        if not x:
            break
        jparts.append(x)
    if jparts:
        ja_full = ' '.join(jparts)
    shape, out = shape_of(j)
    mc = j.get('mcreator', {})
    colour = resolve_colour(j.get('colour'))
    cat = mc.get('toolbox_id')
    deps = [d['name'] + ':' + d['type'] for d in mc.get('dependencies', [])]
    tip_en = EN.get('blockly.block.%s.tooltip' % name)
    tip_ja = JA.get('blockly.block.%s.tooltip' % name)
    inputs = [a for a in args if a.get('type') == 'input_value']
    stmts = [a for a in args if a.get('type') == 'input_statement']
    fields = [a for a in args if a.get('type', '').startswith('field_') and a.get('type') != 'field_image']
    return {
        'id': name,
        'source': source,
        'category': cat,
        'colour_hue': colour,
        'colour_hex': colour if isinstance(colour, str) and str(colour).startswith('#') else hue_to_hex(colour),
        'colour_name_ja': hue_name(colour) if not (isinstance(colour, str) and str(colour).startswith('#')) else None,
        'shape': shape,
        'output_type': out,
        'output_type_ja': TYPE_JA.get(out, out) if out else None,
        'has_prev_next': shape == 'statement',
        'inputs_inline': j.get('inputsInline', False),
        'label_en': en_full,
        'label_ja': ja_full,
        'label_rendered': build_label(ja_full or en_full, args),
        'tooltip_en': tip_en, 'tooltip_ja': tip_ja,
        'side': side_from_args(args),
        'value_inputs': [{'name': a.get('name'), 'check': a.get('check')} for a in inputs],
        'statement_inputs': [a.get('name') for a in stmts],
        'fields': [{'name': a.get('name'), 'type': a.get('type'),
                    'datalist': a.get('datalist'),
                    'options': [o[0] if isinstance(o, list) else o for o in a.get('options', [])] or None}
                   for a in fields],
        'dependencies': deps,
        'required_apis': mc.get('required_apis'),
    }

blocks = {}

# ---------- 1. JSON-defined blocks ----------
for fn in sorted(os.listdir(PROC)):
    if fn.startswith('$') or not fn.endswith('.json'):
        continue
    name = fn[:-5]
    with open(os.path.join(PROC, fn), encoding='utf-8') as f:
        j = json.load(f)
    blocks[name] = make_block(name, j, 'json')

# ---------- 2. JS jsonArray blocks ----------
jspath = os.path.join(CORE, 'blockly', 'js', 'mcreator_blocks.js')
js = open(jspath, encoding='utf-8').read()
m = re.search(r'Blockly\.defineBlocksWithJsonArray\((\[.*?\])\);', js, re.S)
if m:
    arr_src = m.group(1)
    py_src = re.sub(r'\bnull\b', 'None', arr_src)
    py_src = re.sub(r'\btrue\b', 'True', py_src)
    py_src = re.sub(r'\bfalse\b', 'False', py_src)
    arr = ast.literal_eval(py_src)
    for j in arr:
        name = j.get('type')
        if name:
            blocks[name] = make_block(name, j, 'js-json')

# ---------- 3. JS imperative blocks ----------
for bm in re.finditer(r"Blockly\.Blocks\['([\w]+)'\]\s*=\s*\{\s*init:\s*function\s*\(\)\s*\{(.*?)\n\};", js, re.S):
    name, body = bm.group(1), bm.group(2)
    if name in blocks:
        continue
    j = {}
    cm = re.search(r"setColour\(([^)]+)\)", body)
    if cm:
        c = cm.group(1).strip().strip("'\"")
        j['colour'] = c
    om = re.search(r"setOutput\(true,\s*['\"]([\w]+)['\"]\)", body)
    if om:
        j['output'] = om.group(1)
    elif re.search(r"setOutput\(true", body):
        j['output'] = 'any'
    if re.search(r"setPreviousStatement\(true", body):
        j['previousStatement'] = None
    if re.search(r"setNextStatement\(true", body):
        j['nextStatement'] = None
    if re.search(r"setStyle\('hat_blocks'\)", body):
        j['hat'] = True
    # value inputs
    args = []
    for vm in re.finditer(r"appendValueInput\(['\"]([\w]+)['\"]\)(?:\s*\.setCheck\(['\"]?([\w]+)['\"]?\))?", body):
        args.append({'type': 'input_value', 'name': vm.group(1), 'check': vm.group(2)})
    for sm in re.finditer(r"appendStatementInput\(['\"]([\w]+)['\"]\)", body):
        args.append({'type': 'input_statement', 'name': sm.group(1)})
    for dm in re.finditer(r"new FieldDataListSelector\('([\w]+)'\)", body):
        args.append({'type': 'field_data_list_selector', 'datalist': dm.group(1), 'name': ''})
    if args:
        j['args0'] = args
        j['message0'] = ' '.join('%%%d' % (i+1) for i in range(len(args)))
    b = make_block(name, j, 'js-imperative')
    if j.get('hat'):
        b['shape'] = 'hat'
    blocks[name] = b

print('total blocks:', len(blocks))
by_src = {}
for b in blocks.values():
    by_src[b['source']] = by_src.get(b['source'], 0) + 1
print(by_src)
missing_ja = [b['id'] for b in blocks.values() if not b['label_ja'] and not b['label_en']]
print('no label:', len(missing_ja), missing_ja[:20])

out = {
    'mcreator_version': '2025.1',
    'categories': {},
    'blocks': blocks,
}
for cid, meta in cat_meta.items():
    out['categories'][cid] = {
        'id': cid,
        'name_en': EN.get('blockly.category.' + cid),
        'name_ja': JA.get('blockly.category.' + cid),
        'colour_hue': meta.get('color'),
        'colour_hex': hue_to_hex(meta.get('color')),
        'colour_name_ja': hue_name(meta.get('color')),
        'parent': meta.get('parent_category'),
        'api': meta.get('api'),
    }

with open(os.path.join(BASE, 'blocks.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print('written blocks.json')
