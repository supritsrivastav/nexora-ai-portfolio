import unittest
import os
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app


class HealthEndpointTests(unittest.TestCase):
    def test_liveness_does_not_depend_on_database(self):
        with TestClient(app, base_url="http://localhost") as client:
            self.assertEqual(client.get("/health/live").status_code, 200)
            self.assertEqual(client.get("/health").status_code, 200)

    def test_readiness_checks_database_and_returns_safe_failure(self):
        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, query):
                self.query = query

            def fetchone(self):
                return (1,)

        class Connection:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def cursor(self):
                return Cursor()

        with patch.dict(os.environ, {"RATE_LIMIT_BACKEND": "redis", "REDIS_URL": "redis://localhost:6379/0"}):
            with TestClient(app, base_url="http://localhost") as client:
                with patch.object(client.app.state.redis, "ping", new_callable=AsyncMock, return_value=True), \
                     patch("app.main.get_connection", return_value=Connection()):
                    self.assertEqual(client.get("/health/ready").json(), {"status": "ready"})
                with patch.object(client.app.state.redis, "ping", new_callable=AsyncMock, return_value=True), \
                     patch("app.main.get_connection", side_effect=RuntimeError("secret")):
                    response = client.get("/health/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "not_ready"})
        self.assertNotIn("secret", response.text)


if __name__ == "__main__":
    unittest.main()
