from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).parent
DB_PATH = ROOT / "survey.db"
TIMEZONE = ZoneInfo("America/Argentina/Buenos_Aires")
TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):(?:00|05|10|15|20|25|30|35|40|45|50|55)$|^24:00$")


def today_buenos_aires() -> str:
    return datetime.now(TIMEZONE).date().isoformat()


def now_buenos_aires() -> str:
    return datetime.now(TIMEZONE).isoformat()


def time_to_minutes(value: str) -> int:
    hour, minute = value.split(":")
    return int(hour) * 60 + int(minute)


def normalize_name(value: str) -> str:
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        raise ValueError("El nombre es obligatorio.")
    if len(cleaned) > 50:
        raise ValueError("El nombre no puede superar 50 caracteres.")
    return cleaned


def validate_ranges(can_play: bool, ranges: list[dict[str, str]]) -> list[dict[str, str]]:
    if not can_play:
        return []
    if not ranges:
        raise ValueError("Agrega al menos un rango horario o marca que no podes jugar.")

    validated = []
    for item in ranges:
        start = item.get("start", "")
        end = item.get("end", "")
        if not TIME_PATTERN.match(start) or not TIME_PATTERN.match(end):
            raise ValueError("Los horarios deben estar en intervalos de 5 minutos.")
        if time_to_minutes(end) - time_to_minutes(start) < 5:
            raise ValueError("Cada rango debe durar al menos 5 minutos.")
        validated.append({"start": start, "end": end})
    return validated


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with connect() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS votes (
                date TEXT NOT NULL,
                voter_key TEXT NOT NULL,
                voter TEXT NOT NULL,
                can_play INTEGER NOT NULL,
                ranges_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (date, voter_key)
            )
            """
        )


def get_votes(date: str) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute(
            """
            SELECT voter, can_play, ranges_json, updated_at
            FROM votes
            WHERE date = ?
            ORDER BY lower(voter)
            """,
            (date,),
        ).fetchall()

    return [
        {
            "voter": row["voter"],
            "canPlay": bool(row["can_play"]),
            "ranges": json.loads(row["ranges_json"]),
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def calculate_overlaps(votes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: dict[tuple[int, int], set[str]] = {}
    for vote in votes:
        if not vote["canPlay"]:
            continue
        for range_item in vote["ranges"]:
            start = time_to_minutes(range_item["start"])
            end = time_to_minutes(range_item["end"])
            for minute in range(start, end, 5):
                events.setdefault((minute, minute + 5), set()).add(vote["voter"])

    overlaps = []
    active_voters: tuple[str, ...] | None = None
    active_start: int | None = None
    active_end: int | None = None

    for (start, end), voters in sorted(events.items()):
        voter_tuple = tuple(sorted(voters))
        if len(voter_tuple) < 2:
            continue
        if active_voters == voter_tuple and active_end == start:
            active_end = end
            continue
        if active_voters and active_start is not None and active_end is not None:
            overlaps.append(to_overlap(active_start, active_end, active_voters))
        active_voters = voter_tuple
        active_start = start
        active_end = end

    if active_voters and active_start is not None and active_end is not None:
        overlaps.append(to_overlap(active_start, active_end, active_voters))

    return overlaps


def minutes_to_time(value: int) -> str:
    hour = value // 60
    minute = value % 60
    return f"{hour:02d}:{minute:02d}"


def to_overlap(start: int, end: int, voters: tuple[str, ...]) -> dict[str, Any]:
    return {"start": minutes_to_time(start), "end": minutes_to_time(end), "voters": list(voters)}


def summary() -> dict[str, Any]:
    date = today_buenos_aires()
    votes = get_votes(date)
    return {
        "date": date,
        "timezone": "America/Argentina/Buenos_Aires",
        "votes": votes,
        "overlaps": calculate_overlaps(votes),
    }


class SurveyHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/api/summary":
            self.send_json(summary())
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path != "/api/votes":
            self.send_error(404)
            return

        try:
            payload = self.read_json()
            voter = normalize_name(str(payload.get("voter", "")))
            can_play = bool(payload.get("canPlay", False))
            ranges = validate_ranges(can_play, payload.get("ranges", []))
            voter_key = voter.lower()

            with connect() as db:
                db.execute(
                    """
                    INSERT INTO votes (date, voter_key, voter, can_play, ranges_json, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(date, voter_key) DO UPDATE SET
                        voter = excluded.voter,
                        can_play = excluded.can_play,
                        ranges_json = excluded.ranges_json,
                        updated_at = excluded.updated_at
                    """,
                    (
                        today_buenos_aires(),
                        voter_key,
                        voter,
                        int(can_play),
                        json.dumps(ranges),
                        now_buenos_aires(),
                    ),
                )

            self.send_json(summary())
        except ValueError as error:
            self.send_json({"error": str(error)}, status=400)
        except json.JSONDecodeError:
            self.send_json({"error": "El cuerpo de la solicitud no es JSON valido."}, status=400)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        return json.loads(body or "{}")

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(encoded)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def main() -> None:
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), SurveyHandler)
    print("API escuchando en http://127.0.0.1:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
