import os

import psycopg

from app.core.config import APP_ENV, get_required_env


def get_connection():
    """Create a bounded-time PostgreSQL connection from validated settings."""
    try:
        connect_timeout = int(os.getenv("DB_CONNECT_TIMEOUT", "5"))
    except ValueError as error:
        raise RuntimeError("DB_CONNECT_TIMEOUT must be an integer.") from error
    if not 1 <= connect_timeout <= 30:
        raise RuntimeError("DB_CONNECT_TIMEOUT must be between 1 and 30 seconds.")

    default_sslmode = "disable" if APP_ENV in {"development", "test"} else "require"
    return psycopg.connect(
        host=get_required_env("DB_HOST"),
        port=get_required_env("DB_PORT"),
        dbname=get_required_env("DB_NAME"),
        user=get_required_env("DB_USER"),
        password=get_required_env("DB_PASSWORD"),
        connect_timeout=connect_timeout,
        sslmode=os.getenv("DB_SSLMODE", default_sslmode),
        application_name="nexora-api",
    )
