from __future__ import annotations

import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

import app as target
from volato_errors import capture_exception
from volato_errors import runtime as volato_runtime


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def manual_failure() -> RuntimeError:
    try:
        raise RuntimeError("manual unavailable")
    except RuntimeError as error:
        return error


require(asyncio.run(capture_exception(manual_failure())), "manual event was not delivered")

client = TestClient(target.app, raise_server_exceptions=False)

route_response = client.post(
    "/boom/private-order?token=query-secret",
    headers={
        "authorization": "Bearer authorization-secret",
        "cookie": "session=cookie-secret",
        "x-hostile": "header-secret",
        "x-request-id": "route-request",
    },
    json={"email": "body-secret@example.com"},
)
require(route_response.status_code == 500, "unexpected route status changed")
require(route_response.text == "application-owned", "application 500 handler changed")
require(
    target.handled_ids[-1] == id(target.route_failure),
    "the application handler did not receive the exact raised exception",
)

# The same exception object may reach the boundary again, but must still emit
# exactly once inside the bounded process window.
repeat = client.post("/boom/second", headers={"x-request-id": "route-repeat"})
require(repeat.status_code == 500, "repeat failure propagation changed")

dependency = client.get(
    "/dependency/private-value", headers={"x-request-id": "dependency-request"}
)
require(dependency.status_code == 500, "dependency failure propagation changed")

middleware = client.get(
    "/health",
    headers={"x-trigger-failure": "yes", "x-request-id": "middleware-request"},
)
require(middleware.status_code == 500, "middleware failure propagation changed")

before_expected = len(target.handled_ids)
require(client.get("/expected").status_code == 418, "HTTPException response changed")
require(client.get("/validated/not-an-integer").status_code == 422, "validation response changed")
require(client.get("/explicit").status_code == 409, "explicit error response changed")
require(
    len(target.handled_ids) == before_expected,
    "handled HTTP or validation outcome reached the application 500 handler",
)

with ThreadPoolExecutor(max_workers=2) as executor:
    alpha = executor.submit(
        client.get,
        "/alpha/private-alpha",
        headers={"x-request-id": "alpha-request"},
    )
    beta = executor.submit(
        client.get,
        "/beta/private-beta",
        headers={"x-request-id": "beta-request"},
    )
    require(alpha.result().status_code == 500, "alpha propagation changed")
    require(beta.result().status_code == 500, "beta propagation changed")

# Invalid capture configuration is loud but cannot alter the already composed
# application's startup or ordinary response behaviour.
previous_dsn = os.environ.get("VOLATO_DSN")
os.environ["VOLATO_DSN"] = "not-a-dsn"
require(not volato_runtime.init_volato(), "invalid DSN was accepted")
require(client.get("/health").status_code == 200, "invalid DSN changed app health")
if previous_dsn is not None:
    os.environ["VOLATO_DSN"] = previous_dsn

print(
    json.dumps(
        {
            "ok": True,
            "handled": len(target.handled_ids),
            "python": os.sys.version.split()[0],
        }
    )
)
