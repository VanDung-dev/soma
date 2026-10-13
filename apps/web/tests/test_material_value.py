import ast
from pathlib import Path
from types import SimpleNamespace as Node
import unittest

path = Path(__file__).resolve().parents[1] / "scripts/export-z-anatomy.py"
helper = next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == "material_value")
scope = {}
exec(compile(ast.Module(body=[helper], type_ignores=[]), str(path), "exec"), scope)
material_value = scope["material_value"]


def socket(value=0, node=None):
    result = Node(default_value=value, is_linked=node is not None, links=[])
    result.as_pointer = lambda: id(result)
    if node:
        result.links = [Node(from_node=node, from_socket=Node(default_value=value))]
    return result


class MaterialValueTests(unittest.TestCase):
    def test_constant_gamma_and_reroute_preserve_color_and_alpha(self):
        gamma = Node(type="GAMMA", inputs={"Color": socket((0.5, 0.25, -0.1, 0.7)), "Gamma": socket(2)})
        route = Node(type="REROUTE", inputs=[socket(node=gamma)])
        self.assertEqual(material_value(socket(node=route)), (0.25, 0.0625, 0, 0.7))

    def test_cartilage_source_mix(self):
        inputs = [socket(0.4102563858)] + [socket() for _ in range(5)]
        inputs += [socket((0.6234740019, 0.8000000119, 0.8000000119, 1)), socket((0.8000000715, 0.3480973542, 0.2356720865, 1))]
        mix = Node(type="MIX", data_type="RGBA", blend_type="MIX", inputs=inputs, clamp_factor=True, clamp_result=False)
        color = material_value(socket(node=mix))
        for actual, expected in zip(color, (0.695895, 0.614604, 0.568481, 1)):
            self.assertAlmostEqual(actual, expected, places=5)
        inputs[0] = socket(2)
        self.assertEqual(material_value(socket(node=mix)), inputs[7].default_value)

    def test_dynamic_nodes_and_cycles_are_unresolved(self):
        self.assertIsNone(material_value(socket(node=Node(type="ATTRIBUTE"))))
        cycle = Node(type="REROUTE", inputs=[])
        entry = socket(node=cycle)
        cycle.inputs = [entry]
        self.assertIsNone(material_value(entry))


if __name__ == "__main__":
    unittest.main()
