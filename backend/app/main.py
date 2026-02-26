from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.sessions import SessionMiddleware

from .api import auth_router, leaderboard_router, tracks_router
from .config import get_settings
from .db import session_scope
from .seed import seed_system_tracks

settings = get_settings()
app = FastAPI(title=settings.app_name)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    same_site="lax",
    https_only=settings.app_env == "prod",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(tracks_router)
app.include_router(leaderboard_router)


@app.get("/api/health")
def health():
    return {"ok": True, "env": settings.app_env}


@app.on_event("startup")
def startup_seed_tracks():
    try:
        with session_scope() as session:
            seed_system_tracks(session)
    except SQLAlchemyError:
        # Keep startup resilient before first migration/setup.
        pass


frontend_dir = Path(settings.frontend_dir)
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
