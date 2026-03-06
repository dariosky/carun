<p align="center">
  <img src="frontend/assets/carun.svg" alt="Carun logo" width="220" />
</p>

# CaRun

CaRun is an HTML5 arcade racing game prototype with a static canvas frontend and a FastAPI backend for auth, leaderboard, and track sharing.

## Live

Play it here: https://carun.dariosky.it

## Monorepo Layout

- `frontend/`: static game client (HTML/CSS/JS/assets/tracks)
- `backend/`: FastAPI app, SQLModel models, Alembic migrations
- `scripts/deploy.py`: deployment helper
- `.env.example`, `.env.prod.example`: env templates

## Local Setup

1. Create local env file:

```bash
cp .env.example .env
```

2. Install backend dependencies:

```bash
uv sync
```

3. Run migrations:

```bash
uv run alembic -c backend/alembic.ini upgrade head
```

4. Start API + static serving:

```bash
uv run uvicorn app.main:app --app-dir backend --reload --port 8000
```

5. Open `http://localhost:8000`.

## Backend Stack

- FastAPI
- SQLModel (DB models)
- Pydantic (API request/response schemas)
- Alembic (schema migrations)
- PostgreSQL

## API Surface (MVP)

- `GET /api/health`
- `GET /api/auth/me`
- `GET /api/auth/google/login`
- `GET /api/auth/google/callback`
- `GET /api/auth/facebook/login`
- `GET /api/auth/facebook/callback`
- `POST /api/auth/logout`
- `GET /api/tracks`
- `POST /api/tracks`
- `GET /api/tracks/share/{share_token}`
- `GET /api/leaderboard/{track_id}`
- `POST /api/laps`
- `POST /api/races`

## Deployment

1. Create `.env.prod` from template and fill secrets.
2. Run deploy script:

```bash
python scripts/deploy.py
```

Useful flags:

- `--dry-run`
- `--skip-migrate`
- `--skip-restart`
- `--env-file /path/to/.env.prod`

The deploy script uploads `.env.prod` to `${APP_DIR}/.env`, then runs remote `git pull`, `uv sync`, Alembic migrations via `uv run`, restarts service, and checks health URL.
