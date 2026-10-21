from contextlib import asynccontextmanager, closing
from pathlib import Path

from fastapi import FastAPI

from .api.router import router
from .database import DEFAULT_DATABASE_PATH, connect_database


def create_app(database_path: Path = DEFAULT_DATABASE_PATH) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        database_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(connect_database(database_path)):
            pass
        application.state.database_path = database_path
        yield

    application = FastAPI(title="Human Atlas API", lifespan=lifespan)
    application.include_router(router, prefix="/api/v1")
    return application


app = create_app()
