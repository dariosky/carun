from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal
from uuid import uuid4

RoomPhase = Literal["lobby", "racing", "standings", "final"]
SlotKind = Literal["human", "ai"]


@dataclass
class RoomTrack:
    id: str
    name: str
    track_payload_json: dict

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "track_payload_json": self.track_payload_json,
        }


@dataclass
class RoomSlot:
    slot_id: str
    kind: SlotKind
    display_name: str
    participant_id: str | None = None
    is_host: bool = False
    connected: bool = True
    color: str | None = None
    style: str | None = None
    top_speed_mul: float | None = None
    lane_offset: float | None = None
    ai_template: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "slot_id": self.slot_id,
            "kind": self.kind,
            "display_name": self.display_name,
            "participant_id": self.participant_id,
            "is_host": self.is_host,
            "connected": self.connected,
            "color": self.color,
            "style": self.style,
            "top_speed_mul": self.top_speed_mul,
            "lane_offset": self.lane_offset,
        }


@dataclass
class Room:
    id: str
    phase: RoomPhase
    paused: bool
    paused_by: str | None
    current_race_index: int
    tracks: list[RoomTrack]
    slots: list[RoomSlot]
    host_participant_id: str
    scores: dict[str, int] = field(default_factory=dict)
    race_results: list[dict[str, dict]] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "phase": self.phase,
            "paused": self.paused,
            "paused_by": self.paused_by,
            "current_race_index": self.current_race_index,
            "tracks": [track.to_dict() for track in self.tracks],
            "slots": [slot.to_dict() for slot in self.slots],
            "scores": self.scores,
            "race_results": self.race_results,
            "created_at": self.created_at.isoformat(),
        }


class TournamentRoomStore:
    def __init__(self):
        self.rooms: dict[str, Room] = {}

    def create_room(
        self,
        *,
        display_name: str,
        player_color: str,
        tracks: list[dict],
        ai_roster: list[dict],
    ) -> tuple[Room, str]:
        room_id = str(uuid4())
        participant_id = str(uuid4())
        room_tracks = [
            RoomTrack(
                id=str(track["id"]),
                name=str(track["name"]),
                track_payload_json=dict(track["track_payload_json"]),
            )
            for track in tracks
        ]
        slots = [
            RoomSlot(
                slot_id="slot-1",
                kind="human",
                display_name=display_name,
                participant_id=participant_id,
                is_host=True,
                connected=True,
                color=player_color,
            )
        ]
        for index, ai_entry in enumerate(ai_roster, start=2):
            template = {
                "display_name": str(ai_entry["name"]),
                "color": str(ai_entry["color"]),
                "style": str(ai_entry["style"]),
                "top_speed_mul": float(ai_entry["top_speed_mul"]),
                "lane_offset": float(ai_entry.get("lane_offset", 0)),
            }
            slots.append(
                RoomSlot(
                    slot_id=f"slot-{index}",
                    kind="ai",
                    display_name=template["display_name"],
                    color=template["color"],
                    style=template["style"],
                    top_speed_mul=template["top_speed_mul"],
                    lane_offset=template["lane_offset"],
                    ai_template=template,
                )
            )
        room = Room(
            id=room_id,
            phase="lobby",
            paused=False,
            paused_by=None,
            current_race_index=0,
            tracks=room_tracks,
            slots=slots,
            host_participant_id=participant_id,
        )
        self.rooms[room_id] = room
        return room, participant_id

    def get_room(self, room_id: str) -> Room | None:
        return self.rooms.get(room_id)

    def join_room(
        self,
        room_id: str,
        *,
        display_name: str,
        player_color: str,
        participant_id: str | None = None,
    ) -> tuple[Room, str]:
        room = self.rooms.get(room_id)
        if not room:
            raise KeyError("room_not_found")

        if participant_id:
            for slot in room.slots:
                if slot.participant_id == participant_id and slot.kind == "human":
                    slot.display_name = display_name
                    slot.color = player_color
                    slot.connected = True
                    return room, participant_id

        if room.phase != "lobby":
            raise RuntimeError("room_locked")

        next_slot = next((slot for slot in room.slots if slot.kind == "ai"), None)
        if next_slot is None:
            raise RuntimeError("room_full")

        assigned_participant_id = str(uuid4())
        next_slot.kind = "human"
        next_slot.display_name = display_name
        next_slot.participant_id = assigned_participant_id
        next_slot.is_host = False
        next_slot.connected = True
        next_slot.color = player_color
        next_slot.style = None
        next_slot.top_speed_mul = None
        next_slot.lane_offset = None
        return room, assigned_participant_id

    def sync_room_state(
        self,
        room_id: str,
        *,
        participant_id: str,
        phase: str | None = None,
        current_race_index: int | None = None,
        scores: dict[str, int] | None = None,
        race_results: list[dict[str, dict]] | None = None,
    ) -> Room:
        room = self.rooms.get(room_id)
        if not room:
            raise KeyError("room_not_found")
        if room.host_participant_id != participant_id:
            raise PermissionError("host_required")
        if phase in {"lobby", "racing", "standings", "final"}:
            room.phase = phase
            if phase != "racing":
                room.paused = False
                room.paused_by = None
        if isinstance(current_race_index, int) and current_race_index >= 0:
            room.current_race_index = current_race_index
        if isinstance(scores, dict):
            room.scores = {str(key): int(value) for key, value in scores.items()}
        if isinstance(race_results, list):
            room.race_results = list(race_results)
        return room

    def set_pause_state(
        self,
        room_id: str,
        *,
        participant_id: str,
        paused: bool,
    ) -> Room:
        room = self.rooms.get(room_id)
        if not room:
            raise KeyError("room_not_found")
        slot = next(
            (
                entry
                for entry in room.slots
                if entry.kind == "human" and entry.participant_id == participant_id
            ),
            None,
        )
        if not slot:
            raise PermissionError("participant_not_found")
        if room.phase != "racing":
            return room
        room.paused = bool(paused)
        room.paused_by = slot.display_name if room.paused else None
        return room

    def end_tournament(self, room_id: str, *, participant_id: str) -> Room:
        room = self.rooms.get(room_id)
        if not room:
            raise KeyError("room_not_found")
        slot = next(
            (
                entry
                for entry in room.slots
                if entry.kind == "human" and entry.participant_id == participant_id
            ),
            None,
        )
        if not slot:
            raise PermissionError("participant_not_found")
        room.phase = "final"
        room.paused = False
        room.paused_by = None
        return room

    def disconnect_participant(self, room_id: str, participant_id: str) -> Room | None:
        room = self.rooms.get(room_id)
        if not room:
            return None
        for slot in room.slots:
            if slot.participant_id != participant_id or slot.kind != "human":
                continue
            if slot.is_host:
                slot.connected = False
                return room
            if room.phase == "lobby":
                template = slot.ai_template
                slot.kind = "ai"
                slot.display_name = str(template.get("display_name", "AI"))
                slot.participant_id = None
                slot.is_host = False
                slot.connected = True
                slot.color = template.get("color")
                slot.style = template.get("style")
                slot.top_speed_mul = template.get("top_speed_mul")
                slot.lane_offset = template.get("lane_offset")
            else:
                slot.connected = False
            return room
        return room
