
import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.agents.deskpilot_agent import root_agent
from app.core.auth import AuthenticatedUser, get_current_user
from app.core.rate_limit import ai_rate_limit


router = APIRouter()
logger = logging.getLogger(__name__)

APP_NAME = "deskpilot_ai"
session_service = InMemorySessionService()

runner = Runner(
    agent=root_agent,
    app_name=APP_NAME,
    session_service=session_service,
)


class ChatRequest(BaseModel):
    message: str
    user_id: str = "demo_user"


class ClassifyRequest(BaseModel):
    issue: str
    user_id: str = "demo_user"


async def run_agent(message: str, user_id: str) -> str:
    session = await session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
    )

    content = types.Content(
        role="user",
        parts=[types.Part(text=message)],
    )

    response_text = ""

    async for event in runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=content,
    ):
        if event.is_final_response() and event.content:
            response_text = "".join(
                part.text or ""
                for part in event.content.parts
                if part.text
            )

    return response_text


@router.post("/chat", dependencies=[Depends(ai_rate_limit)])
async def chat(request: ChatRequest, current_user: AuthenticatedUser = Depends(get_current_user)):
    try:
        response_text = await run_agent(
            request.message,
            str(current_user.id),
        )

        return {"response": response_text}

    except Exception:
        logger.exception("AI chat request failed")
        raise HTTPException(status_code=502, detail="AI service is temporarily unavailable.")


@router.post("/classify", dependencies=[Depends(ai_rate_limit)])
async def classify_ticket(request: ClassifyRequest, current_user: AuthenticatedUser = Depends(get_current_user)):
    try:
        prompt = f"""
        You are an IT Helpdesk Ticket Classification Engine.

        Analyse the following IT issue and classify it.

        IT ISSUE:
        {request.issue}

        Return ONLY a valid JSON object.
        Do not include Markdown or explanations outside JSON.

        Use this exact structure:

        {{
            "category": "Network",
            "priority": "High",
            "severity": "Major",
            "summary": "Short description of the issue"
        }}

        Classification rules:

        Category must be one of:
        Hardware, Software, Network, Security, Access, Other.

        Priority must be one of:
        Low, Medium, High, Critical.

        Severity must be one of:
        Minor, Moderate, Major, Critical.

        Base classification only on the information provided.
        Do not invent missing details.
        If information is insufficient, use reasonable conservative
        defaults and mention uncertainty in the summary.
        """

        response_text = await run_agent(
            prompt,
            str(current_user.id),
        )

        # Extract JSON if the model adds extra formatting.
        match = re.search(r"\{.*\}", response_text, re.DOTALL)

        if not match:
            raise ValueError("AI did not return valid JSON.")

        classification = json.loads(match.group())

        allowed_categories = {
            "Hardware", "Software", "Network",
            "Security", "Access", "Other"
        }

        allowed_priorities = {
            "Low", "Medium", "High", "Critical"
        }

        allowed_severities = {
            "Minor", "Moderate", "Major", "Critical"
        }

        if classification.get("category") not in allowed_categories:
            raise ValueError("Invalid category returned by AI.")

        if classification.get("priority") not in allowed_priorities:
            raise ValueError("Invalid priority returned by AI.")

        if classification.get("severity") not in allowed_severities:
            raise ValueError("Invalid severity returned by AI.")

        if not isinstance(classification.get("summary"), str):
            raise ValueError("Invalid summary returned by AI.")

        return {
            "status": "success",
            "ticket": classification,
        }

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=502,
            detail="AI returned an invalid JSON response."
        )

    except ValueError as e:
        logger.warning("AI classification returned invalid output")
        raise HTTPException(status_code=502, detail="AI returned an invalid classification.") from e

    except Exception:
        logger.exception("AI classification request failed")
        raise HTTPException(status_code=502, detail="AI service is temporarily unavailable.")
