import os
import unittest
from unittest.mock import patch

from app.core import config


class ConfigurationTests(unittest.TestCase):
    def test_origins_are_explicit_and_wildcards_are_rejected(self):
        with patch.dict(os.environ, {"FRONTEND_ORIGINS": "https://app.example, https://admin.example/"}):
            self.assertEqual(
                config.get_frontend_origins(),
                ("https://app.example", "https://admin.example"),
            )
        with patch.dict(os.environ, {"FRONTEND_ORIGINS": "*"}):
            with self.assertRaises(RuntimeError):
                config.get_frontend_origins()

    def test_session_ttl_is_bounded(self):
        with patch.dict(os.environ, {"AUTH_SESSION_TTL_HOURS": "12"}):
            self.assertEqual(config.get_session_ttl_seconds(), 12 * 60 * 60)
        with patch.dict(os.environ, {"AUTH_SESSION_TTL_HOURS": "0"}):
            with self.assertRaises(RuntimeError):
                config.get_session_ttl_seconds()

    def test_secure_cookie_cannot_be_disabled_in_production(self):
        with patch.dict(os.environ, {"APP_ENV": "production", "AUTH_COOKIE_SECURE": "false"}):
            with self.assertRaises(RuntimeError):
                config.session_cookie_is_secure("app.example")

    def test_production_requires_credentials_without_echoing_values(self):
        values = {
            "DB_HOST": "db.example",
            "DB_PORT": "5432",
            "DB_NAME": "app",
            "DB_USER": "app",
            "DB_PASSWORD": "test-secret-value",
            "GOOGLE_API_KEY": "test-api-key",
            "REDIS_URL": "redis://cache:6379/0",
            "FRONTEND_ORIGINS": "https://app.example",
            "AUTH_SESSION_TTL_HOURS": "12",
            "AUTH_COOKIE_SECURE": "true",
        }
        with patch.dict(os.environ, values, clear=True), patch.object(config, "APP_ENV", "production"):
            config.validate_settings()
        missing = dict(values)
        del missing["DB_PASSWORD"]
        with patch.dict(os.environ, missing, clear=True), patch.object(config, "APP_ENV", "production"):
            with self.assertRaisesRegex(RuntimeError, "DB_PASSWORD") as error:
                config.validate_settings()
            self.assertNotIn("test-secret-value", str(error.exception))

    def test_development_memory_backend_requires_one_worker(self):
        with patch.dict(os.environ, {"RATE_LIMIT_BACKEND": "memory", "WEB_CONCURRENCY": "1"}), \
             patch.object(config, "APP_ENV", "development"):
            config.validate_settings()
        with patch.dict(os.environ, {"RATE_LIMIT_BACKEND": "memory", "WEB_CONCURRENCY": "2"}), \
             patch.object(config, "APP_ENV", "development"):
            with self.assertRaisesRegex(RuntimeError, "WEB_CONCURRENCY=1"):
                config.validate_settings()

    def test_production_rejects_memory_without_falling_back(self):
        values = {
            "DB_HOST": "db.example", "DB_PORT": "5432", "DB_NAME": "app",
            "DB_USER": "app", "DB_PASSWORD": "test-secret-value",
            "GOOGLE_API_KEY": "test-api-key", "FRONTEND_ORIGINS": "https://app.example",
            "AUTH_SESSION_TTL_HOURS": "12", "AUTH_COOKIE_SECURE": "true",
            "DB_SSLMODE": "require", "RATE_LIMIT_BACKEND": "memory",
        }
        with patch.dict(os.environ, values, clear=True), patch.object(config, "APP_ENV", "production"):
            with self.assertRaisesRegex(RuntimeError, "memory rate-limit backend"):
                config.validate_settings()

    def test_redis_backend_validates_its_url(self):
        values = {
            "DB_HOST": "db.example", "DB_PORT": "5432", "DB_NAME": "app",
            "DB_USER": "app", "DB_PASSWORD": "test-secret-value",
            "GOOGLE_API_KEY": "test-api-key", "FRONTEND_ORIGINS": "https://app.example",
            "AUTH_SESSION_TTL_HOURS": "12", "AUTH_COOKIE_SECURE": "true",
            "DB_SSLMODE": "require", "RATE_LIMIT_BACKEND": "redis",
            "REDIS_URL": "https://cache.example",
        }
        with patch.dict(os.environ, values, clear=True), patch.object(config, "APP_ENV", "production"):
            with self.assertRaisesRegex(RuntimeError, "REDIS_URL"):
                config.validate_settings()


if __name__ == "__main__":
    unittest.main()
