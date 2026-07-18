# -*- coding: utf-8 -*-
"""Generate blocks_render.json: Blockly-loadable definitions for all MCreator
procedure blocks, with Japanese (fallback English) labels."""
import json, os, re, ast, sys

BASE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.join(BASE, 'core')
PROC = os.path.join(CORE, 'procedures')
LANG = os.path.join(BASE, 'loc', 'lang')

def load_props(path):
    d = {}
    for line in open(path, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        d[k.strip()] = v.replace('\\:', ':').replace('\\=', '=').replace('&amp;', '&')
    return d

EN = load_props(os.path.join(LANG, 'texts.properties'))
JA = load_props(os.path.join(LANG, 'texts_ja_JP.properties'))

def label_for(name):
    """Localized single-line label, joining .lineN keys if present."""
    for loc in (JA, EN):
        parts = []
        if ('blockly.block.' + name) in loc:
            parts.append(loc['blockly.block.' + name])
        k = 0
        while True:
            k += 1
            key = 'blockly.block.%s.line%d' % (name, k)
            if key not in loc:
                break
            parts.append(loc[key])
        if parts:
            return ' '.join(p.strip() for p in parts if p.strip())
    return None

def tooltip_for(name):
    return JA.get('blockly.block.%s.tooltip' % name) or EN.get('blockly.block.%s.tooltip' % name)

def fix_message(msg, nargs):
    """Ensure message references exactly args 1..nargs (Blockly requirement)."""
    if msg is None:
        msg = ''
    refs = set(int(m) for m in re.findall(r'%(\d+)', msg))
    if any(r > nargs or r < 1 for r in refs):
        # broken reference -> fall back to auto layout
        return ' '.join('%%%d' % i for i in range(1, nargs + 1))
    missing = [i for i in range(1, nargs + 1) if i not in refs]
    for i in missing:
        msg += ' %%%d' % i
    return msg.strip() if nargs else msg

def collect_args(j):
    args, i = [], 0
    out = []
    while ('args%d' % i) in j or ('message%d' % i) in j:
        out.extend(j.get('args%d' % i, []))
        i += 1
    return out

DATA_EXT = {'entity_data_logic_list_provider': 'Boolean',
            'entity_data_integer_list_provider': 'Integer',
            'entity_data_string_list_provider': 'String'}

defs = []
sources = {}

# ---------- 1. JSON block files ----------
for fn in sorted(os.listdir(PROC)):
    if fn.startswith('$') or not fn.endswith('.json'):
        continue
    name = fn[:-5]
    j = json.load(open(os.path.join(PROC, fn), encoding='utf-8'))
    d = {'type': name}
    args = collect_args(j)
    # entity_data_* extension injects an "accessor" dropdown into the dummy input
    exts = j.get('extensions', [])
    if any(e in DATA_EXT for e in exts):
        args = [({'type': 'field_data_list_selector', 'name': 'accessor',
                  'datalist': 'entityDataParam'} if a.get('type') == 'input_dummy'
                 and a.get('name') == 'accessorField' else a) for a in args]
    # rewrite image paths
    for a in args:
        if a.get('type') == 'field_image' and isinstance(a.get('src'), str):
            a['src'] = a['src'].replace('./res/', 'res/')
    d['message0'] = fix_message(label_for(name), len(args))
    if args:
        d['args0'] = args
    for k in ('output', 'colour', 'inputsInline'):
        if k in j:
            d[k] = j[k]
    if 'previousStatement' in j:
        d['previousStatement'] = j['previousStatement']
    if 'nextStatement' in j:
        d['nextStatement'] = j['nextStatement']
    tip = tooltip_for(name)
    if tip:
        d['tooltip'] = tip
    defs.append(d)
    sources[name] = 'json'

# ---------- 2. defineBlocksWithJsonArray in mcreator_blocks.js ----------
js = open(os.path.join(CORE, 'blockly', 'js', 'mcreator_blocks.js'), encoding='utf-8').read()
m = re.search(r'Blockly\.defineBlocksWithJsonArray\((\[.*?\])\);', js, re.S)
arr = ast.literal_eval(re.sub(r'\bnull\b', 'None', re.sub(r'\btrue\b', 'True',
      re.sub(r'\bfalse\b', 'False', m.group(1)))))
for j in arr:
    name = j.get('type')
    j2 = {k: v for k, v in j.items() if k not in ('helpUrl', 'extensions', 'suppressPrefixSuffix')}
    # localized label wins over inline message when available and args counts allow
    loc = label_for(name)
    nargs = len(j.get('args0', []))
    if loc:
        j2['message0'] = fix_message(loc, nargs)
    tip = tooltip_for(name)
    if tip:
        j2['tooltip'] = tip
    # python None back to JSON null handled by dump
    defs.append(j2)
    sources[name] = 'js-json'

# ---------- 3. imperative Blockly.Blocks['x'] definitions ----------
FIELD_PATTERNS = [
    (re.compile(r'appendField\(javabridge\.t\("([^"]+)"\)\)'), 'label_key'),
    (re.compile(r'appendField\(new Blockly\.FieldLabel\(javabridge\.t\("([^"]+)"\)[^)]*\)\)'), 'label_key'),
    (re.compile(r"appendField\(new FieldDataListSelector\('([^']+)'\),\s*'([^']+)'\)"), 'datalist'),
    (re.compile(r'appendField\(new FieldMCItemSelector\("([^"]+)"\),\s*"([^"]+)"\)'), 'mcitem'),
    (re.compile(r'appendField\(new Blockly\.FieldImage\("([^"]+)",\s*(\d+),\s*(\d+)[^)]*\)\)'), 'image'),
    (re.compile(r"appendField\(new Blockly\.FieldDropdown\((\[.*?\])\),\s*'([^']+)'\)", re.S), 'dropdown'),
    (re.compile(r"appendField\(new Blockly\.FieldMultilineInput\(\"([^\"]*)\"\),\s*'([^']+)'\)"), 'multiline'),
    (re.compile(r"appendField\(new Blockly\.FieldTextInput\(\"([^\"]*)\"\),\s*'([^']+)'\)"), 'textinput'),
]

def parse_imperative(name, body):
    d = {'type': name}
    args, msg_parts = [], []
    inline = bool(re.search(r'setInputsInline\(true\)', body))
    statements = [s.strip() for s in body.split(';') if s.strip()]
    for st in statements:
        im = re.search(r"append(Dummy|Value|Statement)Input\((?:'([\w]+)'|\"([\w]+)\")?\)", st)
        if im:
            kind = im.group(1)
            iname = im.group(2) or im.group(3)
            # fields inside this chain, in order of appearance
            events = []
            for pat, tag in FIELD_PATTERNS:
                for fm in pat.finditer(st):
                    events.append((fm.start(), tag, fm))
            for _, tag, fm in sorted(events):
                if tag == 'label_key':
                    txt = None
                    for loc in (JA, EN):
                        if fm.group(1) in loc:
                            txt = loc[fm.group(1)]
                            break
                    msg_parts.append(txt or fm.group(1))
                elif tag == 'datalist':
                    args.append({'type': 'field_data_list_selector', 'name': fm.group(2),
                                 'datalist': fm.group(1)})
                    msg_parts.append('%%%d' % len(args))
                elif tag == 'mcitem':
                    args.append({'type': 'field_mcitem_selector', 'name': fm.group(2),
                                 'datalist': fm.group(1)})
                    msg_parts.append('%%%d' % len(args))
                elif tag == 'image':
                    args.append({'type': 'field_image', 'src': fm.group(1).replace('./res/', 'res/'),
                                 'width': int(fm.group(2)), 'height': int(fm.group(3))})
                    msg_parts.append('%%%d' % len(args))
                elif tag == 'dropdown':
                    opts = ast.literal_eval(re.sub(r'\bnull\b', 'None', fm.group(1)))
                    args.append({'type': 'field_dropdown', 'name': fm.group(2), 'options': opts})
                    msg_parts.append('%%%d' % len(args))
                elif tag == 'multiline':
                    args.append({'type': 'field_multilinetext', 'name': fm.group(2), 'text': fm.group(1)})
                    msg_parts.append('%%%d' % len(args))
                elif tag == 'textinput':
                    args.append({'type': 'field_input', 'name': fm.group(2), 'text': fm.group(1)})
                    msg_parts.append('%%%d' % len(args))
            if kind == 'Value':
                a = {'type': 'input_value', 'name': iname}
                cm = re.search(r"setCheck\((\[[^\]]*\]|'[\w]+'|\"[\w]+\")\)", st)
                if cm:
                    chk = cm.group(1)
                    a['check'] = ast.literal_eval(chk) if chk.startswith('[') else chk.strip('\'"')
                args.append(a)
                msg_parts.append('%%%d' % len(args))
            elif kind == 'Statement':
                args.append({'type': 'input_statement', 'name': iname})
                msg_parts.append('%%%d' % len(args))
            elif kind == 'Dummy' and not inline:
                args.append({'type': 'input_dummy'})
                msg_parts.append('%%%d' % len(args))
    om = re.search(r"setOutput\(true(?:,\s*(\[[^\]]*\]|'[\w]+'|\"[\w]+\"))?\)", body)
    if om:
        chk = om.group(1)
        d['output'] = (ast.literal_eval(chk) if chk and chk.startswith('[')
                       else (chk.strip('\'"') if chk else None))
    if re.search(r'setPreviousStatement\(true', body):
        d['previousStatement'] = None
    if re.search(r'setNextStatement\(true', body):
        d['nextStatement'] = None
    cm = re.search(r'setColour\(([^)]+)\)', body)
    if cm:
        c = cm.group(1).strip().strip('\'"')
        d['colour'] = int(c) if c.isdigit() else c
    tm = re.search(r'setTooltip\(javabridge\.t\("([^"]+)"\)\)', body)
    if tm:
        d['tooltip'] = JA.get(tm.group(1)) or EN.get(tm.group(1)) or ''
    if re.search(r"setStyle\('hat_blocks'\)", body):
        d['hat'] = 'cap'
    d['message0'] = ' '.join(msg_parts)
    if args:
        d['args0'] = args
    if inline:
        d['inputsInline'] = True
    return d

skipped = []
for bm in re.finditer(r"Blockly\.Blocks\['([\w]+)'\]\s*=\s*\{\s*init:\s*function\s*\(\)\s*\{(.*?)\n\};", js, re.S):
    name, body = bm.group(1), bm.group(2)
    if name in sources:
        continue
    if name in ('aitasks_container', 'feature_container', 'args_start', 'advancement_trigger', 'old_command'):
        skipped.append(name)  # not procedure-editor blocks
        continue
    d = parse_imperative(name, body)
    defs.append(d)
    sources[name] = 'js-imperative'

# helper-registered simple mutator containers are not needed for rendering

out = {
    'mcreator_version': '2025.1',
    'note': 'Blockly block definitions generated from MCreator core plugin data with Japanese labels.',
    'builtin_blocks': ['controls_if', 'controls_repeat_ext', 'logic_negate', 'logic_boolean',
                       'math_number', 'text', 'text_join', 'text_length', 'text_print'],
    'custom_field_types': ['field_data_list_selector', 'field_data_list_dropdown',
                           'field_mcitem_selector', 'field_javaname', 'field_ai_condition_selector',
                           'field_resourcelocation', 'field_multilinetext'],
    'definitions': defs,
}
dst = os.path.join(BASE, 'blocks_render.json')
json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('definitions:', len(defs), '| skipped:', skipped)
from collections import Counter
print(Counter(sources.values()))
# sanity: every message references args correctly
bad = []
for d in defs:
    n = len(d.get('args0', []))
    refs = set(int(x) for x in re.findall(r'%(\d+)', d.get('message0', '')))
    if refs != set(range(1, n + 1)):
        bad.append((d['type'], n, sorted(refs)))
print('arg mismatch:', bad[:10], 'count', len(bad))
