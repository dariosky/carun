import re
import secrets
from datetime import datetime
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, Request, status
from sqlmodel import Session, select

from .config import get_settings
from .models import User

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo"


def validate_google_oauth_config() -> None:
    settings = get_settings()
    if not settings.google_client_id.strip():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth misconfigured: GOOGLE_CLIENT_ID is missing",
        )
    if not settings.google_client_secret.strip():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth misconfigured: GOOGLE_CLIENT_SECRET is missing",
        )
    if not settings.google_redirect_uri.strip():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth misconfigured: GOOGLE_REDIRECT_URI is missing",
        )


def sanitize_display_name(raw: str | None) -> str:
    if not isinstance(raw, str):
        return "PLAYER"
    cleaned = re.sub(r"[^A-Z0-9 ]", "", raw.upper()).strip()[:12]
    return cleaned or "PLAYER"


def build_unique_display_name(session: Session, base_name: str, exclude_user_id=None) -> str:
    normalized_base = sanitize_display_name(base_name)
    existing_rows = session.exec(select(User.id, User.display_name)).all()
    taken = set()
    for row in existing_rows:
        user_id = row[0]
        display_name = row[1]
        if exclude_user_id is not None and user_id == exclude_user_id:
            continue
        taken.add(display_name)

    if normalized_base not in taken:
        return normalized_base

    suffix = 2
    while suffix < 100000:
        suffix_text = str(suffix)
        trimmed_base = normalized_base[: max(1, 12 - len(suffix_text))]
        candidate = f"{trimmed_base}{suffix_text}"
        if candidate not in taken:
            return candidate
        suffix += 1

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Could not allocate unique display name",
    )


def build_google_login_url(request: Request) -> str:
    settings = get_settings()
    validate_google_oauth_config()
    state = secrets.token_urlsafe(24)
    request.session["oauth_state"] = state

    query = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "consent",
    }
    return f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(query)}"


async def exchange_code_for_userinfo(code: str) -> dict:
    settings = get_settings()
    validate_google_oauth_config()
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_res = await client.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )

        if token_res.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token exchange failed"
            )

        access_token = token_res.json().get("access_token")
        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="No Google access token"
            )

        user_res = await client.get(
            GOOGLE_USERINFO_ENDPOINT,
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if user_res.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Google userinfo fetch failed"
            )

        return user_res.json()


def upsert_user_from_google(session: Session, payload: dict) -> User:
    google_sub = payload.get("sub")
    if not google_sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Google payload missing sub"
        )

    display_name = payload.get("name") or payload.get("email") or "Carun Player"
    email = payload.get("email")

    user = session.exec(select(User).where(User.google_sub == google_sub)).first()
    if user:
        user.email = email
        user.updated_at = datetime.utcnow()
    else:
        unique_name = build_unique_display_name(session, display_name)
        user = User(google_sub=google_sub, display_name=unique_name, email=email)
        session.add(user)

    session.commit()
    session.refresh(user)
    return user


def update_user_display_name(session: Session, user: User, raw_display_name: str) -> User:
    next_name = build_unique_display_name(session, raw_display_name, exclude_user_id=user.id)
    user.display_name = next_name
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
