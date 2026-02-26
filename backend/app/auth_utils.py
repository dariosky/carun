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


def build_google_login_url(request: Request) -> str:
    settings = get_settings()
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
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token exchange failed")

        access_token = token_res.json().get("access_token")
        if not access_token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No Google access token")

        user_res = await client.get(
            GOOGLE_USERINFO_ENDPOINT,
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if user_res.status_code != 200:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google userinfo fetch failed")

        return user_res.json()


def upsert_user_from_google(session: Session, payload: dict) -> User:
    google_sub = payload.get("sub")
    if not google_sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google payload missing sub")

    display_name = payload.get("name") or payload.get("email") or "Carun Player"
    email = payload.get("email")

    user = session.exec(select(User).where(User.google_sub == google_sub)).first()
    if user:
        user.display_name = display_name
        user.email = email
        user.updated_at = datetime.utcnow()
    else:
        user = User(google_sub=google_sub, display_name=display_name, email=email)
        session.add(user)

    session.commit()
    session.refresh(user)
    return user
