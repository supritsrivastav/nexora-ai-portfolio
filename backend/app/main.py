
import json
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from app.api.auth import router as auth_router
# API Routers
from app.api.chat import router as chat_router
from app.api.tickets import router as tickets_router
from app.core.config import (
    get_frontend_origins,
    get_rate_limit_backend,
    get_redis_url,
    validate_settings,
)
from app.core.database import get_connection
from app.core.rate_limit import MemoryRateLimiter

logger = logging.getLogger(__name__)


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in ("method", "path"):
            if hasattr(record, field):
                entry[field] = getattr(record, field)
        return json.dumps(entry, ensure_ascii=False)


logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    handlers=[logging.StreamHandler()],
    force=True,
)
for _handler in logging.getLogger().handlers:
    _handler.setFormatter(JsonLogFormatter())


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_settings()
    app.state.rate_limit_backend = get_rate_limit_backend()
    if app.state.rate_limit_backend == "memory":
        app.state.rate_limiter = MemoryRateLimiter()
    else:
        app.state.redis = Redis.from_url(get_redis_url(), decode_responses=True)
    try:
        yield
    finally:
        if app.state.rate_limit_backend == "redis":
            await app.state.redis.aclose()

# Initialize FastAPI
app = FastAPI(
    title="Nexora AI",
    description="AI-powered IT Helpdesk SaaS",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(get_frontend_origins()),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Home Endpoint
@app.get("/")
def home():
    return {
        "message": "Welcome to Nexora AI",
        "status": "running"
    }


# Health Check Endpoint
@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "Nexora AI Backend"
    }


@app.get("/health/live")
def live():
    return {"status": "alive"}


@app.get("/health/ready")
async def ready(request: Request):
    try:
        if request.app.state.rate_limit_backend == "redis":
            await request.app.state.redis.ping()
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        return {"status": "ready"}
    except Exception:
        logger.warning("Readiness check failed: dependency unavailable")
        return JSONResponse(status_code=503, content={"status": "not_ready"})


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, _error: Exception):
    logger.error(
        "Unhandled request error",
        extra={"method": request.method, "path": request.url.path},
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred."},
    )


# Register API Routers
app.include_router(
    chat_router,
    prefix="/api",
    tags=["AI Chat"]
)

app.include_router(
    tickets_router,
    prefix="/api",
    tags=["Support Tickets"]
)

app.include_router(
    auth_router,
    prefix="/api",
    tags=["Authentication"]
)
