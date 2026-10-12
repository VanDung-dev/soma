"""Run with Blender's bundled Python; the source .blend is never saved."""
import bpy
import addon_utils
import csv
import hashlib
import io
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[3]
source = root / 'Z-Anatomy' / 'Startup.blend'
assert Path(bpy.data.filepath).resolve() == source.resolve()
assert bpy.context.scene.unit_settings.system == 'METRIC'
assert bpy.context.scene.unit_settings.scale_length == 1
output = root / '.cache' / 'z-anatomy' / 'export'
output.mkdir(parents=True, exist_ok=True)
selection_bytes = (root / 'content/z-anatomy-selections.json').read_bytes()
selections = json.loads(selection_bytes)
source_objects = list(bpy.data.objects)
source_collections = dict(bpy.data.collections.items())
texts = {t.name: t.as_string().strip() for t in bpy.data.texts if t.as_string().strip()}
translations = {}
for row in csv.DictReader(io.StringIO(texts.get('Translations', '')), delimiter=';'):
    translations[row['English']] = row.get('Latin', '')

def eligible(obj):
    return obj.type in {'MESH', 'CURVE'} and not re.search(r'\.(j|t|g|st)$|-profile', obj.name, re.I) and any(re.match(r'^[1-9]:', c.name) for c in obj.users_collection)

def definition_key(obj):
    name = obj.data.name
    return re.sub(r'\.(?:[oi]?[lr]|o|i)$', '', name)

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
def web_material(original):
    # shortcut: retain static PBR inputs; bake procedural shaders when visual parity is required.
    name = original.name if original else 'Missing material'
    if name in materials: return materials[name]
    bsdf = principled(original.node_tree if original else None)
    if bsdf:
        color = tuple(bsdf.inputs['Base Color'].default_value)
        roughness = float(bsdf.inputs['Roughness'].default_value)
        alpha = float(bsdf.inputs['Alpha'].default_value)
    else:
        color = tuple(original.diffuse_color) if original else (0.6, 0.4, 0.3, 1)
        roughness, alpha = 0.65, 1
        fallback_materials.add(name)
    material = bpy.data.materials.new(name + ' · Web PBR')
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = color
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['Alpha'].default_value = alpha
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
    mesh.materials.clear()
    for material in original_materials: mesh.materials.append(web_material(material))
    if not mesh.materials: mesh.materials.append(web_material(None))
    key = definition_key(obj)
    side = re.search(r'\.([oi]?)([lr])$', obj.name)
    geometry[obj.name] = {'mesh': mesh, 'matrix': obj.matrix_world.copy(), 'meta': {
        'source_id': 'za:' + hashlib.sha256(obj.name.encode()).hexdigest()[:16],
        'source_name': key,
        'source_object': obj.name,
        'definition_key': key if key in texts else '',
        'latin': translations.get(key, ''),
        'laterality': {'l': 'left', 'r': 'right'}[side[2]] if side else '',
        'collections': sorted(c.name for c in obj.users_collection),
        'source_parent': obj.parent.name if obj.parent else '',
    }}
assert len({g['meta']['source_id'] for g in geometry.values()}) == len(geometry)

scene = bpy.data.scenes.new('Web export')
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
bpy.context.window.scene = scene
addon_utils.enable('io_scene_gltf2')
def definition(key):
    return {'text': texts[key], 'links': sorted(set(re.findall(r'https?://[^\s<>"\]]+', texts[key])))}

catalog = {'schema_version': 2, 'groups': [], 'targets': []}
covered = set()
manifest = {'source': 'Z-Anatomy', 'source_file': 'Z-Anatomy/Startup.blend', 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'selections_sha256': hashlib.sha256(selection_bytes).hexdigest(), 'blender': bpy.app.version_string, 'units': 'metres', 'up_axis': 'Y', 'license': 'CC BY-SA 4.0; upstream third-party notices also apply', 'excluded_objects': excluded, 'models': []}
for name, recipe in selections.items():
    primary = source_collections[recipe['source_collection']]
    names = {o.name for o in primary.all_objects} & geometry.keys()
    assert names, f'Empty model: {name}'
    covered.update(names)
    group_id = 'group:' + name
    catalog['groups'].append({'id': group_id, 'title': recipe['title']})
    definitions = {}
    collection_definitions = {}
    nodes = []

    def collect(collection_name, parent_id=None, path=()):
        assert collection_name not in path, f'Collection cycle: {path}'
        collection = source_collections[collection_name]
        path = (*path, collection_name)
        node_id = 'collection:' + hashlib.sha256((name + '/' + '/'.join(path)).encode()).hexdigest()[:16]
        key = collection.get('English', collection_name)
        key = key if key in texts else collection_name if collection_name in texts else ''
        node = {'id': node_id, 'title': collection_name, 'source_name': collection_name, 'group_id': group_id, 'structure_ids': [], 'definition_key': key}
        if parent_id: node['parent_id'] = parent_id
        else:
            node['title'] = recipe['title']
            node['source_name'] = recipe['source_collection']
            node['model'] = {'path': 'models/z-anatomy/' + name + '.glb', 'scope': 'Khám phá cấu trúc theo cây phân nhóm của Z-Anatomy.'}
        nodes.append(node)
        matches = {o.name for o in collection.all_objects} & names
        # Named leaf folders can be empty while the corresponding mesh belongs to their parent.
        matches.update(n for n in names if geometry[n]['meta']['source_name'] == collection_name)
        for child in collection.children:
            matches.update(collect(child.name, node_id, path))
        if not parent_id: matches = names.copy()
        node['structure_ids'] = sorted(geometry[n]['meta']['source_id'] for n in matches)
        if key: collection_definitions[key] = definition(key)
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
        key = g['meta']['definition_key']
        if key:
            definitions[key] = definition(key)
    assert bpy.ops.export_scene.gltf(filepath=str(output / (name + '.glb')), export_format='GLB', use_selection=True, use_active_scene=True, export_extras=True, export_animations=False, export_texcoords=False, export_vertex_color='NONE', export_cameras=False, export_lights=False) == {'FINISHED'}
    for obj in exported: bpy.data.objects.remove(obj, do_unlink=True)
    package = {'source': 'Z-Anatomy', 'structures': [geometry[n]['meta'] for n in sorted(names)], 'definitions': definitions, 'collection_definitions': collection_definitions}
    (output / (name + '.json')).write_text(json.dumps(package, ensure_ascii=False), encoding='utf8')
    manifest['models'].append({'file': name + '.glb', 'metadata_file': name + '.json', 'structures': len(names), 'definitions': len(definitions), 'source_ids': sorted(geometry[n]['meta']['source_id'] for n in names), 'selection': recipe, 'catalog_nodes': len(nodes)})
    print(f'EXPORTED {name}: {len(names)} structures, {len(definitions)} definitions', flush=True)
assert covered == geometry.keys(), f'Unselected anatomy: {sorted(geometry.keys() - covered)}'
manifest['unique_structures'] = len(covered)
manifest['structures_with_definitions'] = sum(bool(g['meta']['definition_key']) for g in geometry.values())
manifest['fallback_materials'] = sorted(fallback_materials)
manifest['repaired_meshes'] = repaired
(output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf8')

(output / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
