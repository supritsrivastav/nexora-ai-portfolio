import hashlib
import asyncio
import time

from fastapi import HTTPException, Request, status
from redis.exceptions import RedisError
from redis.asyncio import Redis
from app.core.config import get_rate_limit_backend


class MemoryRateLimiter:
    """Process-local fixed-window counter intended only for one dev worker."""

    def __init__(self):
        self._counters: dict[str, tuple[int, float]] = {}
        self._lock = asyncio.Lock()
        self._checks = 0

    async def check(self, key: str, limit: int, window: int) -> int:
        now = time.monotonic()
        async with self._lock:
            count, expires_at = self._counters.get(key, (0, now + window))
            if now >= expires_at:
                count, expires_at = 0, now + window
            count += 1
            self._counters[key] = count, expires_at

            # Bound stale IP-key storage without scanning on every request.
            self._checks += 1
            if self._checks % 128 == 0:
                self._counters = {
                    item_key: value
                    for item_key, value in self._counters.items()
                    if value[1] > now
                }
            return count


_memory_limiter = MemoryRateLimiter()


async def enforce_rate_limit(request: Request, bucket: str, limit: int, window: int) -> None:
    """Enforce a configured fixed-window limit using memory or shared Redis."""
    address = request.client.host if request.client else "unknown"
    client_key = hashlib.sha256(address.encode("utf-8")).hexdigest()
    key = f"nexora:rate:{bucket}:{client_key}"
    if get_rate_limit_backend() == "memory":
        count = await request.app.state.rate_limiter.check(key, limit, window)
    else:
        client: Redis = request.app.state.redis
        try:
            count = await client.eval(
                "local n=redis.call('INCR',KEYS[1]); "
                "if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; "
                "return n",
                1,
                key,
                window,
            )
        except RedisError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Request protection is temporarily unavailable.",
            ) from error
    if count > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
            headers={"Retry-After": str(window)},
        )


async def auth_rate_limit(request: Request) -> None:
    await enforce_rate_limit(request, "auth", limit=10, window=60)


async def ai_rate_limit(request: Request) -> None:
    await enforce_rate_limit(request, "ai", limit=20, window=60)
