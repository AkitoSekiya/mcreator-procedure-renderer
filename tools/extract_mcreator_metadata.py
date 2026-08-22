# -*- coding: utf-8 -*-
"""Extracts public/reference/variable_types.json, triggers.json,
iterator_providers.json and entity_types.json from MCreator 2025.1's own
plugin data.

These four files supplement blocks_full.json/blocks_render.json (which only
cover the 516 *static* procedure blocks) with data for features that MCreator
generates dynamically and therefore never appear in that static catalog:
custom variable get/set blocks, the global trigger catalog (with the
dependencies each trigger provides), which statement inputs scope which
"*_iterator" value blocks, and the vanilla-entity catalog backing the
`field_data_list_selector` fields named "entity" (datalist "entity" or
"spawnableEntity" — both confirmed, via every one of their 7 real
neoforge-1.21.1/procedures/*.java.ftl templates, to resolve through the exact
same `generator.map(value, "entities", N)` NameMapper table, so they share
one value format).

Requires PyYAML (`pip install pyyaml`) only for the entity_types.json step
(datalists/entities.yaml parsing) — the other three outputs are pure-stdlib
as before.

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

import yaml


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

        # ---------- entity_types.json ----------
        # datalists/entities.yaml: a flat list of one-entry dicts, each
        # {"<key>": null, "readable_name": "...", "type": "spawnable"?}.
        # "<key>" (e.g. "EntityCreeper") is the exact string persisted in a
        # field_data_list_selector field's XML value (confirmed via
        # net.mcreator.generator.mapping.NameMapper's javap-decompiled
        # getMapping()/processMapping(): it does a direct Map.get(value)
        # lookup keyed by this literal string against the generator's own
        # mappings/entities.yaml, whose keys are identical to this datalist's
        # — same cross-check methodology used for mcitem_allblocks/
        # blocksitems.yaml). Entries without "type: spawnable" are abstract
        # Java supertypes (EntityAnimal, EntityAgeable, ...) valid only for
        # logic_entity_compare's "(sub)type" check, not for spawning.
        with open(os.path.join(core, 'datalists', 'entities.yaml'), encoding='utf-8') as f:
            raw_entries = yaml.safe_load(f)
        entities = []
        for entry in raw_entries:
            key = next(k for k in entry if k != 'readable_name' and k != 'type')
            entities.append({
                'key': key,
                'readable_name_en': entry.get('readable_name'),
                'spawnable': entry.get('type') == 'spawnable',
            })
        entities.sort(key=lambda e: e['key'])
        with open(os.path.join(out_dir, 'entity_types.json'), 'w', encoding='utf-8') as f:
            json.dump({
                'mcreator_version': '2025.1',
                'note': ('MCreator 2025.1のdatalists/entities.yaml（core/datalists/entities.yaml）から抽出。'
                         'field_data_list_selector（datalist "entity" または "spawnableEntity"、'
                         'field名は常に "entity"）の値は、この一覧の "key" をそのまま文字列で指定する'
                         '（例: Creeperなら "EntityCreeper"）。spawnable=falseの項目'
                         '（EntityAnimal等の抽象スーパータイプ）は logic_entity_compare の'
                         '"(サブ)タイプ判定" にのみ使え、spawn_entity等では使えない。'
                         'カスタム（MOD定義）エンティティは "CUSTOM:<MOD要素名>" 形式で指定する'
                         '（net.mcreator.generator.GeneratorWrapper.getElementPlainName + '
                         'MappableElement.validateReference で確認、mcitem_allblocksと同じ仕組み）。'),
                'field_name': 'entity',
                'datalists': ['entity', 'spawnableEntity'],
                'custom_prefix': 'CUSTOM:',
                'external_prefix': 'EXTERNAL:',
                'entities': entities,
            }, f, ensure_ascii=False, indent=2)

    print('Wrote variable_types.json, triggers.json, iterator_providers.json, entity_types.json to', out_dir)


if __name__ == '__main__':
    main()
