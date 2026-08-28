from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Awaitable, Callable

from .runtime import capture_exception

AsgiApp = Callable[
    [dict[str, Any], Callable[[], Awaitable[dict[str, Any]]], Callable[[dict[str, Any]], Awaitable[None]]],
    Awaitable[None],
]
_http_context: ContextVar[dict[str, Any] | None] = ContextVar(
    "volato_http_context", default=None
)


def _text(value: Any, maximum: int) -> str | None:
    return value[:maximum] if isinstance(value, str) and value else None


def _request_id(scope: dict[str, Any]) -> str | None:
    headers = scope.get("headers")
    if not isinstance(headers, list):
        return None
    for item in headers:
        if not isinstance(item, tuple) or len(item) != 2:
            continue
        name, value = item
        if name == b"x-request-id" and isinstance(value, bytes):
            return _text(value.decode("utf-8", "replace"), 200)
    return None


def _route(scope: dict[str, Any]) -> str | None:
    route = getattr(scope.get("route"), "path", None)
    if not isinstance(route, str) or not route.startswith("/"):
        return None
    return _text(route.split("?", 1)[0], 4096)


class VolatoASGIMiddleware:
    """Capture unexpected HTTP failures and preserve the ASGI exception."""

    def __init__(self, app: AsgiApp) -> None:
        self.app = app

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[[], Awaitable[dict[str, Any]]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        context = {
            "captured_via": "asgi_http",
            "method": _text(scope.get("method"), 32),
            "route": None,
            "status": 500,
            "request_id": _request_id(scope),
        }
        token = _http_context.set(context)
        response_started = False

        async def bounded_send(message: dict[str, Any]) -> None:
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, bounded_send)
        except Exception as error:
            # Background/streaming failures happen after response start and
            # stay outside the frozen HTTP promise.
            if not response_started:
                context["route"] = _route(scope)
                await capture_exception(error, context)
            raise
        finally:
            _http_context.reset(token)
