import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path

from fastapi import Request


DEFAULT_DATABASE_PATH = Path(__file__).resolve().parents[1] / "data" / "development.sqlite3"


def connect_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path, check_same_thread=False)
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def get_database(request: Request) -> Iterator[sqlite3.Connection]:
    with closing(connect_database(request.app.state.database_path)) as connection:
        yield connection
