import json
from datetime import datetime
from pathlib import Path

from sqlmodel import Session, select

from .config import get_settings
from .models import Track


def seed_system_tracks(session: Session) -> int:
    settings = get_settings()
    tracks_dir = Path(settings.frontend_dir) / "tracks"
    index_file = tracks_dir / "index.json"
    if not index_file.exists():
        return 0

    with index_file.open("r", encoding="utf-8") as fh:
        manifest = json.load(fh)

    inserted = 0
    items: list[dict] = []
    if isinstance(manifest, list):
        for file_name in manifest:
            if isinstance(file_name, str):
                items.append({"file": file_name})
    elif isinstance(manifest, dict):
        raw_items = manifest.get("tracks", [])
        if isinstance(raw_items, list):
            for item in raw_items:
                if isinstance(item, dict):
                    items.append(item)

    for item in items:
        file_name = item.get("file")
        if not file_name:
            continue
        track_path = tracks_dir / file_name
        if not track_path.exists():
            continue

        with track_path.open("r", encoding="utf-8") as tf:
            payload = json.load(tf)

        slug = item.get("id") or payload.get("id") or track_path.stem
        name = item.get("name") or payload.get("name") or slug

        existing = session.exec(select(Track).where(Track.slug == slug)).first()
        if existing:
            continue

        session.add(
            Track(
                slug=slug,
                name=name,
                source="system",
                is_published=True,
                track_payload_json=payload,
                updated_at=datetime.utcnow(),
            )
        )
        inserted += 1

    if inserted > 0:
        session.commit()
    return inserted
