import unittest
from unittest.mock import AsyncMock
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import psycopg
from fastapi.testclient import TestClient

from app.core import auth as auth_core
from app.core import security
from app.main import app


ORIGIN = "http://localhost:3000"


class FakeDatabase:
    def __init__(self):
        self.users = {}
        self.sessions = {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return FakeCursor(self)


class FakeCursor:
    def __init__(self, database):
        self.database = database
        self.row = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, params=()):
        if "INSERT INTO users" in query:
            user_id, email, normalized, password_hash, display_name = params
            if normalized in self.database.users:
                raise psycopg.errors.UniqueViolation("duplicate normalized email")
            now = datetime.now(timezone.utc)
            self.database.users[normalized] = (
                user_id, email, normalized, password_hash, display_name, True, now
            )
            self.row = (user_id, email, display_name, now)
        elif "FROM users" in query and "WHERE email_normalized" in query:
            self.row = self.database.users.get(params[0])
        elif "INSERT INTO auth_sessions" in query:
            user_id, token_hash, expires_at = params
            self.database.sessions[token_hash] = [user_id, expires_at, None]
        elif "FROM auth_sessions" in query:
            token_hash = params[0]
            session = self.database.sessions.get(token_hash)
            user = next((u for u in self.database.users.values()
                         if session and u[0] == session[0]), None)
            if (session and user and session[2] is None and
                    session[1] > datetime.now(timezone.utc)):
                self.row = (user[0], user[1], user[4], user[6], user[5])
            else:
                self.row = None
        elif "UPDATE auth_sessions" in query:
            session = self.database.sessions.get(params[0])
            if session:
                session[2] = datetime.now(timezone.utc)
        else:
            raise AssertionError(f"Unexpected SQL: {query}")

    def fetchone(self):
        return self.row


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.database = FakeDatabase()
        self.db_auth_patch = patch("app.api.auth.get_connection", lambda: self.database)
        self.db_core_patch = patch("app.core.auth.get_connection", lambda: self.database)
        self.db_auth_patch.start()
        self.db_core_patch.start()
        self.cookie_secure_patch = patch("app.api.auth.session_cookie_is_secure", return_value=False)
        self.cookie_secure_patch.start()
        self.rate_limit_patch = patch(
            "app.core.rate_limit.enforce_rate_limit", new_callable=AsyncMock
        )
        self.rate_limit_patch.start()
        self.client = TestClient(app, base_url="http://localhost")

    def tearDown(self):
        self.client.close()
        self.cookie_secure_patch.stop()
        self.rate_limit_patch.stop()
        self.db_core_patch.stop()
        self.db_auth_patch.stop()

    def signup(self, email="user@example.com", password="Long-test-password-42"):
        return self.client.post(
            "/api/auth/signup",
            headers={"Origin": ORIGIN},
            json={"email": email, "password": password, "display_name": "Test User"},
        )

    def test_argon2id_password_hash_and_verification(self):
        hashed = security.hash_password("Long-test-password-42")
        self.assertTrue(hashed.startswith("$argon2id$"))
        self.assertTrue(security.verify_password(hashed, "Long-test-password-42"))
        self.assertFalse(security.verify_password(hashed, "wrong-password"))

    def test_signup_validation_and_safe_response(self):
        invalid = self.client.post("/api/auth/signup", headers={"Origin": ORIGIN},
                                   json={"email": "bad", "password": "short"})
        self.assertEqual(invalid.status_code, 422)
        response = self.signup()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(set(response.json()["user"]), {"id", "email", "display_name", "created_at"})
        self.assertNotIn("password", response.text)
        self.assertNotIn("password_hash", response.text)
        cookie = response.headers["set-cookie"].lower()
        self.assertIn("httponly", cookie)
        self.assertIn("samesite=lax", cookie)
        self.assertIn("nexora_session", cookie)

    def test_duplicate_email_is_conflict(self):
        self.assertEqual(self.signup().status_code, 201)
        self.assertEqual(self.signup(email="USER@example.com").status_code, 409)

    def test_valid_and_invalid_login_and_inactive_rejection(self):
        self.signup()
        valid = self.client.post("/api/auth/login", headers={"Origin": ORIGIN},
                                 json={"email": "user@example.com", "password": "Long-test-password-42"})
        self.assertEqual(valid.status_code, 200)
        invalid = self.client.post("/api/auth/login", headers={"Origin": ORIGIN},
                                   json={"email": "user@example.com", "password": "incorrect-password"})
        self.assertEqual(invalid.status_code, 401)
        user = self.database.users["user@example.com"]
        self.database.users["user@example.com"] = (*user[:5], False, user[6])
        inactive = self.client.post("/api/auth/login", headers={"Origin": ORIGIN},
                                    json={"email": "user@example.com", "password": "Long-test-password-42"})
        self.assertEqual(inactive.status_code, 401)

    def test_me_session_logout_revocation_and_expiry(self):
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        signed_up = self.signup()
        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)
        self.assertEqual(self.client.post("/api/auth/logout", headers={"Origin": ORIGIN}).status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.assertEqual(self.client.get("/api/tickets").status_code, 401)

        token_hash = next(iter(self.database.sessions))
        self.database.sessions[token_hash][1] = datetime.now(timezone.utc) - timedelta(seconds=1)
        self.client.cookies.set("nexora_session", "expired-test-token")
        self.database.sessions[security.hash_session_token("expired-test-token")] = [
            next(iter(self.database.users.values()))[0],
            datetime.now(timezone.utc) - timedelta(seconds=1), None,
        ]
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.assertEqual(self.client.get("/api/tickets").status_code, 401)
        self.assertIn("set-cookie", signed_up.headers)

    def test_state_changing_auth_requires_trusted_origin(self):
        response = self.client.post("/api/auth/signup", headers={"Origin": "https://attacker.example"},
                                    json={"email": "user@example.com", "password": "Long-test-password-42"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(self.database.users), 0)


if __name__ == "__main__":
    unittest.main()
