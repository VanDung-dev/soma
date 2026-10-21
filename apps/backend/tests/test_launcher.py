import importlib.util
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


repository = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("backend_launcher", repository / "server.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_launcher_uses_repository_paths_and_virtual_environment(self):
        for platform, executable in (("darwin", "bin/python"), ("win32", "Scripts/python.exe")):
            with self.subTest(platform=platform), TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                python = root / ".venv" / executable
                python.parent.mkdir(parents=True)
                python.touch()
                backend = root / "apps" / "backend"
                with patch.object(launcher, "__file__", str(root / "server.py")), \
                        patch.object(launcher.sys, "platform", platform), \
                        patch.object(launcher.os, "execv") as execute:
                    launcher.main()
                execute.assert_called_once_with(str(python), [
                    str(python), "-m", "uvicorn", "app.main:app",
                    "--app-dir", str(backend), "--reload", "--reload-dir", str(backend),
                    "--host", "127.0.0.1", "--port", "8000",
                ])

    def test_missing_environment_explains_setup_without_starting_server(self):
        with TemporaryDirectory() as directory, \
                patch.object(launcher, "__file__", str(Path(directory) / "server.py")), \
                patch.object(launcher.os, "execv") as execute:
            with self.assertRaisesRegex(SystemExit, "README.md#backend-development"):
                launcher.main()
            execute.assert_not_called()
