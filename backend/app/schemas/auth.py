import re
import unicodedata
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


_LOCAL_PART = re.compile(r"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$")
_DOMAIN_LABEL = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")


def normalize_email(email: str) -> str:
    return unicodedata.normalize("NFKC", email.strip()).casefold()


def validate_email_address(email: str) -> str:
    value = unicodedata.normalize("NFKC", email.strip())
    if len(value) > 320 or value.count("@") != 1:
        raise ValueError("Enter a valid email address.")

    local_part, domain = value.rsplit("@", 1)
    if not local_part or len(local_part) > 64 or not _LOCAL_PART.fullmatch(local_part):
        raise ValueError("Enter a valid email address.")

    try:
        ascii_domain = domain.encode("idna").decode("ascii")
    except UnicodeError as error:
        raise ValueError("Enter a valid email address.") from error

    labels = ascii_domain.split(".")
    if (
        len(labels) < 2
        or any(not _DOMAIN_LABEL.fullmatch(label) for label in labels)
        or len(labels[-1]) < 2
    ):
        raise ValueError("Enter a valid email address.")
    return value


class SignupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(max_length=320)
    password: SecretStr = Field(min_length=12, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return validate_email_address(value)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        return value


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(max_length=320)
    password: SecretStr = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return validate_email_address(value)


class PublicUser(BaseModel):
    id: UUID
    email: str
    display_name: str | None
    created_at: datetime


class AuthResponse(BaseModel):
    user: PublicUser
