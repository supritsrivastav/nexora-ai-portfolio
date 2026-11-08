import unittest
from datetime import datetime, timezone
from uuid import UUID
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.auth import AuthenticatedUser, get_current_user
from app.main import app


USER_A = UUID("10000000-0000-0000-0000-000000000001")
USER_B = UUID("20000000-0000-0000-0000-000000000002")


class TicketDatabase:
    """Small in-memory SQL fake; tests never connect to the configured database."""

    def __init__(self):
        self.rows = [
            (1, "DP-LEGACY", "demo_user", "legacy issue", "Other", "Low",
             "Minor", "legacy", "Open", datetime.now(timezone.utc), None),
            (8, "DP-USER-A", str(USER_A), "A issue", "Other", "High",
             "Major", "A summary", "Open", datetime.now(timezone.utc), USER_A),
            (9, "DP-USER-B", str(USER_B), "B issue", "Software", "Low",
             "Minor", "B summary", "Resolved", datetime.now(timezone.utc), USER_B),
        ]
        self.next_id = 10

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return TicketCursor(self)


class TicketCursor:
    def __init__(self, db):
        self.db = db
        self.result = None
        self.results = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split()).lower()
        if normalized.startswith("insert into support_tickets"):
            number, user_id, issue, category, priority, severity, summary, owner = params
            row = (self.db.next_id, number, user_id, issue, category, priority,
                   severity, summary, "Open", datetime.now(timezone.utc), owner)
            self.db.next_id += 1
            self.db.rows.append(row)
            self.result = (row[0], row[1], row[8], row[9])
        elif normalized.startswith("select count(*),"):
            owned = [row for row in self.db.rows if row[10] == params[0]]
            self.result = (
                len(owned),
                sum(row[8].lower() == "open" for row in owned),
                sum(row[8].lower() == "in progress" for row in owned),
                sum(row[8].lower() == "resolved" for row in owned),
                sum(row[5].lower() == "high" for row in owned),
            )
        elif normalized.startswith("select count(*)"):
            self.result = (sum(row[10] == params[0] for row in self.db.rows),)
        elif normalized.startswith("select id, ticket_number"):
            if "where id = %s and owner_user_id = %s" in normalized:
                row = next(
                    (r for r in self.db.rows if r[0] == params[0] and r[10] == params[1]),
                    None,
                )
                self.result = row[:10] if row else None
            else:
                owner, limit, offset = params
                rows = [r for r in self.db.rows if r[10] == owner]
                rows.sort(key=lambda r: (r[9] is not None, r[9], r[0]), reverse=True)
                self.results = [r[:10] for r in rows[offset:offset + limit]]
        elif normalized.startswith("update support_tickets"):
            status, ticket_id, owner = params
            row = next((r for r in self.db.rows if r[0] == ticket_id and r[10] == owner), None)
            if row:
                updated = row[:8] + (status,) + row[9:]
                self.db.rows[self.db.rows.index(row)] = updated
                self.result = updated[:10]
            else:
                self.result = None
        else:
            raise AssertionError(f"Unexpected SQL: {sql}")

    def fetchone(self):
        return self.result

    def fetchall(self):
        return self.results


def auth_user(user_id):
    return AuthenticatedUser(
        id=user_id, email=f"{user_id}@example.com", display_name="Test",
        created_at=datetime.now(timezone.utc),
    )


class TicketOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.db = TicketDatabase()
        self.connection_patch = patch("app.api.tickets.get_connection", lambda: self.db)
        self.connection_patch.start()
        self.rate_limit_patch = patch(
            "app.core.rate_limit.enforce_rate_limit", new_callable=AsyncMock
        )
        self.rate_limit_patch.start()
        self.client = TestClient(app, base_url="http://localhost")

    def tearDown(self):
        self.client.close()
        self.connection_patch.stop()
        self.rate_limit_patch.stop()
        app.dependency_overrides.pop(get_current_user, None)

    def as_user(self, user_id):
        app.dependency_overrides[get_current_user] = lambda: auth_user(user_id)

    def create(self, spoofed="attacker"):
        return self.client.post("/api/tickets", json={
            "user_id": spoofed, "issue": "test", "category": "Other",
            "priority": "High", "severity": "Major", "summary": "test",
        })

    def test_all_protected_routes_reject_anonymous_requests(self):
        requests = [
            self.client.post("/api/chat", json={"message": "hello", "user_id": "fake"}),
            self.client.post("/api/classify", json={"issue": "broken", "user_id": "fake"}),
            self.client.post("/api/tickets", json={"issue": "x", "category": "x", "priority": "x", "severity": "x", "summary": "x"}),
            self.client.get("/api/tickets"), self.client.get("/api/tickets/stats"),
            self.client.get("/api/tickets/1"),
            self.client.patch("/api/tickets/1/status", json={"status": "Resolved"}),
        ]
        self.assertEqual([r.status_code for r in requests], [401] * len(requests))

    def test_each_user_can_read_only_their_own_ticket(self):
        self.as_user(USER_A)
        ticket_a = self.client.get("/api/tickets/8")
        self.assertEqual(ticket_a.status_code, 200)
        self.assertEqual(ticket_a.json()["requester"], {
            "display_name": "Test", "email": f"{USER_A}@example.com",
        })
        self.assertNotIn(f"{USER_B}@example.com", ticket_a.text)
        self.assertEqual(self.client.get("/api/tickets/9").status_code, 404)
        a_list = self.client.get("/api/tickets").json()
        self.assertEqual([item["id"] for item in a_list["tickets"]], [8])
        self.assertEqual(a_list["pagination"]["total"], 1)
        self.assertEqual(self.client.get("/api/tickets/stats").json(), {
            "total": 1, "open": 1, "in_progress": 0,
            "resolved": 0, "high_priority": 1,
        })

        self.as_user(USER_B)
        ticket_b = self.client.get("/api/tickets/9")
        self.assertEqual(ticket_b.status_code, 200)
        self.assertEqual(ticket_b.json()["requester"], {
            "display_name": "Test", "email": f"{USER_B}@example.com",
        })
        self.assertNotIn(f"{USER_A}@example.com", ticket_b.text)
        self.assertEqual(self.client.get("/api/tickets/8").status_code, 404)
        b_list = self.client.get("/api/tickets").json()
        self.assertEqual([item["id"] for item in b_list["tickets"]], [9])
        self.assertEqual(b_list["pagination"]["total"], 1)
        self.assertEqual(self.client.get("/api/tickets/stats").json(), {
            "total": 1, "open": 0, "in_progress": 0,
            "resolved": 1, "high_priority": 0,
        })

    def test_users_cannot_update_each_others_tickets(self):
        before_a = next(row for row in self.db.rows if row[0] == 8)
        before_b = next(row for row in self.db.rows if row[0] == 9)
        self.as_user(USER_A)
        denied_b = self.client.patch("/api/tickets/9/status", json={"status": "Resolved"})
        self.assertEqual(denied_b.status_code, 404)
        self.as_user(USER_B)
        denied_a = self.client.patch("/api/tickets/8/status", json={"status": "In Progress"})
        self.assertEqual(denied_a.status_code, 404)
        self.assertEqual(next(row for row in self.db.rows if row[0] == 8), before_a)
        self.assertEqual(next(row for row in self.db.rows if row[0] == 9), before_b)

    def test_authenticated_user_can_update_their_own_ticket(self):
        self.as_user(USER_A)
        updated = self.client.patch("/api/tickets/8/status", json={"status": "Resolved"})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["status"], "Resolved")

    def test_ticket_creation_ignores_spoofed_user_id(self):
        self.as_user(USER_B)
        created = self.create(spoofed=str(USER_A))
        self.assertEqual(created.status_code, 200)
        ticket_id = created.json()["ticket"]["id"]
        stored = next(row for row in self.db.rows if row[0] == ticket_id)
        self.assertEqual(stored[2], str(USER_B))
        self.assertEqual(stored[10], USER_B)

    def test_legacy_tickets_stay_unchanged_and_unassigned(self):
        original = self.db.rows[0]
        self.as_user(USER_A)
        self.assertNotIn(1, [row["id"] for row in self.client.get("/api/tickets").json()["tickets"]])
        self.assertEqual(self.client.get("/api/tickets/1").status_code, 404)
        self.assertEqual(self.client.get("/api/tickets/stats").json()["total"], 1)
        self.assertEqual(self.db.rows[0], original)

    def test_chat_and_classification_use_authenticated_identity(self):
        self.as_user(USER_A)
        classification = '{"category":"Other","priority":"Low","severity":"Minor","summary":"ok"}'
        with patch(
            "app.api.chat.run_agent",
            new_callable=AsyncMock,
            return_value=classification,
        ) as run_agent:
            chat_response = self.client.post("/api/chat", json={"message": "hello", "user_id": "spoofed"})
            self.assertEqual(chat_response.status_code, 200)
            self.assertEqual(run_agent.await_args.args[1], str(USER_A))
            classify_response = self.client.post("/api/classify", json={"issue": "broken", "user_id": "spoofed"})
            self.assertEqual(classify_response.status_code, 200)
            self.assertEqual(run_agent.await_args.args[1], str(USER_A))

    def test_ai_internal_errors_are_not_returned_to_clients(self):
        self.as_user(USER_A)
        with patch(
            "app.api.chat.run_agent",
            new_callable=AsyncMock,
            side_effect=RuntimeError("internal-token-value"),
        ):
            response = self.client.post("/api/chat", json={"message": "hello"})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("internal-token-value", response.text)
        self.assertEqual(response.json()["detail"], "AI service is temporarily unavailable.")

    def test_database_internal_errors_are_not_returned_to_clients(self):
        self.as_user(USER_A)
        with patch(
            "app.api.tickets.get_connection",
            side_effect=RuntimeError("database-password-value"),
        ):
            response = self.create()
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("database-password-value", response.text)
        self.assertEqual(response.json()["detail"], "Unable to create support ticket.")


if __name__ == "__main__":
    unittest.main()
