from uuid import UUID
from datetime import datetime

from fastapi import HTTPException, Request, status
from pydantic import BaseModel

from app.core.config import SESSION_COOKIE_NAME
from app.core.database import get_connection
from app.core.security import hash_session_token


class AuthenticatedUser(BaseModel):
    id: UUID
    email: str
    display_name: str | None
    created_at: datetime


def get_current_user(request: Request) -> AuthenticatedUser:
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT users.id, users.email, users.display_name,
                           users.created_at, users.is_active
                    FROM auth_sessions
                    JOIN users ON users.id = auth_sessions.user_id
                    WHERE auth_sessions.token_hash = %s
                      AND auth_sessions.revoked_at IS NULL
                      AND auth_sessions.expires_at > CURRENT_TIMESTAMP
                    """,
                    (hash_session_token(raw_token),),
                )
                row = cursor.fetchone()
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is unavailable.",
        ) from error

    if row is None or not row[4]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    return AuthenticatedUser(
        id=row[0],
        email=row[1],
        display_name=row[2],
        created_at=row[3],
    )
