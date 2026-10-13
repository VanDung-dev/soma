import ast
from pathlib import Path
from types import SimpleNamespace as Node
import unittest


# The exporter runs inside Blender; load this helper without bpy or export side effects.
path = Path(__file__).resolve().parents[1] / "scripts/export-z-anatomy.py"
helper = next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == "material_alpha")
scope = {}
exec(compile(ast.Module(body=[helper], type_ignores=[]), str(path), "exec"), scope)
material_alpha = scope["material_alpha"]


def shader(alpha=1.0, factor=0.85, first=True, dynamic=False, connected=True, other_type="BSDF_TRANSPARENT"):
    inputs = [Node(default_value=factor, is_linked=dynamic), Node(index=1, links=[]), Node(index=2, links=[])]
    inputs[2 if first else 1].links = [Node(from_node=Node(type=other_type))]
    mix = Node(type="MIX_SHADER", inputs=inputs, outputs=[Node(is_linked=connected)])
    return Node(inputs={"Alpha": Node(default_value=alpha)}, outputs={"BSDF": Node(links=[Node(to_node=mix, to_socket=inputs[1 if first else 2])])})


class MaterialAlphaTests(unittest.TestCase):
    def test_fascia_keeps_its_source_transparency(self):
        self.assertAlmostEqual(material_alpha(shader()), 0.15)

    def test_reversed_mix_preserves_bsdf_alpha(self):
        self.assertAlmostEqual(material_alpha(shader(alpha=0.4, first=False)), 0.34)

    def test_dynamic_unused_and_nontransparent_mixes_do_not_change_alpha(self):
        for options in [dict(dynamic=True), dict(connected=False), dict(other_type="BSDF_DIFFUSE")]:
            with self.subTest(options=options):
                self.assertAlmostEqual(material_alpha(shader(alpha=0.8246753215789795, **options)), 0.8246753215789795)


if __name__ == "__main__":
    unittest.main()
