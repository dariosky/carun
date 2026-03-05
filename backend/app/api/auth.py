from datetime import datetime
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlmodel import Session

from ..auth_utils import (
    build_facebook_login_url,
    build_google_login_url,
    exchange_facebook_code_for_userinfo,
    exchange_google_code_for_userinfo,
    pop_oauth_state,
    update_user_display_name,
    upsert_user_from_oauth,
)
from ..db import get_session
from ..deps import get_current_user
from ..models import User
from ..schemas import AuthDisplayNameUpdateRequest, AuthMeResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me", response_model=AuthMeResponse)
def me(request: Request, session: Session = Depends(get_session)):
    user_id = request.session.get("user_id")
    if not user_id:
        return AuthMeResponse(authenticated=False)

    try:
        user_uuid = UUID(str(user_id))
    except ValueError:
        request.session.clear()
        return AuthMeResponse(authenticated=False)

    user = session.get(User, user_uuid)
    if not user:
        request.session.clear()
        return AuthMeResponse(authenticated=False)

    now = datetime.utcnow()
    user.last_seen = now
    user.updated_at = now
    session.add(user)
    session.commit()

    request.session["display_name"] = user.display_name
    request.session["is_admin"] = user.is_admin
    return AuthMeResponse(
        authenticated=True,
        user_id=str(user.id),
        display_name=user.display_name,
        is_admin=user.is_admin,
    )


@router.get("/google/login")
def google_login(request: Request):
    return RedirectResponse(build_google_login_url(request), status_code=302)


@router.get("/google/callback")
async def google_callback(
    request: Request, code: str, state: str, session: Session = Depends(get_session)
):
    expected_state = pop_oauth_state(request, "google")
    if not expected_state or expected_state != state:
        other_state = request.session.get("oauth_state_facebook")
        if other_state and other_state == state:
            query = urlencode({"code": code, "state": state})
            return RedirectResponse(f"/api/auth/facebook/callback?{query}", status_code=302)
        return RedirectResponse("/?auth=failed", status_code=302)

    payload = await exchange_google_code_for_userinfo(code)
    user = upsert_user_from_oauth(session, "google", payload)

    request.session["user_id"] = str(user.id)
    request.session["display_name"] = user.display_name
    request.session["is_admin"] = user.is_admin
    return RedirectResponse("/?auth=ok", status_code=302)


@router.get("/facebook/login")
def facebook_login(request: Request):
    return RedirectResponse(build_facebook_login_url(request), status_code=302)


@router.get("/facebook/callback")
async def facebook_callback(
    request: Request, code: str, state: str, session: Session = Depends(get_session)
):
    expected_state = pop_oauth_state(request, "facebook")
    if not expected_state or expected_state != state:
        other_state = request.session.get("oauth_state_google")
        if other_state and other_state == state:
            query = urlencode({"code": code, "state": state})
            return RedirectResponse(f"/api/auth/google/callback?{query}", status_code=302)
        return RedirectResponse("/?auth=failed", status_code=302)

    payload = await exchange_facebook_code_for_userinfo(code)
    user = upsert_user_from_oauth(session, "facebook", payload)

    request.session["user_id"] = str(user.id)
    request.session["display_name"] = user.display_name
    request.session["is_admin"] = user.is_admin
    return RedirectResponse("/?auth=ok", status_code=302)


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.patch("/display-name", response_model=AuthMeResponse)
def set_display_name(
    payload: AuthDisplayNameUpdateRequest,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    updated_user = update_user_display_name(session, current_user, payload.display_name)
    request.session["display_name"] = updated_user.display_name
    return AuthMeResponse(
        authenticated=True,
        user_id=str(updated_user.id),
        display_name=updated_user.display_name,
        is_admin=updated_user.is_admin,
    )
