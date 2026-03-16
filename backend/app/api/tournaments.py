from __future__ import annotations

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)

from ..schemas.tournaments import (
    TournamentCreateRequest,
    TournamentJoinRequest,
    TournamentRoomResponse,
    TournamentSessionResponse,
)
from ..tournament_rooms import TournamentRoomStore

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])


def get_room_store(request: Request) -> TournamentRoomStore:
    return request.app.state.tournament_room_store


def _room_response(room) -> TournamentRoomResponse:
    return TournamentRoomResponse.model_validate(room.to_dict())


@router.post("", response_model=TournamentSessionResponse, status_code=201)
def create_tournament_room(
    payload: TournamentCreateRequest,
    store: TournamentRoomStore = Depends(get_room_store),
):
    room, participant_id = store.create_room(
        display_name=payload.display_name.strip(),
        player_color=payload.player_color.strip(),
        tracks=[track.model_dump() for track in payload.tracks],
        ai_roster=[slot.model_dump() for slot in payload.ai_roster],
    )
    return TournamentSessionResponse(
        participant_id=participant_id,
        room=_room_response(room),
    )


@router.get("/{room_id}", response_model=TournamentRoomResponse)
def get_tournament_room(
    room_id: str,
    store: TournamentRoomStore = Depends(get_room_store),
):
    room = store.get_room(room_id)
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tournament room not found"
        )
    return _room_response(room)


@router.post("/{room_id}/join", response_model=TournamentSessionResponse)
def join_tournament_room(
    room_id: str,
    payload: TournamentJoinRequest,
    store: TournamentRoomStore = Depends(get_room_store),
):
    try:
        room, participant_id = store.join_room(
            room_id,
            display_name=payload.display_name.strip(),
            player_color=payload.player_color.strip(),
            participant_id=payload.participant_id.strip() if payload.participant_id else None,
        )
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tournament room not found"
        )
    except RuntimeError as error:
        detail = (
            "Tournament room is full" if str(error) == "room_full" else "Tournament already started"
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
    return TournamentSessionResponse(
        participant_id=participant_id,
        room=_room_response(room),
    )


@router.websocket("/{room_id}/ws")
async def tournament_room_socket(websocket: WebSocket, room_id: str):
    store: TournamentRoomStore = websocket.app.state.tournament_room_store
    room = store.get_room(room_id)
    participant_id = websocket.query_params.get("participant_id", "").strip()
    if not room or not participant_id:
        await websocket.close(code=4404)
        return
    slot = next(
        (
            room_slot
            for room_slot in room.slots
            if room_slot.kind == "human" and room_slot.participant_id == participant_id
        ),
        None,
    )
    if not slot:
        await websocket.close(code=4404)
        return

    await websocket.accept()
    slot.connected = True
    sockets = websocket.app.state.tournament_room_sockets.setdefault(room_id, {})
    sockets[participant_id] = websocket

    async def broadcast(message: dict, *, exclude: str | None = None):
        stale: list[str] = []
        room_sockets = websocket.app.state.tournament_room_sockets.get(room_id, {})
        for target_id, target_socket in room_sockets.items():
            if exclude and target_id == exclude:
                continue
            try:
                await target_socket.send_json(message)
            except Exception:
                stale.append(target_id)
        for target_id in stale:
            room_sockets.pop(target_id, None)

    try:
        await websocket.send_json({"type": "room_snapshot", "room": room.to_dict()})
        await broadcast({"type": "room_snapshot", "room": room.to_dict()}, exclude=participant_id)
        while True:
            message = await websocket.receive_json()
            message_type = str(message.get("type", "")).strip()
            if message_type == "player_state":
                await broadcast(
                    {
                        "type": "player_state",
                        "participant_id": participant_id,
                        "slot_id": slot.slot_id,
                        "payload": message.get("payload", {}),
                    },
                    exclude=participant_id,
                )
                continue
            if message_type == "ai_state":
                if participant_id != room.host_participant_id:
                    continue
                await broadcast(
                    {
                        "type": "ai_state",
                        "participant_id": participant_id,
                        "payload": message.get("payload", []),
                    },
                    exclude=participant_id,
                )
                continue
            if message_type == "skid_marks":
                await broadcast(
                    {
                        "type": "skid_marks",
                        "participant_id": participant_id,
                        "payload": message.get("payload", []),
                    },
                    exclude=participant_id,
                )
                continue
            if message_type == "room_sync":
                try:
                    room = store.sync_room_state(
                        room_id,
                        participant_id=participant_id,
                        phase=message.get("phase"),
                        current_race_index=message.get("current_race_index"),
                        scores=message.get("scores"),
                        race_results=message.get("race_results"),
                    )
                except (KeyError, PermissionError):
                    continue
                await broadcast({"type": "room_snapshot", "room": room.to_dict()})
                continue
            if message_type == "pause_sync":
                try:
                    room = store.set_pause_state(
                        room_id,
                        participant_id=participant_id,
                        paused=bool(message.get("paused")),
                    )
                except (KeyError, PermissionError):
                    continue
                await broadcast({"type": "room_snapshot", "room": room.to_dict()})
                continue
            if message_type == "end_tournament":
                try:
                    room = store.end_tournament(
                        room_id,
                        participant_id=participant_id,
                    )
                except (KeyError, PermissionError):
                    continue
                await broadcast({"type": "room_snapshot", "room": room.to_dict()})
                continue
            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        room_sockets = websocket.app.state.tournament_room_sockets.get(room_id, {})
        room_sockets.pop(participant_id, None)
        room = store.disconnect_participant(room_id, participant_id)
        if room:
            await broadcast({"type": "room_snapshot", "room": room.to_dict()})
