# Nexora AI

Nexora AI is a Next.js frontend and FastAPI backend for an AI assisted IT helpdesk. The backend uses PostgreSQL, Redis for shared rate limits, and Gemini through Google ADK.

## Requirements

- Python 3.12 or newer (use the project-local `backend/.venv` when available)
- Node.js 22 and npm
- PostgreSQL with the Nexora schema already provisioned
- Redis 7 or a compatible Redis service for production or multi-worker deployments
- A Google AI API key

The backend does not run SQL migrations at startup. Review and apply the existing SQL scripts through your normal database change process before connecting a new database. No startup command resets or migrates a database.

## Local setup

Create the backend environment file only if it does not already exist, then edit it locally:

```powershell
if (!(Test-Path backend/app/.env)) { Copy-Item backend/app/.env.example backend/app/.env }
```

Set `GOOGLE_API_KEY`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `REDIS_URL` in `backend/app/.env`. For local HTTP development, keep `APP_ENV=development`, `AUTH_COOKIE_SECURE=false`, and `DB_SSLMODE=disable`. The backend reads this file without overriding variables already set in the process environment.

The local example selects memory rate limiting with one backend worker, so Redis is not needed. Run the backend from the `backend` directory:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8080
```

In another terminal, start the frontend:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

The frontend defaults to `http://localhost:8080/api`. To change it, set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` (copy from `frontend/.env.example`). This value is public configuration; never put secrets in a `NEXT_PUBLIC_` variable.

## Local production-like Compose stack

Copy the sample root environment file only when `.env` does not already exist, then edit all placeholder values:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up --build
```

Open `http://localhost:3000`; the API is at `http://localhost:8080`. Postgres and Redis data use named volumes. The Compose Postgres service starts with an empty persistent database and does not run migrations; the backend readiness endpoint will remain unavailable until the schema has been provisioned. For local HTTP only, Compose disables the Secure cookie flag. Do not reuse this setting for a public deployment.

Stop the services with `docker compose down`. This preserves database and Redis volumes. `docker compose down -v` deletes persistent volumes and should only be used when you intentionally want to discard that local data.

## Configuration reference

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | `development`, `test`, or `production` |
| `GOOGLE_API_KEY` | Gemini credential, backend only |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL connection |
| `DB_SSLMODE` | `disable` for local PostgreSQL; production defaults to `require` |
| `DB_CONNECT_TIMEOUT` | Connection timeout in seconds, 1–30 |
| `FRONTEND_ORIGINS` | Comma separated explicit browser origins; wildcard is rejected |
| `AUTH_COOKIE_SECURE` | Must be true in production; false is allowed only on localhost in development |
| `AUTH_SESSION_TTL_HOURS` | Session lifetime, 1–720 hours |
| `RATE_LIMIT_BACKEND` | `memory` for one local development worker; `redis` for production and multiple workers |
| `WEB_CONCURRENCY` | Declared ASGI worker count; memory rate limiting requires exactly `1` |
| `REDIS_URL` | Shared Redis connection when `RATE_LIMIT_BACKEND=redis`; supports authenticated/TLS Redis URLs |
| `NEXT_PUBLIC_API_URL` | Public browser API URL only; never a credential |

Auth endpoints allow 10 requests per minute per client IP; chat and classification allow 20 per minute per client IP. Local development defaults to the process-local memory backend and one worker, so Redis does not need to be running. Memory counters are local to one process and are rejected in production and when `WEB_CONCURRENCY` is greater than one. Production requires `RATE_LIMIT_BACKEND=redis`; Redis counters use atomic operations and are shared across workers and instances. Redis failures return HTTP 503 and never fall back to memory. Configure trusted proxy forwarding at the ASGI server or enforce per-client limits at the edge; do not trust arbitrary client-supplied forwarding headers.

Production deployment must provide TLS, a managed or persistent PostgreSQL service with an already provisioned schema, a shared Redis service, `RATE_LIMIT_BACKEND=redis`, explicit HTTPS frontend origins, secure cookie settings, and secret injection through the hosting platform. Choose and configure a trusted reverse proxy before enabling forwarded client addresses. No external deployment target is assumed here.

## Health endpoints

- `GET /health` and `GET /health/live`: process liveness
- `GET /health/ready`: checks PostgreSQL and, when selected, Redis connectivity; returns 503 when a required dependency is unavailable

## Checks

Backend isolated tests (fake databases; no existing database records are touched):

```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m compileall -q app tests
.\.venv\Scripts\python.exe -m pip check
```

Frontend checks:

```powershell
cd frontend
npm.cmd run lint
npm.cmd run build
```

The test suite uses in-memory database fakes and does not connect to `deskpilot_db`.
