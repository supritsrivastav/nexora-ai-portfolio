import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv


ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
# Let process/container environment override the local file.
load_dotenv(ENV_PATH, override=False)

SESSION_COOKIE_NAME = "nexora_session"
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()


def get_frontend_origins() -> tuple[str, ...]:
    raw_origins = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000")
    origins = tuple(
        origin.strip().rstrip("/")
        for origin in raw_origins.split(",")
        if origin.strip()
    )
    if not origins or "*" in origins:
        raise RuntimeError("FRONTEND_ORIGINS must contain explicit origins.")
    if any(
        urlsplit(origin).scheme not in {"http", "https"}
        or not urlsplit(origin).netloc
        or urlsplit(origin).path
        for origin in origins
    ):
        raise RuntimeError("FRONTEND_ORIGINS must contain valid origins without paths.")
    return origins


def get_session_ttl_seconds() -> int:
    try:
        hours = int(os.getenv("AUTH_SESSION_TTL_HOURS", "12"))
    except ValueError as error:
        raise RuntimeError("AUTH_SESSION_TTL_HOURS must be an integer.") from error

    if not 1 <= hours <= 24 * 30:
        raise RuntimeError("AUTH_SESSION_TTL_HOURS must be between 1 and 720.")
    return hours * 60 * 60


def session_cookie_is_secure(hostname: str | None) -> bool:
    setting = os.getenv("AUTH_COOKIE_SECURE", "true").strip().lower()
    if setting in {"true", "1", "yes"}:
        return True

    if setting in {"false", "0", "no"}:
        app_environment = os.getenv("APP_ENV", "production").strip().lower()
        if app_environment in {"development", "dev", "local"} and hostname in {
            "localhost", "127.0.0.1"
        }:
            return False

    raise RuntimeError(
        "AUTH_COOKIE_SECURE=false is only allowed for localhost development."
    )


def get_required_env(name: str) -> str:
    value = os.getenv(name, "")
    if not value.strip():
        raise RuntimeError(f"Required environment variable {name} is not configured.")
    return value


def get_redis_url() -> str:
    return os.getenv("REDIS_URL", "redis://localhost:6379/0").strip()


def get_rate_limit_backend() -> str:
    default = "memory" if APP_ENV == "development" else "redis"
    return os.getenv("RATE_LIMIT_BACKEND", default).strip().lower()


def validate_settings() -> None:
    """Fail early on missing or unsafe runtime settings without printing values."""
    if APP_ENV not in {"development", "test", "production"}:
        raise RuntimeError("APP_ENV must be development, test, or production.")

    get_required_env("DB_HOST")
    get_required_env("DB_NAME")
    get_required_env("DB_USER")
    get_required_env("DB_PASSWORD")
    get_required_env("GOOGLE_API_KEY")
    try:
        port = int(get_required_env("DB_PORT"))
        timeout = int(os.getenv("DB_CONNECT_TIMEOUT", "5"))
    except ValueError as error:
        raise RuntimeError("DB_PORT and DB_CONNECT_TIMEOUT must be integers.") from error
    if not 1 <= port <= 65535:
        raise RuntimeError("DB_PORT must be between 1 and 65535.")
    if not 1 <= timeout <= 30:
        raise RuntimeError("DB_CONNECT_TIMEOUT must be between 1 and 30 seconds.")

    origins = get_frontend_origins()
    get_session_ttl_seconds()
    rate_limit_backend = get_rate_limit_backend()
    if rate_limit_backend not in {"memory", "redis"}:
        raise RuntimeError("RATE_LIMIT_BACKEND must be 'memory' or 'redis'.")

    try:
        workers = int(os.getenv("WEB_CONCURRENCY", "1"))
    except ValueError as error:
        raise RuntimeError("WEB_CONCURRENCY must be an integer.") from error
    if workers < 1:
        raise RuntimeError("WEB_CONCURRENCY must be at least 1.")
    if rate_limit_backend == "memory":
        if APP_ENV not in {"development", "test"}:
            raise RuntimeError("The memory rate-limit backend is only allowed locally.")
        if workers != 1:
            raise RuntimeError("The memory rate-limit backend requires WEB_CONCURRENCY=1.")
    else:
        redis_url = get_required_env("REDIS_URL") if APP_ENV == "production" else get_redis_url()
        redis_parts = urlsplit(redis_url)
        allowed_redis_schemes = {"rediss"} if APP_ENV == "production" else {"redis", "rediss"}
        if redis_parts.scheme not in allowed_redis_schemes or not redis_parts.hostname:
            if APP_ENV == "production":
                raise RuntimeError("Production REDIS_URL must use rediss:// TLS.")
            raise RuntimeError("REDIS_URL must be a valid redis:// or rediss:// URL.")

    if APP_ENV == "production":
        if rate_limit_backend != "redis":
            raise RuntimeError("Production requires RATE_LIMIT_BACKEND=redis.")
        if any(not origin.startswith("https://") for origin in origins):
            raise RuntimeError("Production FRONTEND_ORIGINS must use HTTPS.")
        if os.getenv("AUTH_COOKIE_SECURE", "true").strip().lower() not in {
            "true", "1", "yes"
        }:
            raise RuntimeError("AUTH_COOKIE_SECURE must be enabled in production.")
        if os.getenv("DB_SSLMODE", "require").lower() not in {
            "require", "verify-ca", "verify-full"
        }:
            raise RuntimeError("Production DB_SSLMODE must require TLS.")
