import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from app.database import DEFAULT_DATABASE_PATH, connect_database
from app.main import create_app


class BackendTests(unittest.TestCase):
    def test_health_uses_an_isolated_sqlite_database(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "data" / "test.sqlite3"
            application = create_app(path)
            self.assertFalse(path.exists())
            with TestClient(application) as client:
                response = client.get("/api/v1/health")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"status": "ok", "database": "sqlite"})
                self.assertEqual(application.state.database_path, path)
                self.assertTrue(path.is_file())
            self.assertNotEqual(path, DEFAULT_DATABASE_PATH)

    def test_sqlite_persists_data_and_enforces_foreign_keys(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "test.sqlite3"
            with closing(connect_database(path)) as connection:
                connection.execute("CREATE TABLE parent (id INTEGER PRIMARY KEY)")
                connection.execute("CREATE TABLE child (parent_id INTEGER REFERENCES parent(id))")
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute("INSERT INTO child VALUES (99)")
                connection.execute("INSERT INTO parent VALUES (1)")
                connection.commit()
            with closing(connect_database(path)) as connection:
                self.assertEqual(connection.execute("SELECT id FROM parent").fetchall(), [(1,)])
                self.assertEqual(connection.execute("PRAGMA foreign_keys").fetchone(), (1,))

    def test_database_initialization_errors_are_not_hidden(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "not-a-directory"
            path.write_text("blocked", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                with TestClient(create_app(path / "test.sqlite3")):
                    self.fail("Startup must reject an unusable database path")
