import uuid
from datetime import datetime, timedelta, timezone

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.config import (
    SESSION_COOKIE_NAME,
    get_frontend_origins,
    get_session_ttl_seconds,
    session_cookie_is_secure,
)
from app.core.database import get_connection
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    create_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)
from app.core.rate_limit import auth_rate_limit
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    PublicUser,
    SignupRequest,
    normalize_email,
)


router = APIRouter()


def _require_trusted_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin not in get_frontend_origins():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Request origin is not allowed.",
        )


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    ttl_seconds = get_session_ttl_seconds()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=ttl_seconds,
        httponly=True,
        secure=session_cookie_is_secure(request.url.hostname),
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=session_cookie_is_secure(request.url.hostname),
        samesite="lax",
        path="/",
    )


def _create_session(cursor, user_id: uuid.UUID) -> tuple[str, datetime]:
    raw_token = create_session_token()
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=get_session_ttl_seconds()
    )
    cursor.execute(
        """
        INSERT INTO auth_sessions (user_id, token_hash, expires_at)
        VALUES (%s, %s, %s)
        """,
        (user_id, hash_session_token(raw_token), expires_at),
    )
    return raw_token, expires_at


@router.post(
    "/auth/signup", status_code=status.HTTP_201_CREATED,
    response_model=AuthResponse, dependencies=[Depends(auth_rate_limit)],
)
def signup(payload: SignupRequest, request: Request, response: Response):
    _require_trusted_origin(request)

    user_id = uuid.uuid4()
    normalized_email = normalize_email(payload.email)
    password_hash = hash_password(payload.password.get_secret_value())

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO users
                        (id, email, email_normalized, password_hash, display_name)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id, email, display_name, created_at
                    """,
                    (
                        user_id,
                        payload.email.strip(),
                        normalized_email,
                        password_hash,
                        payload.display_name,
                    ),
                )
                row = cursor.fetchone()
                raw_token, _ = _create_session(cursor, user_id)
    except psycopg.errors.UniqueViolation as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists.",
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to create an account right now.",
        ) from error

    _set_session_cookie(response, request, raw_token)
    return AuthResponse(
        user=PublicUser(
            id=row[0],
            email=row[1],
            display_name=row[2],
            created_at=row[3],
        )
    )


@router.post(
    "/auth/login", response_model=AuthResponse,
    dependencies=[Depends(auth_rate_limit)],
)
def login(payload: LoginRequest, request: Request, response: Response):
    _require_trusted_origin(request)
    normalized_email = normalize_email(payload.email)
    password = payload.password.get_secret_value()

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, email, email_normalized, password_hash,
                           display_name, is_active, created_at
                    FROM users
                    WHERE email_normalized = %s
                    """,
                    (normalized_email,),
                )
                row = cursor.fetchone()

                if row is None:
                    verify_password(DUMMY_PASSWORD_HASH, password)
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid email or password.",
                    )

                password_matches = verify_password(row[3], password)
                if not password_matches or not row[5]:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid email or password.",
                    )

                raw_token, _ = _create_session(cursor, row[0])
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to authenticate right now.",
        ) from error

    _set_session_cookie(response, request, raw_token)
    return AuthResponse(
        user=PublicUser(
            id=row[0],
            email=row[1],
            display_name=row[4],
            created_at=row[6],
        )
    )


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response):
    _require_trusted_origin(request)
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)

    if raw_token:
        try:
            with get_connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE auth_sessions
                        SET revoked_at = CURRENT_TIMESTAMP
                        WHERE token_hash = %s AND revoked_at IS NULL
                        """,
                        (hash_session_token(raw_token),),
                    )
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Unable to end the session right now.",
            ) from error

    _clear_session_cookie(response, request)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/auth/me", response_model=AuthResponse)
def me(current_user: AuthenticatedUser = Depends(get_current_user)):
    return AuthResponse(
        user=PublicUser(
            id=current_user.id,
            email=current_user.email,
            display_name=current_user.display_name,
            created_at=current_user.created_at,
        )
    )
