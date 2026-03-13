def make_create_payload():
    return {
        "display_name": "Host Racer",
        "tracks": [
            {
                "id": "track-alpha",
                "name": "TRACK ALPHA",
                "track_payload_json": {
                    "id": "track-alpha",
                    "name": "TRACK ALPHA",
                    "track": {"cx": 640, "cy": 360},
                    "checkpoints": [],
                    "worldObjects": [],
                    "centerlineStrokes": [],
                    "editStack": [],
                },
            }
        ],
        "ai_roster": [
            {
                "name": f"AI {index}",
                "style": "precise" if index == 1 else "long",
                "top_speed_mul": 1 if index == 1 else 0.9,
                "lane_offset": 0 if index == 1 else 18,
            }
            for index in range(1, 6)
        ],
    }


def test_create_and_join_tournament_room(client):
    create_response = client.post("/api/tournaments", json=make_create_payload())

    assert create_response.status_code == 201
    create_payload = create_response.json()
    assert create_payload["participant_id"]
    assert create_payload["room"]["phase"] == "lobby"
    assert len(create_payload["room"]["slots"]) == 6
    assert create_payload["room"]["slots"][0]["kind"] == "human"
    assert create_payload["room"]["slots"][1]["kind"] == "ai"

    room_id = create_payload["room"]["id"]
    join_response = client.post(
        f"/api/tournaments/{room_id}/join",
        json={"display_name": "Guest Racer"},
    )

    assert join_response.status_code == 200
    join_payload = join_response.json()
    assert join_payload["participant_id"]
    human_slots = [slot for slot in join_payload["room"]["slots"] if slot["kind"] == "human"]
    assert len(human_slots) == 2
    assert any(slot["display_name"] == "Guest Racer" for slot in human_slots)


def test_tournament_room_websocket_broadcasts_state(client):
    create_response = client.post("/api/tournaments", json=make_create_payload())
    create_payload = create_response.json()
    room_id = create_payload["room"]["id"]
    host_participant_id = create_payload["participant_id"]

    guest_response = client.post(
        f"/api/tournaments/{room_id}/join",
        json={"display_name": "Guest Racer"},
    )
    guest_payload = guest_response.json()

    with client.websocket_connect(
        f"/api/tournaments/{room_id}/ws?participant_id={host_participant_id}"
    ) as host_ws:
        host_snapshot = host_ws.receive_json()
        assert host_snapshot["type"] == "room_snapshot"

        with client.websocket_connect(
            f"/api/tournaments/{room_id}/ws?participant_id={guest_payload['participant_id']}"
        ) as guest_ws:
            guest_snapshot = guest_ws.receive_json()
            assert guest_snapshot["type"] == "room_snapshot"

            host_room_update = host_ws.receive_json()
            assert host_room_update["type"] == "room_snapshot"

            host_ws.send_json(
                {
                    "type": "player_state",
                    "payload": {"x": 10, "y": 20, "lap": 2, "finished": False},
                }
            )
            guest_state = guest_ws.receive_json()
            assert guest_state["type"] == "player_state"
            assert guest_state["payload"]["x"] == 10
            assert guest_state["payload"]["lap"] == 2

            guest_ws.send_json(
                {
                    "type": "skid_marks",
                    "payload": [
                        {
                            "x1": 1,
                            "y1": 2,
                            "x2": 3,
                            "y2": 4,
                            "width": 2.2,
                            "color": "rgba(20, 20, 20, 0.37)",
                        }
                    ],
                }
            )
            host_skids = host_ws.receive_json()
            assert host_skids["type"] == "skid_marks"
            assert host_skids["payload"][0]["x2"] == 3

            host_ws.send_json(
                {
                    "type": "room_sync",
                    "phase": "racing",
                    "current_race_index": 0,
                    "scores": {"Host Racer": 10},
                    "race_results": [],
                }
            )
            host_synced = host_ws.receive_json()
            guest_synced = guest_ws.receive_json()
            assert host_synced["type"] == "room_snapshot"
            assert guest_synced["type"] == "room_snapshot"
            assert host_synced["room"]["phase"] == "racing"
            assert guest_synced["room"]["scores"]["Host Racer"] == 10

            guest_ws.send_json({"type": "pause_sync", "paused": True})
            host_paused = host_ws.receive_json()
            guest_paused = guest_ws.receive_json()
            assert host_paused["room"]["paused"] is True
            assert guest_paused["room"]["paused"] is True
            assert host_paused["room"]["paused_by"] == "Guest Racer"

            host_ws.send_json({"type": "pause_sync", "paused": False})
            host_resumed = host_ws.receive_json()
            guest_resumed = guest_ws.receive_json()
            assert host_resumed["room"]["paused"] is False
            assert guest_resumed["room"]["paused_by"] is None

            guest_ws.send_json({"type": "end_tournament"})
            host_final = host_ws.receive_json()
            guest_final = guest_ws.receive_json()
            assert host_final["room"]["phase"] == "final"
            assert guest_final["room"]["paused"] is False
