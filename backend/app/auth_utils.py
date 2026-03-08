import re
import secrets
from datetime import datetime
from typing import Literal
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func
from sqlmodel import Session, select

from .config import get_settings
from .models import User

Provider = Literal["google", "facebook"]

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo"

FACEBOOK_AUTH_ENDPOINT = "https://www.facebook.com/v20.0/dialog/oauth"
FACEBOOK_TOKEN_ENDPOINT = "https://graph.facebook.com/v20.0/oauth/access_token"
FACEBOOK_USERINFO_ENDPOINT = "https://graph.facebook.com/v20.0/me"


def _normalize_email(raw: str | None) -> str | None:
    if not isinstance(raw, str):
        return None
    email = raw.strip().lower()
    return email or None


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


def validate_facebook_oauth_config() -> None:
    settings = get_settings()
    if not settings.facebook_client_id.strip():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Facebook OAuth misconfigured: FACEBOOK_CLIENT_ID is missing",
        )
    if not settings.facebook_client_secret.strip():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Facebook OAuth misconfigured: FACEBOOK_CLIENT_SECRET is missing",
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


def _store_oauth_state(request: Request, provider: Provider) -> str:
    state = secrets.token_urlsafe(24)
    request.session[f"oauth_state_{provider}"] = state
    return state


def pop_oauth_state(request: Request, provider: Provider) -> str | None:
    key = f"oauth_state_{provider}"
    value = request.session.get(key)
    request.session.pop(key, None)
    return value


def _oauth_redirect_uri(request: Request, provider: Provider) -> str:
    settings = get_settings()
    configured = (
        settings.google_redirect_uri if provider == "google" else settings.facebook_redirect_uri
    ).strip()
    if configured:
        return configured

    route_name = "google_callback" if provider == "google" else "facebook_callback"
    return str(request.url_for(route_name))


def oauth_redirect_uri(request: Request, provider: Provider) -> str:
    return _oauth_redirect_uri(request, provider)


def canonicalize_local_oauth_request(request: Request) -> RedirectResponse | None:
    if request.url.hostname != "127.0.0.1":
        return None

    canonical_url = request.url.replace(netloc=f"localhost:{request.url.port}")
    return RedirectResponse(str(canonical_url), status_code=302)


def build_google_login_url(request: Request) -> str:
    settings = get_settings()
    validate_google_oauth_config()
    state = _store_oauth_state(request, "google")
    redirect_uri = _oauth_redirect_uri(request, "google")

    query = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "consent",
    }
    return f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(query)}"


def build_facebook_login_url(request: Request) -> str:
    settings = get_settings()
    validate_facebook_oauth_config()
    state = _store_oauth_state(request, "facebook")
    redirect_uri = _oauth_redirect_uri(request, "facebook")

    query = {
        "client_id": settings.facebook_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "email,public_profile",
        "state": state,
    }
    return f"{FACEBOOK_AUTH_ENDPOINT}?{urlencode(query)}"


async def exchange_google_code_for_userinfo(code: str, redirect_uri: str) -> dict:
    settings = get_settings()
    validate_google_oauth_config()
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_res = await client.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
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


async def exchange_facebook_code_for_userinfo(code: str, redirect_uri: str) -> dict:
    settings = get_settings()
    validate_facebook_oauth_config()
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_res = await client.get(
            FACEBOOK_TOKEN_ENDPOINT,
            params={
                "client_id": settings.facebook_client_id,
                "client_secret": settings.facebook_client_secret,
                "redirect_uri": redirect_uri,
                "code": code,
            },
        )

        if token_res.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Facebook token exchange failed"
            )

        access_token = token_res.json().get("access_token")
        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="No Facebook access token"
            )

        user_res = await client.get(
            FACEBOOK_USERINFO_ENDPOINT,
            params={
                "fields": "id,name,email",
                "access_token": access_token,
            },
        )

        if user_res.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Facebook userinfo fetch failed"
            )

        return user_res.json()


def _provider_sub_field(provider: Provider) -> str:
    return "google_sub" if provider == "google" else "facebook_sub"


def upsert_user_from_oauth(session: Session, provider: Provider, payload: dict) -> User:
    provider_sub_field = _provider_sub_field(provider)
    provider_sub_key = "sub" if provider == "google" else "id"
    provider_sub = payload.get(provider_sub_key)
    if not provider_sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"{provider.title()} payload missing {provider_sub_key}",
        )

    display_name = payload.get("name") or payload.get("email") or "Carun Player"
    email = _normalize_email(payload.get("email"))

    if provider == "facebook" and not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Facebook payload missing email",
        )

    provider_col = getattr(User, provider_sub_field)
    user = session.exec(select(User).where(provider_col == provider_sub)).first()

    if not user and email:
        user = session.exec(select(User).where(func.lower(User.email) == email)).first()

    now = datetime.utcnow()
    if user:
        setattr(user, provider_sub_field, provider_sub)
        user.email = email
        user.last_seen = now
        user.updated_at = now
    else:
        unique_name = build_unique_display_name(session, display_name)
        user = User(
            display_name=unique_name,
            email=email,
            last_seen=now,
            **{provider_sub_field: provider_sub},
        )
        session.add(user)

    session.commit()
    session.refresh(user)
    return user


def upsert_user_from_google(session: Session, payload: dict) -> User:
    return upsert_user_from_oauth(session, "google", payload)


def update_user_display_name(session: Session, user: User, raw_display_name: str) -> User:
    next_name = build_unique_display_name(session, raw_display_name, exclude_user_id=user.id)
    user.display_name = next_name
    user.updated_at = datetime.utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
