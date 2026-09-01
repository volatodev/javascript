---
name: volato-fastapi
description: Generate, compose, and verify dependency-free Volato Errors capture for the supported FastAPI 0.141 HTTP integration on maintained Python 3.10-3.14. Use only when volato-setup detects one conventional module-level app = FastAPI() application with the exact frozen ASGI dependency tuple. Refuse direct Starlette, factories, multiple apps, WebSockets, streaming, lifespan and background-task surfaces before mutation.
---

# Set up Volato for FastAPI

The CLI recipe is the only authority for generated Python capture. Keep the
public support boundary exact.

## Workflow

1. Confirm one repository-root `pyproject.toml`, an exact `.python-version`
   from 3.10 through 3.14, the frozen FastAPI 0.141 / Starlette / Uvicorn /
   Pydantic / AnyIO pins, one `app.py`, and exactly one module-level
   `app = FastAPI(...)` bootstrap.
2. Refuse direct Starlette applications, factories, multiple or mounted apps,
   WebSockets, streaming/SSE, lifespan hooks, background tasks, WSGI and
   provider/serverless wrappers before any mutation.
3. Run `volato init --project <id>` if the repository is not linked, then run
   `volato errors init`.
4. Inspect `volato_errors/`, the final composition in `app.py`, protected local
   environment file and `errors-python-fastapi` manifest entry. Confirm no
   Volato package or other runtime dependency was added.
5. Run the repository's production build/import check. Start the real
   `uvicorn app:app` process with a Git `VOLATO_RELEASE` as a bounded managed
   child, wait for health, exercise it, then terminate it; never leave a
   foreground server running after verification.
6. Exercise manual capture and unexpected route, dependency and application
   middleware failures. Require exactly one `runtime=python`,
   `capturedVia=asgi_http` event and the same exception/application-owned 500
   behaviour.
7. Exercise a handled `HTTPException`, a request validation failure and an
   explicit error response. They are application outcomes and must emit no
   event.
8. Exercise concurrent requests with distinct route templates and request IDs.
   Verify the payload contains only method, matched route, status and bounded
   request ID; body, cookies, authorization, query values, raw URL, validation
   input and arbitrary headers must be absent.
9. Retrieve the event through one Volato Errors CLI or MCP read path. Open the
   exact repository source and Python line, patch and run the repository's
   native focused test, and leave production recovery unresolved.

## Boundaries

- Preserve FastAPI's built-in `HTTPException` and validation handlers, every
  application middleware/handler, response and the exact raised exception.
- Never serialize request or response bodies, cookies, authorization, query
  values, raw paths, validation input, ASGI scope state, exception attributes,
  locals or source text.
- Generated code may use only the Python standard library plus the
  application-owned FastAPI/Starlette stack. It reads only `VOLATO_DSN`,
  `VOLATO_ENVIRONMENT`, `VOLATO_RELEASE` and `VOLATO_TIMEOUT_MS`.
- Missing or invalid capture configuration may disable delivery loudly but
  must never prevent application startup.
- WebSocket, streaming, lifespan and background-task failures remain explicit
  unverified surfaces. Do not imply them from HTTP route coverage.

## Completion

The supported FastAPI integration is ready only after the selected maintained-
Python cell passes exact detection, generation convergence, real ASGI capture,
privacy, propagation, direct source and repository-native verification.
Production recovery remains unresolved until the fix is deployed and verified.
