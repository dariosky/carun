#!/usr/bin/env python3

import setproctitle
import uvicorn

setproctitle.setproctitle("Carun DEV")
if __name__ == "__main__":  # pragma: no cover
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="localhost",
        port=8749,
        reload=True,
        log_level="info",
    )
