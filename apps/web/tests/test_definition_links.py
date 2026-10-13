import ast
from pathlib import Path
import unittest


path = Path(__file__).resolve().parents[1] / 'scripts/export-z-anatomy.py'
nodes = [n for n in ast.parse(path.read_text()).body
         if isinstance(n, ast.FunctionDef) and n.name in {'source_label', 'resolve_definition'}
         or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'definition_aliases' for t in n.targets)]
scope = {'texts': {'Fasciae': 'FASCIA', 'Thoracic aorta': 'AORTA',
                   'Mucosa of stomach': 'MUCOSA', 'Costoclavicular ligament': 'LIGAMENT',
                   'Vestibule ': 'VESTIBULE', 'Costal cartilage of 2nd rib': 'COSTAL CARTILAGE'}}
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), scope)
resolve = scope['resolve_definition']


class DefinitionLinksTests(unittest.TestCase):
    def test_existing_exact_source_key_and_object_name_fallback(self):
        self.assertEqual(resolve('Circle', 'Mucosa of stomach'), 'Mucosa of stomach')
        self.assertEqual(resolve('Mucosa of stomach', 'Circle'), 'Mucosa of stomach')

    def test_reviewed_alias_and_source_annotation(self):
        self.assertEqual(resolve('Fascia'), 'Fasciae')
        self.assertEqual(resolve("Thoracic aorta'"), 'Thoracic aorta')
        self.assertEqual(resolve('Vestibule'), 'Vestibule ')
        self.assertEqual(resolve('Costal cartilage of second rib'), 'Costal cartilage of 2nd rib')

    def test_similar_names_and_absent_alias_text_remain_unlinked(self):
        self.assertEqual(resolve('Coracoclavicular ligament'), '')
        self.assertEqual(resolve('Cervical fascia'), '')
        self.assertEqual(resolve('Synovial bursa'), '')


if __name__ == '__main__':
    unittest.main()
