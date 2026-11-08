
import uuid
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.database import get_connection

router = APIRouter()
logger = logging.getLogger(__name__)

TICKET_COLUMNS = (
    "id",
    "ticket_number",
    "user_id",
    "issue",
    "category",
    "priority",
    "severity",
    "summary",
    "status",
    "created_at",
)


def _ticket_from_row(row):
    return dict(zip(TICKET_COLUMNS, row))


class TicketCreate(BaseModel):
    issue: str
    user_id: str = "demo_user"
    category: str
    priority: str
    severity: str
    summary: str


class TicketStatusUpdate(BaseModel):
    status: Literal["Open", "In Progress", "Resolved"]


@router.get("/tickets")
def list_tickets(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    offset = (page - 1) * page_size

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM support_tickets WHERE owner_user_id = %s",
                    (current_user.id,),
                )
                total = cur.fetchone()[0]
                cur.execute(
                    """
                    SELECT id, ticket_number, user_id, issue, category,
                           priority, severity, summary, status, created_at
                    FROM support_tickets
                    WHERE owner_user_id = %s
                    ORDER BY created_at DESC NULLS LAST, id DESC
                    LIMIT %s OFFSET %s
                    """,
                    (current_user.id, page_size, offset),
                )
                tickets = [_ticket_from_row(row) for row in cur.fetchall()]

        return {
            "tickets": tickets,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": (total + page_size - 1) // page_size,
            },
        }
    except Exception as error:
        logger.exception("Unable to list support tickets")
        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve support tickets.",
        ) from error


@router.get("/tickets/stats")
def ticket_stats(current_user: AuthenticatedUser = Depends(get_current_user)):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COUNT(*),
                        COUNT(*) FILTER (
                            WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'open'
                        ),
                        COUNT(*) FILTER (
                            WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'in progress'
                        ),
                        COUNT(*) FILTER (
                            WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'resolved'
                        ),
                        COUNT(*) FILTER (
                            WHERE LOWER(BTRIM(COALESCE(priority, ''))) = 'high'
                        )
                    FROM support_tickets
                    WHERE owner_user_id = %s
                    """,
                    (current_user.id,),
                )
                total, open_count, in_progress, resolved, high_priority = cur.fetchone()

        return {
            "total": total,
            "open": open_count,
            "in_progress": in_progress,
            "resolved": resolved,
            "high_priority": high_priority,
        }
    except Exception as error:
        logger.exception("Unable to retrieve support ticket statistics")
        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve support ticket statistics.",
        ) from error


@router.get("/tickets/{ticket_id}")
def get_ticket(
    ticket_id: int = Path(gt=0),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, ticket_number, user_id, issue, category,
                           priority, severity, summary, status, created_at
                    FROM support_tickets
                    WHERE id = %s AND owner_user_id = %s
                    """,
                    (ticket_id, current_user.id),
                )
                ticket = cur.fetchone()

        if ticket is None:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        result = _ticket_from_row(ticket)
        # The ownership predicate above guarantees this is the authenticated
        # requester. Use the existing authenticated user lookup for their
        # public profile rather than exposing any other user's data.
        result["requester"] = {
            "display_name": current_user.display_name,
            "email": current_user.email,
        }
        return result
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Unable to retrieve support ticket %s", ticket_id)
        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve support ticket.",
        ) from error


@router.patch("/tickets/{ticket_id}/status")
def update_ticket_status(
    status_update: TicketStatusUpdate,
    ticket_id: int = Path(gt=0),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE support_tickets
                    SET status = %s
                    WHERE id = %s AND owner_user_id = %s
                    RETURNING id, ticket_number, user_id, issue, category,
                              priority, severity, summary, status, created_at
                    """,
                    (status_update.status, ticket_id, current_user.id),
                )
                ticket = cur.fetchone()

        if ticket is None:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        return _ticket_from_row(ticket)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Unable to update status for support ticket %s", ticket_id)
        raise HTTPException(
            status_code=500,
            detail="Unable to update support ticket status.",
        ) from error


@router.post("/tickets")
def create_ticket(
    ticket: TicketCreate,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    ticket_number = f"DP-{uuid.uuid4().hex[:8].upper()}"

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO support_tickets
                    (ticket_number, user_id, issue, category,
                     priority, severity, summary, owner_user_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, ticket_number, status, created_at
                    """,
                    (
                        ticket_number,
                        str(current_user.id),
                        ticket.issue,
                        ticket.category,
                        ticket.priority,
                        ticket.severity,
                        ticket.summary,
                        current_user.id,
                    ),
                )

                saved_ticket = cur.fetchone()

        return {
            "status": "success",
            "message": "Support ticket created successfully",
            "ticket": {
                "id": saved_ticket[0],
                "ticket_number": saved_ticket[1],
                "status": saved_ticket[2],
                "created_at": saved_ticket[3].isoformat(),
            },
        }

    except Exception:
        logger.exception("Unable to create support ticket")
        raise HTTPException(
            status_code=500,
            detail="Unable to create support ticket.",
        ) from None
