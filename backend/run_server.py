#!/usr/bin/env python3
"""Runtime server runner for CaRun backend."""

import setproctitle
import uvicorn
from app.config import get_settings

setproctitle.setproctitle("Carun")

if __name__ == "__main__":  # pragma: no cover
    settings = get_settings()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="127.0.0.1",
        port=settings.webserver_port,
        reload=False,
        workers=1,
        log_level="info",
        proxy_headers=True,
    )
