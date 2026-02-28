from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlmodel import Session

from ..auth_utils import build_google_login_url, exchange_code_for_userinfo, upsert_user_from_google
from ..db import get_session
from ..schemas import AuthMeResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me", response_model=AuthMeResponse)
def me(request: Request):
    user_id = request.session.get("user_id")
    display_name = request.session.get("display_name")
    if not user_id:
        return AuthMeResponse(authenticated=False)
    return AuthMeResponse(authenticated=True, user_id=str(user_id), display_name=display_name)


@router.get("/google/login")
def google_login(request: Request):
    return RedirectResponse(build_google_login_url(request), status_code=302)


@router.get("/google/callback")
async def google_callback(
    request: Request, code: str, state: str, session: Session = Depends(get_session)
):
    expected_state = request.session.get("oauth_state")
    if not expected_state or expected_state != state:
        return RedirectResponse("/?auth=failed", status_code=302)

    request.session.pop("oauth_state", None)
    payload = await exchange_code_for_userinfo(code)
    user = upsert_user_from_google(session, payload)

    request.session["user_id"] = str(user.id)
    request.session["display_name"] = user.display_name
    return RedirectResponse("/?auth=ok", status_code=302)


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}
