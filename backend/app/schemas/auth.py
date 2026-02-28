from pydantic import BaseModel


class AuthMeResponse(BaseModel):
    authenticated: bool
    user_id: str | None = None
    display_name: str | None = None
