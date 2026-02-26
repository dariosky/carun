#!/usr/bin/env python3
"""Runtime server runner for CaRun backend."""

import os

import setproctitle
import uvicorn

setproctitle.setproctitle("Carun API")

if __name__ == "__main__":  # pragma: no cover
    port = int(os.environ.get("WEBSERVER_PORT", "8080"))
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="127.0.0.1",
        port=port,
        reload=False,
        workers=1,
        log_level="info",
        proxy_headers=True,
    )
