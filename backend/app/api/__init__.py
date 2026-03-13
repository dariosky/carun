from .auth import router as auth_router
from .leaderboard import router as leaderboard_router
from .tournaments import router as tournaments_router
from .tracks import router as tracks_router

__all__ = ["auth_router", "leaderboard_router", "tracks_router", "tournaments_router"]
