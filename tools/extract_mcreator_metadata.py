# -*- coding: utf-8 -*-
"""Extracts public/reference/variable_types.json, triggers.json and
iterator_providers.json from MCreator 2025.1's own plugin data.

These three files supplement blocks_full.json/blocks_render.json (which only
cover the 516 *static* procedure blocks) with data for features that MCreator
generates dynamically and therefore never appear in that static catalog:
custom variable get/set blocks, the global trigger catalog (with the
dependencies each trigger provides), and which statement inputs scope which
"*_iterator" value blocks.

Source of truth (read-only, never modified by this script):
  <MCreator.app>/Contents/plugins/mcreator-core.zip
    -> variables/*.json          (9 variable types: color + Blockly type)
    -> triggers/*.json           (63 global triggers: dependencies_provided,
                                   cancelable, side)
    -> procedures/*.json         (block defs; the "mcreator.statements[].
                                   provides" key is the iterator-provider
                                   link, e.g. world_entity_inrange_foreach's
                                   "foreach" statement provides
                                   entityiterator:entity)
  <MCreator.app>/Contents/plugins/mcreator-localization.zip
    -> lang/texts.properties, lang/texts_ja_JP.properties (display strings)

How the variable get/set block shape itself (block_id
"variables_get_<type>"/"variables_set_<type>", single field named "VAR"
holding "<local|global>:<name>", set-value input named "VAL", and the
player-scope "entity" input added via a mutator with
<mutation is_player_var="..." has_entity="...">) was determined: those
blocks are constructed entirely in Java at runtime (grep for
"variables_get_"/"variables_set_" across mcreator-core.zip's JS/JSON returns
nothing), so it isn't extractable as a static file at all. It was reverse
engineered from net.mcreator.blockly.java.blocks.{Get,Set}VariableBlock and
net.mcreator.blockly.java.BlocklyVariables inside
<MCreator.app>/Contents/lib/mcreator.jar (via `javap -v`, reading the
constant-pool string literals and the parsing bytecode: the block-name
regex "variables_(get|set)_" for the type suffix, "field"/"VAR" for
the sole field, "global:"/"local:" for the field's scope prefix, "VAL" for
the set-block's value input, and mcreator_extensions.js's
'variable_entity_input' registerMutator for the player-scope entity input)
and is *not* re-derived by this script — it's encoded directly in
src/blockly/registerBlocks.ts's variable block registration.

Usage:
  1. Have a local MCreator 2025.1 install (or mount the .dmg installer
     read-only and point MCREATOR_APP at the mounted volume's MCreator.app).
  2. python3 tools/extract_mcreator_metadata.py /path/to/MCreator.app
  3. Review the diff under public/reference/ before committing.
"""
import json
import os
import sys
import zipfile
import tempfile


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


def main():
    if len(sys.argv) != 2:
        print('usage: extract_mcreator_metadata.py /path/to/MCreator.app', file=sys.stderr)
        sys.exit(1)
    app_path = sys.argv[1]
    plugins = os.path.join(app_path, 'Contents', 'plugins')
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'reference')

    with tempfile.TemporaryDirectory() as tmp:
        core = os.path.join(tmp, 'core')
        loc = os.path.join(tmp, 'loc')
        with zipfile.ZipFile(os.path.join(plugins, 'mcreator-core.zip')) as z:
            z.extractall(core)
        with zipfile.ZipFile(os.path.join(plugins, 'mcreator-localization.zip')) as z:
            z.extractall(loc)

        en = load_props(os.path.join(loc, 'lang', 'texts.properties'))
        ja = load_props(os.path.join(loc, 'lang', 'texts_ja_JP.properties'))

        # ---------- variable_types.json ----------
        var_type_order = ['number', 'logic', 'string', 'itemstack', 'blockstate',
                           'entity', 'direction', 'damagesource', 'actionresulttype']
        types = []
        for name in var_type_order:
            with open(os.path.join(core, 'variables', name + '.json'), encoding='utf-8') as f:
                j = json.load(f)
            types.append({
                'id': name,
                'blockly_type': j['blocklyVariableType'],
                'colour_hue': j['color'],
                'nullable': j.get('nullable', False),
                'label_en_get': en.get('blockly.block.get_var_' + name) or ('Get ' + name),
                'label_ja_get': ja.get('blockly.block.get_var_' + name) or en.get('blockly.block.get_var_' + name) or ('Get ' + name),
                'label_en_set': en.get('blockly.block.set_var_' + name) or ('Set ' + name),
                'label_ja_set': ja.get('blockly.block.set_var_' + name) or en.get('blockly.block.set_var_' + name) or ('Set ' + name),
            })
        with open(os.path.join(out_dir, 'variable_types.json'), 'w', encoding='utf-8') as f:
            json.dump({
                'mcreator_version': '2025.1',
                'note': ('MCreator 2025.1の変数type定義(core/variables/*.json)+ローカライズ文字列から抽出。'
                         'block_idは "variables_get_<id>"/"variables_set_<id>" で、fields.VAR に変数名を持つ。'),
                'field_name': 'VAR',
                'set_value_input_name': 'VAL',
                'player_scope_entity_input_name': 'entity',
                'types': types,
            }, f, ensure_ascii=False, indent=2)

        # ---------- triggers.json ----------
        triggers_dir = os.path.join(core, 'triggers')
        triggers = []
        for fn in sorted(os.listdir(triggers_dir)):
            if not fn.endswith('.json'):
                continue
            tid = fn[:-5]
            with open(os.path.join(triggers_dir, fn), encoding='utf-8') as f:
                j = json.load(f)
            deps = sorted({d.get('name') for d in j.get('dependencies_provided', []) if d.get('name')})
            triggers.append({
                'id': tid,
                'name_en': en.get('trigger.' + tid),
                'name_ja': ja.get('trigger.' + tid) or en.get('trigger.' + tid),
                'dependencies_provided': deps,
                'cancelable': j.get('cancelable') in ('true', True),
                'side': j.get('side'),
            })
        with open(os.path.join(out_dir, 'triggers.json'), 'w', encoding='utf-8') as f:
            json.dump({
                'mcreator_version': '2025.1',
                'note': ('MCreator 2025.1の実トリガー定義(core/triggers/*.json)+ローカライズ文字列から抽出。'
                         'dependencies_providedは、trigger名がここに一致すればW001の判定に自動的に使われる。'),
                'triggers': triggers,
            }, f, ensure_ascii=False, indent=2)

        # ---------- iterator_providers.json ----------
        proc_dir = os.path.join(core, 'procedures')
        providers = []
        for fn in sorted(os.listdir(proc_dir)):
            if fn.startswith('$') or not fn.endswith('.json'):
                continue
            name = fn[:-5]
            with open(os.path.join(proc_dir, fn), encoding='utf-8') as f:
                j = json.load(f)
            for stmt in j.get('mcreator', {}).get('statements', []):
                for p in (stmt.get('provides') or []):
                    providers.append({
                        'block_id': name,
                        'statement_name': stmt.get('name'),
                        'provides_name': p.get('name'),
                        'provides_type': p.get('type'),
                    })
        with open(os.path.join(out_dir, 'iterator_providers.json'), 'w', encoding='utf-8') as f:
            json.dump({
                'mcreator_version': '2025.1',
                'note': ('MCreator 2025.1のprocedures/*.jsonのmcreator.statements[].providesから抽出。'
                         'あるblock_idのstatement_inputs[statement_name]の内部でのみprovides_nameが有効になる。'
                         '値ブロック"<X>_iterator"はprovides_name"<X>iterator"を要求する(命名は機械的対応)。'),
                'providers': providers,
            }, f, ensure_ascii=False, indent=2)

    print('Wrote variable_types.json, triggers.json, iterator_providers.json to', out_dir)


if __name__ == '__main__':
    main()
