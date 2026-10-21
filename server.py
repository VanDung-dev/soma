import os
import sys
from pathlib import Path


def main():
    repository = Path(__file__).resolve().parent
    environment = repository / ".venv"
    python = environment / "Scripts" / "python.exe" if sys.platform == "win32" else environment / "bin" / "python"
    if not python.is_file():
        raise SystemExit("Chưa có .venv của repo. Xem hướng dẫn tại README.md#backend-development.")
    backend = repository / "apps" / "backend"
    os.execv(str(python), [
        str(python), "-m", "uvicorn", "app.main:app",
        "--app-dir", str(backend), "--reload", "--reload-dir", str(backend),
        "--host", "127.0.0.1", "--port", "8000",
    ])


if __name__ == "__main__":
    main()
