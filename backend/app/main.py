from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .api import auth_router, leaderboard_router, tracks_router
from .config import get_settings

settings = get_settings()


class CacheControlledStaticFiles(StaticFiles):
    def __init__(self, *args, cache_control: str, **kwargs):
        super().__init__(*args, **kwargs)
        self.cache_control = cache_control

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        response.headers["Cache-Control"] = self.cache_control
        if self.cache_control == "no-store":
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name)

    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        max_age=settings.session_max_age_seconds,
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

    frontend_dir = Path(settings.frontend_dir)
    if frontend_dir.exists():
        is_prod = settings.app_env == "prod"
        build_id = (settings.frontend_build_id or "dev").strip() or "dev"
        build_label = (settings.frontend_build_label or "vdev").strip() or "vdev"
        static_base = f"/static/{build_id}/" if is_prod else "/"
        static_mount = static_base.rstrip("/") if is_prod else "/"
        static_cache_control = "public, max-age=31536000, immutable" if is_prod else "no-store"

        index_template = (frontend_dir / "index.html").read_text(encoding="utf-8")
        privacy_template_path = frontend_dir / "privacy.html"
        terms_template_path = frontend_dir / "terms.html"
        privacy_template = (
            privacy_template_path.read_text(encoding="utf-8")
            if privacy_template_path.exists()
            else None
        )
        terms_template = (
            terms_template_path.read_text(encoding="utf-8")
            if terms_template_path.exists()
            else None
        )

        def render_index_html() -> str:
            return index_template.replace("__STATIC_BASE__", static_base).replace(
                "__BUILD_LABEL__", build_label
            )

        def render_privacy_html() -> str:
            if privacy_template is None:
                return "<h1>Privacy page not found</h1>"
            return privacy_template.replace("__STATIC_BASE__", static_base).replace(
                "__ADMIN_EMAIL__", settings.admin_email
            )

        def render_terms_html() -> str:
            if terms_template is None:
                return "<h1>Terms page not found</h1>"
            return terms_template.replace("__STATIC_BASE__", static_base).replace(
                "__ADMIN_EMAIL__", settings.admin_email
            )

        def index_response():
            return HTMLResponse(
                content=render_index_html(),
                headers={"Cache-Control": "no-cache, must-revalidate"},
            )

        @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
        def frontend_index():
            return index_response()

        @app.api_route("/index.html", methods=["GET", "HEAD"], include_in_schema=False)
        def frontend_index_file():
            return index_response()

        @app.api_route("/privacy", methods=["GET", "HEAD"], include_in_schema=False)
        def frontend_privacy():
            return HTMLResponse(
                content=render_privacy_html(),
                headers={"Cache-Control": "no-cache, must-revalidate"},
            )

        @app.api_route("/terms", methods=["GET", "HEAD"], include_in_schema=False)
        def frontend_terms():
            return HTMLResponse(
                content=render_terms_html(),
                headers={"Cache-Control": "no-cache, must-revalidate"},
            )

        app.mount(
            static_mount,
            CacheControlledStaticFiles(
                directory=frontend_dir,
                html=False,
                cache_control=static_cache_control,
            ),
            name="frontend-static",
        )

    return app


app = create_app()
