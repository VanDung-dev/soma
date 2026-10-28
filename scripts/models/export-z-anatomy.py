"""Run with Blender's bundled Python; the source .blend is never saved."""
import bpy
import addon_utils
import csv
import hashlib
import io
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = root / 'Z-Anatomy' / 'Startup.blend'
assert Path(bpy.data.filepath).resolve() == source.resolve()
assert bpy.context.scene.unit_settings.system == 'METRIC'
assert bpy.context.scene.unit_settings.scale_length == 1
output = root / '.cache' / 'z-anatomy' / 'export'
output.mkdir(parents=True, exist_ok=True)
selection_bytes = (root / 'content/z-anatomy-selections.json').read_bytes()
selections = json.loads(selection_bytes)
INLINE_LIMIT = 500
PACK = 8

def inline(value):
    return json.dumps(value, ensure_ascii=False, separators=(', ', ': '))

def wrapped(values, indent):
    lines = []
    for index in range(0, len(values), PACK):
        chunk = values[index:index + PACK]
        lines.append(' ' * indent + ', '.join(inline(value) for value in chunk) + (',' if index + PACK < len(values) else ''))
    return lines

def format_target(target):
    single = inline(target)
    if len(single) <= INLINE_LIMIT:
        return ['    ' + single]
    lines = ['    {']
    items = list(target.items())
    for index, (key, value) in enumerate(items):
        comma = ',' if index < len(items) - 1 else ''
        if key == 'structure_ids' and isinstance(value, list) and len(inline(value)) > INLINE_LIMIT:
            lines.append('      "structure_ids": [')
            lines.extend(wrapped(value, 8))
            lines.append('      ]' + comma)
        elif key == 'model' and isinstance(value, dict) and len(inline(value)) > INLINE_LIMIT:
            lines.append('      "model": {"path": ' + inline(value['path']) + ', "scope": ' + inline(value['scope']) + ', "structure_ids": [')
            lines.extend(wrapped(value['structure_ids'], 8))
            lines.append('      ]}' + comma)
        else:
            lines.append('      ' + inline(key) + ': ' + inline(value) + comma)
    lines.append('    }')
    return lines

def format_catalog(catalog):
    lines = ['{']
    keys = list(catalog)
    for index, key in enumerate(keys):
        value = catalog[key]
        comma = ',' if index < len(keys) - 1 else ''
        if key == 'groups':
            lines.append('  "groups": [')
            for group_index, group in enumerate(value):
                lines.append('    ' + inline(group) + (',' if group_index < len(value) - 1 else ''))
            lines.append('  ]' + comma)
        elif key == 'targets':
            lines.append('  "targets": [')
            for target_index, target in enumerate(value):
                block = format_target(target)
                block[-1] += ',' if target_index < len(value) - 1 else ''
                lines.extend(block)
            lines.append('  ]' + comma)
        else:
            lines.append('  ' + inline(key) + ': ' + inline(value) + comma)
    lines.append('}')
    return '\n'.join(lines) + '\n'

source_objects = list(bpy.data.objects)
source_collections = dict(bpy.data.collections.items())
translation_text = bpy.data.texts.get('Translations')
translations = {}
for row in csv.DictReader(io.StringIO(translation_text.as_string() if translation_text else ''), delimiter=';'):
    translations[row['English']] = row.get('Latin', '')

def eligible(obj):
    return obj.type in {'MESH', 'CURVE'} and not re.search(r'\.(j|t|g|st)$|-profile', obj.name, re.I) and any(re.match(r'^[1-9]:', c.name) for c in obj.users_collection)

def structure_name(obj):
    object_name = re.sub(r'\.(?:[oi]?[lr]|o|i)$', '', obj.name)
    # These source meshes use generic or reused datablock names.
    if object_name in {'Coccygeus muscle', 'Descending part of trapezius muscle',
                       'Transverse part of trapezius muscle', 'Mucosa of stomach',
                       'Lateral basal segmental bronchus of left lung (BIX)',
                       'Medial basal segmental bronchus of right lung (BVII)'}:
        return object_name
    return re.sub(r'\.(?:[oi]?[lr]|o|i)$', '', obj.data.name)

# Anatomical spelling variants used only for hierarchy matching.
name_aliases = {
    'Cartilages': 'Cartilage',
    'Interlobular sulci': 'Interlobar sulci',
    'Costal cartilage of first rib': 'Costal cartilage of 1st rib',
    'Costal cartilage of second rib': 'Costal cartilage of 2nd rib',
    'Costal cartilage of third rib': 'Costal cartilage of 3rd rib',
    'Costal cartilage of fourth rib': 'Costal cartilage of 4th rib',
    'Costal cartilage of fifth rib': 'Costal cartilage of 5th rib',
    'Costal cartilage of sixth rib': 'Costal cartilage of 6th rib',
    'Costal cartilage of seventh rib': 'Costal cartilage of 7th rib',
    'Costal cartilage of eighth rib': 'Costal cartilage of 8th rib',
    'Costal cartilage of ninth rib': 'Costal cartilage of 9th rib',
    'Costal cartilage of tenth rib': 'Costal cartilage of 10th rib',
    'Fascia': 'Fasciae',
    'Cervical fascia': 'Cervical fasciae',
    'Fascia of abdomen': 'Fasciae of abdomen',
    'Fascia of lower limb': 'Fasciae of lower limb',
    'Cranial syndesmosis': 'Cranial syndesmoses',
    'Bifurcate ligament': 'Bifurcated ligament',
    'Cuboidonavicular joint': 'Cuboideonavicular joint',
    'Rotator cuff muscles': 'Rotator cuff muscle',
    'Commissural fibres of telencephalon': 'Commissural fibers of telencephalon',
    'Neo-cortex': 'Neocortex',
    'Automatic division of peripheral nervous system': 'Autonomic division of peripheral nervous system',
    'Lacrimal canliculus': 'Lacrimal canaliculus',
    'Vestibule': 'Vestibule ',
    'Caecum': 'Cecum',
    'Tracheobronchial tree': 'Traqueobronchial tree',
    'Right pulonary artery': 'Right pulmonary artery',
    'Skin appendages': 'Skin appendage',
    'Tendon sheath of upper limb': 'Tendon sheaths of upper limb',
}

def source_label(name):
    return name.strip().rstrip("'")

def matching_labels(*names):
    labels = {source_label(name) for name in names}
    return labels | {source_label(name_aliases[name]) for name in labels if name in name_aliases}

def principled(tree, visited=None):
    if not tree: return None
    visited = set() if visited is None else visited
    if tree.name in visited: return None
    visited.add(tree.name)
    for node in tree.nodes:
        if node.type == 'BSDF_PRINCIPLED': return node
    for node in tree.nodes:
        if node.type == 'GROUP' and node.node_tree and not any(s in node.node_tree.name.lower() for s in ['crosssection', 'comic']):
            found = principled(node.node_tree, visited)
            if found: return found
    return None

materials = {}
fallback_materials = set()
def material_value(socket, visited=frozenset()):
    if not socket.is_linked:
        value = socket.default_value
        return float(value) if isinstance(value, (int, float)) else tuple(value)
    key = socket.as_pointer()
    if key in visited: return None
    visited = visited | {key}
    link = socket.links[0]
    node = link.from_node
    if node.type == 'RGB': return tuple(link.from_socket.default_value)
    if node.type == 'REROUTE': return material_value(node.inputs[0], visited)
    if node.type == 'GAMMA':
        color = material_value(node.inputs['Color'], visited)
        gamma = material_value(node.inputs['Gamma'], visited)
        if color is not None and gamma is not None:
            return tuple(max(c, 0) ** gamma for c in color[:3]) + (color[3],)
    if node.type == 'MIX' and node.data_type == 'RGBA' and node.blend_type == 'MIX':
        factor = material_value(node.inputs[0], visited)
        first = material_value(node.inputs[6], visited)
        second = material_value(node.inputs[7], visited)
        if factor is not None and first is not None and second is not None:
            if node.clamp_factor: factor = min(1, max(0, factor))
            color = tuple(a * (1-factor) + b * factor for a, b in zip(first, second))
            return tuple(min(1, max(0, c)) for c in color) if node.clamp_result else color
    return None

def material_alpha(bsdf):
    alpha = float(bsdf.inputs['Alpha'].default_value)
    # shortcut: static, directly linked Transparent mixes; bake dynamic/procedural opacity when assets require it.
    for link in bsdf.outputs['BSDF'].links:
        mix = link.to_node
        if mix.type != 'MIX_SHADER' or mix.inputs[0].is_linked or not mix.outputs[0].is_linked:
            continue
        first = link.to_socket == mix.inputs[1]
        other = mix.inputs[2 if first else 1]
        if len(other.links) == 1 and other.links[0].from_node.type == 'BSDF_TRANSPARENT':
            factor = min(1.0, max(0.0, float(mix.inputs[0].default_value)))
            alpha *= 1.0 - factor if first else factor
    return alpha

def web_material(original):
    # shortcut: resolve constant color nodes; bake spatial/object-driven nodes for complete material parity.
    name = original.name if original else 'Missing material'
    if name in materials: return materials[name]
    bsdf = principled(original.node_tree if original else None)
    if bsdf:
        color = material_value(bsdf.inputs['Base Color'])
        if color is None:
            color = tuple(bsdf.inputs['Base Color'].default_value)
            fallback_materials.add(name)
        roughness = float(bsdf.inputs['Roughness'].default_value)
        alpha = material_alpha(bsdf)
    else:
        color = tuple(original.diffuse_color) if original else (0.6, 0.4, 0.3, 1)
        roughness, alpha = 0.65, 1
        fallback_materials.add(name)
    material = bpy.data.materials.new(name + ' · Web PBR')
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = color
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = float(bsdf.inputs['Metallic'].default_value) if bsdf else 0
    shader.inputs['Alpha'].default_value = alpha
    ior = float(bsdf.inputs['IOR'].default_value) if bsdf else 1.5
    specular = float(bsdf.inputs['Specular IOR Level'].default_value) if bsdf else 0.5
    material['source_specular'] = 2 * specular * ((ior - 1) / (ior + 1)) ** 2
    material['source_subsurface'] = float(bsdf.inputs['Subsurface Weight'].default_value) if bsdf else 0
    if alpha < 1: material.surface_render_method = 'DITHERED'
    materials[name] = material
    return material

depsgraph = bpy.context.evaluated_depsgraph_get()
geometry, excluded, repaired = {}, [], []
for obj in source_objects:
    if not eligible(obj): continue
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), preserve_all_data_layers=True, depsgraph=depsgraph)
    before = {'vertices': len(mesh.vertices), 'polygons': len(mesh.polygons)}
    if mesh.validate():
        repaired.append({'object': obj.name, 'before': before, 'after': {'vertices': len(mesh.vertices), 'polygons': len(mesh.polygons)}})
    assert not mesh.validate(), obj.name
    if not mesh.polygons:
        excluded.append({'object': obj.name, 'reason': 'No evaluated surface polygons'})
        bpy.data.meshes.remove(mesh)
        continue
    assert all(all(abs(v) < 100 for v in vertex.co) for vertex in mesh.vertices), obj.name
    original_materials = list(mesh.materials)
    # Replace slots in place: clearing them resets polygon material_index and erases cartilage/tendon surfaces.
    for index, material in enumerate(original_materials): mesh.materials[index] = web_material(material)
    if not mesh.materials: mesh.materials.append(web_material(None))
    key = structure_name(obj)
    side = re.search(r'\.([oi]?)([lr])$', obj.name)
    geometry[obj.name] = {'mesh': mesh, 'matrix': obj.matrix_world.copy(), 'meta': {
        'source_id': 'za:' + hashlib.sha256(obj.name.encode()).hexdigest()[:16],
        'source_name': key,
        'source_object': obj.name,
        'latin': translations.get(key, ''),
        'laterality': {'l': 'left', 'r': 'right'}[side[2]] if side else '',
        'collections': sorted(c.name for c in obj.users_collection),
        'source_parent': obj.parent.name if obj.parent else '',
    }}
assert len({g['meta']['source_id'] for g in geometry.values()}) == len(geometry)

# Source .g objects assemble multipart structures even when their collection is empty.
group_geometry = {}
for obj in source_objects:
    if obj.name not in geometry: continue
    ancestor = obj.parent
    visited = {obj.name}
    while ancestor:
        assert ancestor.name not in visited, f'Object parent cycle: {obj.name}'
        visited.add(ancestor.name)
        if ancestor.name.endswith('.g'):
            group_geometry.setdefault(ancestor.name, set()).add(obj.name)
        ancestor = ancestor.parent

scene = bpy.data.scenes.new('Web export')
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
bpy.context.window.scene = scene
addon_utils.enable('io_scene_gltf2')
catalog = {'schema_version': 4, 'groups': [], 'targets': []}
covered = set()
manifest = {'source': 'Z-Anatomy', 'source_file': 'Z-Anatomy/Startup.blend', 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'selections_sha256': hashlib.sha256(selection_bytes).hexdigest(), 'blender': bpy.app.version_string, 'units': 'metres', 'up_axis': 'Y', 'license': 'CC BY-SA 4.0; upstream third-party notices also apply', 'excluded_objects': excluded, 'models': []}
for name, recipe in selections.items():
    primary = source_collections[recipe['source_collection']]
    names = {o.name for o in primary.all_objects} & geometry.keys()
    assert names, f'Empty model: {name}'
    covered.update(names)
    group_id = 'group:' + name
    catalog['groups'].append({'id': group_id, 'title': recipe['title']})
    nodes = []

    def collect(collection_name, parent_id=None, path=()):
        assert collection_name not in path, f'Collection cycle: {path}'
        collection = source_collections[collection_name]
        path = (*path, collection_name)
        node_id = 'collection:' + hashlib.sha256((name + '/' + '/'.join(path)).encode()).hexdigest()[:16]
        node = {'id': node_id, 'title': collection_name, 'source_name': collection_name, 'group_id': group_id, 'structure_ids': []}
        if parent_id: node['parent_id'] = parent_id
        else:
            node['title'] = recipe['title']
            node['source_name'] = recipe['source_collection']
            node['model'] = {'path': 'models/z-anatomy/' + name + '.glb', 'scope': 'Khám phá cấu trúc theo cây phân nhóm của Z-Anatomy.', 'structure_ids': sorted(geometry[n]['meta']['source_id'] for n in names)}
        nodes.append(node)
        matches = {o.name for o in collection.all_objects} & geometry.keys()
        # Named leaf folders can be empty while the corresponding mesh belongs to their parent.
        labels = matching_labels(collection_name, collection.get('English', collection_name))
        labels.discard('')
        matches.update(n for n in names if source_label(geometry[n]['meta']['source_name']) in labels or source_label(re.sub(r'\.(?:[oi]?[lr]|o|i)$', '', n)) in labels or bool(matching_labels(geometry[n]['meta']['source_name']) & labels))
        # Attachments parented to a bone are not parts of that bone's assembly.
        for label in labels:
            matches.update(n for n in group_geometry.get(label + '.g', set())
                           if n in names or selections['muscular-insertions']['source_collection'] not in geometry[n]['meta']['collections'])
        for child in collection.children:
            matches.update(collect(child.name, node_id, path))
        if not parent_id: matches.update(names)
        node['structure_ids'] = sorted(geometry[n]['meta']['source_id'] for n in matches)
        return matches

    collect(recipe['hierarchy_collection'])
    catalog['targets'].extend(nodes)
    exported = []
    for obj_name in sorted(names):
        g = geometry[obj_name]
        obj = bpy.data.objects.new(obj_name + ' · Web', g['mesh'])
        obj.matrix_world = g['matrix']
        for k, value in g['meta'].items(): obj[k] = value
        scene.collection.objects.link(obj)
        obj.select_set(True)
        exported.append(obj)
    assert bpy.ops.export_scene.gltf(filepath=str(output / (name + '.glb')), export_format='GLB', use_selection=True, use_active_scene=True, export_extras=True, export_animations=False, export_texcoords=False, export_vertex_color='NONE', export_cameras=False, export_lights=False) == {'FINISHED'}
    for obj in exported: bpy.data.objects.remove(obj, do_unlink=True)
    package = {'source': 'Z-Anatomy', 'structures': [geometry[n]['meta'] for n in sorted(names)]}
    (output / (name + '.json')).write_text(json.dumps(package, ensure_ascii=False), encoding='utf8')
    manifest['models'].append({'file': name + '.glb', 'metadata_file': name + '.json', 'structures': len(names), 'source_ids': sorted(geometry[n]['meta']['source_id'] for n in names), 'selection': recipe, 'catalog_nodes': len(nodes)})
    print(f'EXPORTED {name}: {len(names)} structures', flush=True)
assert covered == geometry.keys(), f'Unselected anatomy: {sorted(geometry.keys() - covered)}'
manifest['unique_structures'] = len(covered)
manifest['fallback_materials'] = sorted(fallback_materials)
manifest['repaired_meshes'] = repaired
(output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf8')

(output / 'catalog.json').write_text(format_catalog(catalog), encoding='utf8')
