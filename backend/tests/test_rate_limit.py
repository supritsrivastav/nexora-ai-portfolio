import unittest
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from redis.exceptions import ConnectionError as RedisConnectionError
from starlette.requests import Request

from app.core.rate_limit import MemoryRateLimiter, enforce_rate_limit


class FakeRedis:
    def __init__(self):
        self.count = 0
        self.eval = AsyncMock(side_effect=self._increment)

    async def _increment(self, *_args):
        self.count += 1
        return self.count


def request_with_redis(redis):
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/auth/login",
        "raw_path": b"/api/auth/login",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("localhost", 8080),
        "app": SimpleNamespace(state=SimpleNamespace(redis=redis)),
    }
    return Request(scope)


class RateLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_counter_rejects_requests_over_limit(self):
        redis = FakeRedis()
        request = request_with_redis(redis)
        with patch.dict(os.environ, {"RATE_LIMIT_BACKEND": "redis"}):
            for _ in range(2):
                await enforce_rate_limit(request, "auth", limit=2, window=60)
            with self.assertRaises(HTTPException) as raised:
                await enforce_rate_limit(request, "auth", limit=2, window=60)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.headers["Retry-After"], "60")
        self.assertEqual(redis.eval.await_count, 3)

    async def test_memory_backend_enforces_limit(self):
        limiter = MemoryRateLimiter()
        request = request_with_redis(None)
        request.app.state.rate_limiter = limiter
        with patch.dict(os.environ, {"RATE_LIMIT_BACKEND": "memory"}):
            await enforce_rate_limit(request, "ai", limit=1, window=60)
            with self.assertRaises(HTTPException) as raised:
                await enforce_rate_limit(request, "ai", limit=1, window=60)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.headers["Retry-After"], "60")

    async def test_redis_failure_returns_503_without_memory_fallback(self):
        redis = FakeRedis()
        redis.eval.side_effect = RedisConnectionError("unavailable")
        memory = AsyncMock()
        request = request_with_redis(redis)
        request.app.state.rate_limiter = SimpleNamespace(check=memory)
        with patch.dict(os.environ, {"RATE_LIMIT_BACKEND": "redis"}):
            with self.assertRaises(HTTPException) as raised:
                await enforce_rate_limit(request, "auth", limit=10, window=60)
        self.assertEqual(raised.exception.status_code, 503)
        memory.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
