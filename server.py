from __future__ import annotations

import json
import os
import re
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from itertools import combinations
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).parent
DB_PATH = ROOT / "survey.db"
TIMEZONE = ZoneInfo("America/Argentina/Buenos_Aires")
TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):(?:00|05|10|15|20|25|30|35|40|45|50|55)$|^24:00$")
ADMIN_PIN = os.environ.get("ADMIN_PIN") or os.environ.get("NOTIFICATION_ADMIN_PIN") or os.environ.get("VITE_ADMIN_PIN", "")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
VOTERS = ["MISHA", "LEKU", "SEPIA", "ICHITBO"]


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


def normalize_comment(value: Any) -> str:
    comment = " ".join(str(value or "").strip().split())
    if len(comment) > 180:
        raise ValueError("El comentario no puede superar 180 caracteres.")
    return comment


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
                comment TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (date, voter_key)
            )
            """
        )
        columns = [row["name"] for row in db.execute("PRAGMA table_info(votes)").fetchall()]
        if "comment" not in columns:
            db.execute("ALTER TABLE votes ADD COLUMN comment TEXT NOT NULL DEFAULT ''")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS notification_events (
                event_key TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                channel TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )


def get_votes(date: str) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute(
            """
            SELECT voter, can_play, ranges_json, comment, updated_at
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
            "comment": row["comment"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def calculate_overlaps(votes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    playable_votes = [vote for vote in votes if vote["canPlay"] and vote["ranges"]]
    overlaps = []

    for size in range(2, len(playable_votes) + 1):
        for group in combinations(playable_votes, size):
            first_vote, *other_votes = group
            intervals = [
                (time_to_minutes(range_item["start"]), time_to_minutes(range_item["end"]))
                for range_item in first_vote["ranges"]
            ]
            for vote in other_votes:
                intervals = intersect_ranges(intervals, vote["ranges"])
            voters = tuple(sorted(vote["voter"] for vote in group))
            for start, end in merge_intervals(intervals):
                overlaps.append(to_overlap(start, end, voters))

    return sorted(
        overlaps,
        key=lambda overlap: (
            -len(overlap["voters"]),
            -(time_to_minutes(overlap["end"]) - time_to_minutes(overlap["start"])),
            time_to_minutes(overlap["start"]),
        ),
    )


def intersect_ranges(intervals: list[tuple[int, int]], ranges: list[dict[str, str]]) -> list[tuple[int, int]]:
    intersections = []
    for current_start, current_end in intervals:
        for range_item in ranges:
            start = max(current_start, time_to_minutes(range_item["start"]))
            end = min(current_end, time_to_minutes(range_item["end"]))
            if end > start:
                intersections.append((start, end))
    return intersections


def merge_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            previous_start, previous_end = merged[-1]
            merged[-1] = (previous_start, max(previous_end, end))
            continue
        merged.append((start, end))
    return merged


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


def build_discord_embed(date: str, votes: list[dict[str, Any]], overlaps: list[dict[str, Any]]) -> dict[str, Any]:
    vote_lines = []
    for voter in VOTERS:
        vote = next((item for item in votes if item["voter"].lower() == voter.lower()), None)
        if not vote:
            vote_lines.append(f"▫️ **{voter}** todavía no votó")
        elif not vote["canPlay"]:
            vote_lines.append(f"❌ **{voter}** no puede jugar")
        elif not vote["ranges"]:
            vote_lines.append(f"⚠️ **{voter}** sin rangos")
        else:
            ranges = ", ".join(f'{item["start"]} hs a {item["end"]} hs' for item in vote["ranges"])
            vote_lines.append(f"✅ **{voter}** {ranges}")

    overlap_lines = (
        [
            f'{["🥇", "🥈", "🥉", "⭐", "⭐"][index]} **{overlap["start"]} hs a {overlap["end"]} hs**\n{", ".join(overlap["voters"])}'
            for index, overlap in enumerate(overlaps[:5])
        ]
        if overlaps
        else ["Sin coincidencias para todos por ahora."]
    )

    return {
        "title": "🐷 Resultados Pigs Manager",
        "description": f"📅 {date}\n✅ Votaron **{len(votes)}/{len(VOTERS)}**",
        "color": 0xFF4FA3,
        "fields": [
            {"name": "🗳️ Votos", "value": "\n".join(vote_lines), "inline": False},
            {"name": "🎯 Coincidencias", "value": "\n\n".join(overlap_lines), "inline": False},
        ],
        "footer": {"text": "Por un VICIO mejor"},
    }


def mark_notification_pending(date: str) -> bool:
    event_key = f"today-results:{date}"
    try:
        with connect() as db:
            db.execute(
                """
                INSERT INTO notification_events (event_key, date, channel, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (event_key, date, "discord", now_buenos_aires()),
            )
        return True
    except sqlite3.IntegrityError:
        return False


def delete_notification_mark(date: str) -> None:
    with connect() as db:
        db.execute("DELETE FROM notification_events WHERE event_key = ?", (f"today-results:{date}",))


def get_notification_status(date: str) -> dict[str, Any] | None:
    with connect() as db:
        row = db.execute(
            """
            SELECT event_key, created_at
            FROM notification_events
            WHERE event_key = ?
            LIMIT 1
            """,
            (f"today-results:{date}",),
        ).fetchone()

    return dict(row) if row else None


def notification_diagnostics(date: str | None = None) -> dict[str, Any]:
    target_date = date or today_buenos_aires()
    votes = get_votes(target_date)
    voted_keys = {vote["voter"].lower() for vote in votes}
    missing_voters = [voter for voter in VOTERS if voter.lower() not in voted_keys]
    notification = get_notification_status(target_date)

    return {
        "ok": True,
        "date": target_date,
        "configured": {
            "discordWebhook": bool(DISCORD_WEBHOOK_URL),
            "supabaseUrl": False,
            "supabaseServiceRole": False,
        },
        "voteCount": len(votes),
        "expectedVoteCount": len(VOTERS),
        "missingVoters": missing_voters,
        "notificationSent": bool(notification),
        "notificationCreatedAt": notification["created_at"] if notification else None,
    }


def notify_discord_if_complete(date: str | None = None, force: bool = False, pin: str | None = None) -> dict[str, Any]:
    if not DISCORD_WEBHOOK_URL:
        return {"ok": True, "skipped": True, "reason": "Discord no esta configurado."}

    target_date = date or today_buenos_aires()
    votes = get_votes(target_date)
    voted_keys = {vote["voter"].lower() for vote in votes}
    if any(voter.lower() not in voted_keys for voter in VOTERS):
        return {"ok": True, "skipped": True, "reason": "Todavia faltan votos."}

    if get_notification_status(target_date) and not force:
        return {"ok": True, "skipped": True, "reason": "Los resultados ya fueron enviados."}
    if force:
        if not ADMIN_PIN or pin != ADMIN_PIN:
            return {"error": "PIN incorrecto."}
        delete_notification_mark(target_date)

    overlaps = calculate_overlaps(votes)
    payload = json.dumps(
        {
            "username": "Pigs Manager",
            "content": "🐷 Ya votaron todos. Estos son los resultados:",
            "embeds": [build_discord_embed(target_date, votes, overlaps)],
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        DISCORD_WEBHOOK_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=8) as discord_response:
            if discord_response.status >= 400:
                return {"error": "Discord no acepto la notificacion."}
    except (urllib.error.URLError, TimeoutError):
        return {"error": "No se pudo conectar con Discord."}

    mark_notification_pending(target_date)
    return {"ok": True, "notified": True}


class SurveyHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/api/summary":
            self.send_json(summary())
            return
        if self.path.startswith("/api/notify-results"):
            self.send_json(notification_diagnostics())
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path == "/api/notify-results":
            try:
                payload = self.read_json()
                result = notify_discord_if_complete(
                    payload.get("date"),
                    force=payload.get("force") is True,
                    pin=payload.get("pin"),
                )
                self.send_json(result, status=200 if result.get("ok") else 502)
            except json.JSONDecodeError:
                self.send_json({"error": "El cuerpo de la solicitud no es JSON valido."}, status=400)
            return

        if self.path != "/api/votes":
            self.send_error(404)
            return

        try:
            payload = self.read_json()
            voter = normalize_name(str(payload.get("voter", "")))
            can_play = bool(payload.get("canPlay", False))
            ranges = validate_ranges(can_play, payload.get("ranges", []))
            comment = normalize_comment(payload.get("comment", ""))
            voter_key = voter.lower()

            with connect() as db:
                db.execute(
                    """
                    INSERT INTO votes (date, voter_key, voter, can_play, ranges_json, comment, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(date, voter_key) DO UPDATE SET
                        voter = excluded.voter,
                        can_play = excluded.can_play,
                        ranges_json = excluded.ranges_json,
                        comment = excluded.comment,
                        updated_at = excluded.updated_at
                    """,
                    (
                        today_buenos_aires(),
                        voter_key,
                        voter,
                        int(can_play),
                        json.dumps(ranges),
                        comment,
                        now_buenos_aires(),
                    ),
                )

            self.send_json(summary())
        except ValueError as error:
            self.send_json({"error": str(error)}, status=400)
        except json.JSONDecodeError:
            self.send_json({"error": "El cuerpo de la solicitud no es JSON valido."}, status=400)

    def do_DELETE(self) -> None:
        if self.path != "/api/votes/today":
            self.send_error(404)
            return

        try:
            payload = self.read_json()
            if not ADMIN_PIN or payload.get("pin") != ADMIN_PIN:
                self.send_json({"error": "PIN incorrecto."}, status=403)
                return

            with connect() as db:
                db.execute("DELETE FROM votes WHERE date = ?", (today_buenos_aires(),))
                db.execute("DELETE FROM notification_events WHERE event_key = ?", (f"today-results:{today_buenos_aires()}",))

            self.send_json(summary())
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
