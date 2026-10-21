import ast
import subprocess
import unittest
from pathlib import Path

import app.main
from app.database import DEFAULT_DATABASE_PATH


class BackendLayoutTests(unittest.TestCase):
    def test_backend_stays_in_its_canonical_location(self):
        repository = Path(__file__).resolve().parents[3]
        backend = repository / "apps" / "backend"
        self.assertEqual(Path(app.main.__file__).resolve(), backend / "app" / "main.py")
        self.assertEqual(DEFAULT_DATABASE_PATH, backend / "data" / "development.sqlite3")
        for alias in ("backend", "server", "api", "apps/api", "apps/server"):
            with self.subTest(path=alias):
                self.assertFalse((repository / alias).exists(), f"Backend belongs in {backend}, not {alias}")
        for module in ("auth", "users", "lessons", "games", "dashboard"):
            with self.subTest(module=module):
                self.assertTrue((backend / "app" / "modules" / module / "__init__.py").is_file())

    def test_fastapi_source_is_owned_by_backend(self):
        repository = Path(__file__).resolve().parents[3]
        files = subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.py"],
            cwd=repository,
        ).decode().split("\0")
        misplaced = []
        for filename in files:
            path = repository / filename
            if not filename or filename.startswith("apps/backend/") or not path.is_file():
                continue
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                imports = [alias.name for alias in node.names] if isinstance(node, ast.Import) else []
                if isinstance(node, ast.ImportFrom) and node.module:
                    imports.append(node.module)
                if any(name.split(".")[0] == "fastapi" for name in imports):
                    misplaced.append(filename)
                    break
        self.assertFalse(misplaced, f"FastAPI source belongs in apps/backend/: {misplaced}")
