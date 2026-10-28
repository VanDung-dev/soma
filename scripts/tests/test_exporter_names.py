import ast
import re
from pathlib import Path
from types import SimpleNamespace
import unittest


path = Path(__file__).resolve().parents[1] / 'models/export-z-anatomy.py'
tree = ast.parse(path.read_text())
nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
         and node.name in {'structure_name', 'source_label', 'matching_labels'}
         or isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'name_aliases' for t in node.targets)]
scope = {'re': re}
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), scope)


class ExporterNamesTests(unittest.TestCase):
    def test_generic_or_reused_mesh_names_do_not_replace_anatomical_names(self):
        cases = [('Mucosa of stomach', 'Circle', 'Mucosa of stomach'),
                 ('Descending part of trapezius muscle.ol', 'Ascending part of trapezius muscle.o1', 'Descending part of trapezius muscle'),
                 ('Coccygeus muscle.r', 'Coccygeus muscle.t', 'Coccygeus muscle'),
                 ('Femur.l', 'Femur', 'Femur'),
                 ('Abductor hallucis.el', 'Abductor hallucis.e', 'Abductor hallucis.e')]
        for obj, mesh, expected in cases:
            with self.subTest(obj=obj):
                self.assertEqual(scope['structure_name'](SimpleNamespace(name=obj, data=SimpleNamespace(name=mesh))), expected)

    def test_hierarchy_matching_uses_names_without_description_text(self):
        self.assertIn('Fasciae', scope['matching_labels']('Fascia'))
        self.assertIn('Costal cartilage of 2nd rib', scope['matching_labels']('Costal cartilage of second rib'))
        self.assertIn('Thoracic aorta', scope['matching_labels']("Thoracic aorta'"))
        self.assertEqual(scope['matching_labels']('Synovial bursa'), {'Synovial bursa'})

    def test_exporter_only_reads_the_named_translation_table(self):
        reads = [node for node in ast.walk(tree) if isinstance(node, ast.Attribute)
                 and isinstance(node.value, ast.Attribute) and isinstance(node.value.value, ast.Name)
                 and node.value.value.id == 'bpy' and node.value.attr == 'data' and node.attr == 'texts']
        self.assertEqual(len(reads), 1)
        self.assertNotIn('definition_key', path.read_text())
        self.assertNotIn('resolve_definition', path.read_text())


if __name__ == '__main__':
    unittest.main()
