from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path
from types import TracebackType
from typing import Any
from urllib.parse import urlsplit

_DEFAULT_TIMEOUT_MS = 1500
_MAX_CAPTURED_OBJECTS = 256
_config: dict[str, Any] = {
    "dsn": None,
    "ingest_url": None,
    "environment": "production",
    "release": None,
    "timeout_ms": _DEFAULT_TIMEOUT_MS,
}
_captured: deque[BaseException] = deque(maxlen=_MAX_CAPTURED_OBJECTS)
_warned_configuration = False


def _diagnostic(message: str) -> None:
    sys.stderr.write(f"[Volato] {message}\n")


def _dsn_target(dsn: str) -> str:
    parsed = urlsplit(dsn)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.username
        or parsed.password is not None
        or not parsed.hostname
        or len([part for part in parsed.path.split("/") if part]) != 1
    ):
        raise ValueError("invalid VOLATO_DSN")
    host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
    if parsed.port is not None:
        host = f"{host}:{parsed.port}"
    return f"{parsed.scheme}://{host}/api/ingest"


def _timeout_ms(value: str | None) -> int:
    if value is None:
        return _DEFAULT_TIMEOUT_MS
    parsed = int(value)
    if parsed < 100 or parsed > 5000:
        raise ValueError("VOLATO_TIMEOUT_MS must be between 100 and 5000")
    return parsed


def init_volato() -> bool:
    """Load bounded VOLATO_* configuration without changing app startup."""
    global _config, _warned_configuration
    dsn = os.environ.get("VOLATO_DSN")
    try:
        if not dsn:
            raise ValueError("VOLATO_DSN is missing; Python capture is disabled")
        ingest_url = _dsn_target(dsn)
        timeout_ms = _timeout_ms(os.environ.get("VOLATO_TIMEOUT_MS"))
    except (TypeError, ValueError) as error:
        _config = {**_config, "dsn": None, "ingest_url": None}
        if not _warned_configuration:
            _warned_configuration = True
            _diagnostic(str(error))
        return False
    _config = {
        "dsn": dsn,
        "ingest_url": ingest_url,
        "environment": os.environ.get("VOLATO_ENVIRONMENT", "production")[:32],
        "release": os.environ.get("VOLATO_RELEASE"),
        "timeout_ms": timeout_ms,
    }
    return True


def _already_captured(error: BaseException) -> bool:
    if any(previous is error for previous in _captured):
        return True
    _captured.append(error)
    return False


def _safe_message(error: BaseException) -> str:
    try:
        value = str(error)
    except Exception:
        value = "Unknown error"
    return (value or "Unknown error")[:16384]


def _traceback(error: BaseException) -> str | None:
    traceback_value: TracebackType | None = error.__traceback__
    if traceback_value is None:
        return None
    root = Path.cwd().resolve()
    lines = ["Traceback (most recent call last):"]
    while traceback_value is not None:
        frame = traceback_value.tb_frame
        filename = Path(frame.f_code.co_filename)
        try:
            path = filename.resolve().relative_to(root).as_posix()
        except (OSError, ValueError):
            path = filename.as_posix()
        lines.append(
            f'  File "{path}", line {traceback_value.tb_lineno}, in {frame.f_code.co_name}'
        )
        traceback_value = traceback_value.tb_next
    lines.append(f"{type(error).__name__}: {_safe_message(error)}")
    return "\n".join(lines)[:262144]


def _bounded_text(value: Any, maximum: int) -> str | None:
    return value[:maximum] if isinstance(value, str) and value else None


def _payload(error: BaseException, context: dict[str, Any]) -> dict[str, Any]:
    release = _bounded_text(_config.get("release"), 512)
    payload: dict[str, Any] = {
        "v": 1,
        "type": type(error).__name__[:256] or "Exception",
        "message": _safe_message(error),
        "stack": _traceback(error),
        "runtime": "python",
        "timestamp": int(time.time() * 1000),
        "environment": _config["environment"],
        "release": release,
        "commitSha": release
        if release and 7 <= len(release) <= 40 and all(c in "0123456789abcdefABCDEF" for c in release)
        else None,
        "capturedVia": context.get("captured_via", "manual"),
        "method": _bounded_text(context.get("method"), 32),
        "route": _bounded_text(context.get("route"), 4096),
        "status": context.get("status")
        if isinstance(context.get("status"), int)
        else None,
        "requestId": _bounded_text(context.get("request_id"), 200),
        "contexts": {"asgi": {"surface": "http"}}
        if context.get("captured_via") == "asgi_http"
        else None,
    }
    return {key: value for key, value in payload.items() if value is not None}


def _deliver(payload: dict[str, Any]) -> bool:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        _config["ingest_url"],
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Volato-DSN": _config["dsn"],
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(
            request, timeout=_config["timeout_ms"] / 1000
        ) as response:
            status = int(response.status)
        if 200 <= status < 300:
            return True
        _diagnostic(f"Python event rejected with HTTP {status}.")
    except urllib.error.HTTPError as error:
        _diagnostic(f"Python event rejected with HTTP {error.code}.")
    except Exception as error:
        _diagnostic(
            f"Python event could not be delivered within {_config['timeout_ms']}ms: {type(error).__name__}."
        )
    return False


async def capture_exception(
    error: BaseException, context: dict[str, Any] | None = None
) -> bool:
    if _config.get("dsn") is None or _already_captured(error):
        return False
    return await asyncio.to_thread(_deliver, _payload(error, context or {}))


def _reset_for_tests() -> None:
    global _captured, _warned_configuration
    _captured = deque(maxlen=_MAX_CAPTURED_OBJECTS)
    _warned_configuration = False
