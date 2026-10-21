from sqlite3 import Connection
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..database import get_database


class HealthStatus(BaseModel):
    status: Literal["ok"]
    database: Literal["sqlite"]


router = APIRouter()


@router.get("/health", tags=["health"])
def health(database: Annotated[Connection, Depends(get_database)]) -> HealthStatus:
    database.execute("SELECT 1").fetchone()
    return HealthStatus(status="ok", database="sqlite")
