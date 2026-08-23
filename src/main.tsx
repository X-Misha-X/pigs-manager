import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Check,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import "./styles.css";

type Range = {
  start: string;
  end: string;
  deleted?: boolean;
};

type TimeField = "start" | "end";
type DialModes = Record<string, "hour" | "minute">;
type ActiveRangeFields = Record<string, TimeField>;
type CollapsedRanges = Record<number, boolean>;
type AppSection = "today" | "game";

type Vote = {
  date?: string;
  voter: string;
  canPlay: boolean;
  ranges: Range[];
  comment: string;
  updatedAt: string;
};

type GameOption = {
  id: string;
  name: string;
  voters: string[];
};

type Summary = {
  date: string;
  timezone: string;
  votes: Vote[];
  overlaps: {
    start: string;
    end: string;
    voters: string[];
  }[];
  suggestions: RangeSuggestion[];
};

type RangeSuggestion = {
  start: string;
  end: string;
  voters: string[];
  hits: number;
};

type SupabaseVoteRow = {
  date: string;
  voter_key: string;
  voter: string;
  can_play: boolean;
  ranges: Range[];
  comment?: string | null;
  updated_at: string;
};

type SupabaseGameVoteRow = {
  voter_key: string;
  voter: string;
};

type SupabaseGameRow = {
  id: string;
  name: string;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  game_votes?: SupabaseGameVoteRow[];
};

const API_BASE = import.meta.env.DEV ? "http://127.0.0.1:8000/api" : "/api";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN as string | undefined;
const IS_DEV = import.meta.env.DEV;
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const VOTERS = ["MISHA", "LEKU", "SEPIA", "ICHITBO"];
const VOTER_AVATARS: Record<string, string> = {
  MISHA: "/avatars/misha.png",
  LEKU: "/avatars/leku.png",
  SEPIA: "/avatars/sepia.png",
  ICHITBO: "/avatars/ichitbo.png",
};
const GAMES_STORAGE_KEY = "pigs-manager-games";
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const END_HOURS = [...HOURS, "24"];
const OUTER_HOURS = ["12", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"];
const INNER_HOURS = ["00", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23"];
const MIN_RANGE_MINUTES = 5;
const PLACEHOLDER_TIME = "HH:MM";
const OVERNIGHT_TIME = "TRASNOCHE";
const OVERNIGHT_END_MINUTES = 24 * 60;
const DEFAULT_RANGE = { start: PLACEHOLDER_TIME, end: PLACEHOLDER_TIME };
const TIME_PATTERN = /^(?:(?:[01]\d|2[0-3]):(?:00|05|10|15|20|25|30|35|40|45|50|55)|24:00)$/;
const HOUR_PATTERN = /^(?:[01]\d|2[0-4])$/;
const MINUTE_PATTERN = /^(?:00|05|10|15|20|25|30|35|40|45|50|55)$/;

function formatDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "full",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function isSelectedTime(value: string) {
  return TIME_PATTERN.test(value);
}

function isOvernightTime(value: string) {
  return value === OVERNIGHT_TIME;
}

function splitTime(value: string) {
  const [hour = "HH", minute = "MM"] = value.split(":");
  return { hour, minute };
}

function isSelectedHour(value: string) {
  return HOUR_PATTERN.test(splitTime(value).hour);
}

function isSelectedMinute(value: string) {
  return MINUTE_PATTERN.test(splitTime(value).minute);
}

function isCompleteRange(range: Range) {
  return isSelectedTime(range.start) && (isSelectedTime(range.end) || isOvernightTime(range.end));
}

function isActiveRange(range: Range) {
  return !range.deleted;
}

function isActiveCompleteRange(range: Range) {
  return isActiveRange(range) && isCompleteRange(range);
}

function isValidRange(range: Range) {
  return isActiveCompleteRange(range) && rangeEndToMinutes(range) - timeToMinutes(range.start) >= MIN_RANGE_MINUTES;
}

function minutesToTime(value: number) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function rangeEndToMinutes(range: Pick<Range, "end">) {
  return isOvernightTime(range.end) ? OVERNIGHT_END_MINUTES : timeToMinutes(range.end);
}

function minutesToRangeEnd(value: number) {
  return value >= OVERNIGHT_END_MINUTES ? OVERNIGHT_TIME : minutesToTime(value);
}

function formatRange(range: Pick<Range, "start" | "end">) {
  const end = isOvernightTime(range.end) ? OVERNIGHT_TIME : `${range.end} hs`;
  return `${range.start} hs a ${end}`;
}

function buildResultsMessage(summary: Summary) {
  const voteLines = VOTERS.map((voter) => {
    const vote = summary.votes.find((item) => item.voter.toLowerCase() === voter.toLowerCase());
    if (!vote) return `• *${voter}* todavía no votó`;
    if (!vote.canPlay) return `• *${voter}* no puede jugar`;
    if (!vote.ranges.length) return `• *${voter}* sin rangos`;
    return `• *${voter}* ${vote.ranges.map(formatRange).join(", ")}`;
  });
  const overlapLines = summary.overlaps.length
    ? summary.overlaps
        .slice(0, 5)
        .map((overlap, index) => `${["🥇", "🥈", "🥉", "⭐", "⭐"][index]} *${formatRange(overlap)}*\n   ${overlap.voters.join(", ")}`)
    : ["Sin coincidencias por ahora."];

  return [
    "🐷 *Pigs Manager*",
    `📅 ${formatDate(summary.date)}`,
    "",
    `✅ Confirmaron *${summary.votes.length}/${VOTERS.length}*`,
    "",
    "🗳️ *Votos*",
    ...voteLines,
    "",
    "🎯 *Coincidencias*",
    ...overlapLines,
  ].join("\n");
}

function normalizeRange(range: Range): Range {
  return range;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12));
  return next.toISOString().slice(0, 10);
}

function formatShortDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatUpdatedAt(value: string) {
  return `${new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value))} hs`;
}

function createGameId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readStoredGames(): GameOption[] {
  try {
    const rawGames = localStorage.getItem(GAMES_STORAGE_KEY);
    if (!rawGames) {
      return [];
    }
    const parsedGames = JSON.parse(rawGames);
    if (!Array.isArray(parsedGames)) {
      return [];
    }
    return parsedGames
      .filter((game): game is GameOption => {
        return (
          game &&
          typeof game.id === "string" &&
          typeof game.name === "string" &&
          Array.isArray(game.voters)
        );
      })
      .map((game) => ({
        id: game.id,
        name: game.name,
        voters: game.voters.filter((voter) => VOTERS.includes(voter)),
      }));
  } catch {
    return [];
  }
}

function todayBuenosAires() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nowBuenosAires() {
  return new Date().toISOString();
}

function voteFromSupabaseRow(row: SupabaseVoteRow): Vote {
  return {
    date: row.date,
    voter: row.voter,
    canPlay: row.can_play,
    ranges: row.ranges,
    comment: row.comment ?? "",
    updatedAt: row.updated_at,
  };
}

function gameFromSupabaseRow(row: SupabaseGameRow): GameOption {
  return {
    id: row.id,
    name: row.name,
    voters: (row.game_votes ?? [])
      .map((vote) => vote.voter)
      .filter((voter) => VOTERS.includes(voter)),
  };
}

function friendlyGameError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("PGRST205") || message.includes("public.games") || message.includes("schema cache")) {
    return "Error en base de datos.";
  }
  return message || "No se pudieron cargar los juegos.";
}

function toOverlap(start: number, end: number, voters: string[]) {
  return { start: minutesToTime(start), end: minutesToRangeEnd(end), voters };
}

function overlapDuration(overlap: Summary["overlaps"][number]) {
  return rangeEndToMinutes(overlap) - timeToMinutes(overlap.start);
}

function sortOverlaps(overlaps: Summary["overlaps"]) {
  return [...overlaps].sort((a, b) => {
    const playersDiff = b.voters.length - a.voters.length;
    if (playersDiff) return playersDiff;

    const durationDiff = overlapDuration(b) - overlapDuration(a);
    if (durationDiff) return durationDiff;

    return timeToMinutes(a.start) - timeToMinutes(b.start);
  });
}

function rangeDuration(range: Range) {
  return rangeEndToMinutes(range) - timeToMinutes(range.start);
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];

  return items.flatMap((item, index) =>
    combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]),
  );
}

function intersectRanges(existing: Array<[number, number]>, ranges: Range[]) {
  const next: Array<[number, number]> = [];
  existing.forEach(([currentStart, currentEnd]) => {
    ranges.forEach((range) => {
      const start = Math.max(currentStart, timeToMinutes(range.start));
      const end = Math.min(currentEnd, rangeEndToMinutes(range));
      if (end > start) next.push([start, end]);
    });
  });
  return next;
}

function mergeIntervals(intervals: Array<[number, number]>) {
  return intervals
    .sort(([aStart, aEnd], [bStart, bEnd]) => aStart - bStart || aEnd - bEnd)
    .reduce<Array<[number, number]>>((merged, [start, end]) => {
      const last = merged.at(-1);
      if (last && start <= last[1]) {
        last[1] = Math.max(last[1], end);
        return merged;
      }
      merged.push([start, end]);
      return merged;
    }, []);
}

function calculateOverlaps(votes: Vote[]): Summary["overlaps"] {
  const playableVotes = votes.filter((vote) => vote.canPlay && vote.ranges.length);
  const overlapsByTime = new Map<string, Set<string>>();

  for (let size = 2; size <= playableVotes.length; size += 1) {
    combinations(playableVotes, size).forEach((group) => {
      const [firstVote, ...otherVotes] = group;
      const initialIntervals = firstVote.ranges.map((range) => [
        timeToMinutes(range.start),
        rangeEndToMinutes(range),
      ]) as Array<[number, number]>;
      const commonIntervals = otherVotes.reduce(
        (intervals, vote) => intersectRanges(intervals, vote.ranges),
        initialIntervals,
      );
      const voters = group.map((vote) => vote.voter).sort();
      mergeIntervals(commonIntervals).forEach(([start, end]) => {
        const key = `${start}-${end}`;
        const existingVoters = overlapsByTime.get(key) ?? new Set<string>();
        voters.forEach((voter) => existingVoters.add(voter));
        overlapsByTime.set(key, existingVoters);
      });
    });
  }

  const overlaps = [...overlapsByTime.entries()]
    .map(([key, voters]) => {
      const [start, end] = key.split("-").map(Number);
      return toOverlap(start, end, [...voters].sort());
    })
    .filter((overlap) => overlap.voters.length >= 2);

  return sortOverlaps(overlaps);
}

function calculateRangeSuggestions(votes: Vote[]): RangeSuggestion[] {
  const votesByDate = votes.reduce<Record<string, Vote[]>>((groups, vote) => {
    const date = vote.date ?? vote.updatedAt.slice(0, 10);
    groups[date] = [...(groups[date] ?? []), vote];
    return groups;
  }, {});
  const suggestions = new Map<string, RangeSuggestion>();

  Object.values(votesByDate).forEach((dateVotes) => {
    const latestVoteByVoter = new Map<string, Vote>();
    const seenRangesToday = new Set<string>();
    dateVotes.forEach((vote) => {
      const current = latestVoteByVoter.get(vote.voter);
      if (!current || Date.parse(vote.updatedAt) > Date.parse(current.updatedAt)) {
        latestVoteByVoter.set(vote.voter, vote);
      }
    });
    calculateOverlaps([...latestVoteByVoter.values()])
      .filter((overlap) => overlap.voters.length >= 3)
      .forEach((overlap) => {
        const key = `${overlap.start}-${overlap.end}`;
        const current = suggestions.get(key);
        const voters = current && current.voters.length > overlap.voters.length ? current.voters : overlap.voters;
        suggestions.set(key, {
          start: overlap.start,
          end: overlap.end,
          voters,
          hits: (current?.hits ?? 0) + (seenRangesToday.has(key) ? 0 : 1),
        });
        seenRangesToday.add(key);
      });
  });

  return [...suggestions.values()]
    .sort((a, b) => {
      const playersDiff = b.voters.length - a.voters.length;
      if (playersDiff) return playersDiff;
      const hitsDiff = b.hits - a.hits;
      if (hitsDiff) return hitsDiff;
      return rangeDuration(b) - rangeDuration(a);
    })
    .slice(0, 4);
}

async function supabaseRequest<T>(path: string, options?: RequestInit): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Faltan las variables de Supabase.");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Supabase no pudo completar la solicitud.");
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

async function loadAppSummary(): Promise<Summary> {
  if (!USE_SUPABASE) {
    return request<Summary>("/summary");
  }

  const date = todayBuenosAires();
  const rows = await supabaseRequest<SupabaseVoteRow[]>(`/votes?date=eq.${date}&select=*&order=voter.asc`);
  const historicalRows = await supabaseRequest<SupabaseVoteRow[]>(
    `/votes?date=lt.${date}&select=*&order=date.desc,updated_at.desc&limit=240`,
  );
  const votes = rows.map(voteFromSupabaseRow);
  const historicalVotes = historicalRows.map(voteFromSupabaseRow);

  return {
    date,
    timezone: "America/Argentina/Buenos_Aires",
    votes,
    overlaps: calculateOverlaps(votes),
    suggestions: calculateRangeSuggestions(historicalVotes),
  };
}

async function saveAppVote(voter: string, canPlay: boolean, ranges: Range[], comment: string): Promise<Summary> {
  if (!USE_SUPABASE) {
    return request<Summary>("/votes", {
      method: "POST",
      body: JSON.stringify({ voter, canPlay, ranges, comment }),
    });
  }

  const date = todayBuenosAires();
  await supabaseRequest<SupabaseVoteRow[]>("/votes?on_conflict=date,voter_key", {
    method: "POST",
    body: JSON.stringify({
      date,
      voter_key: voter.toLowerCase(),
      voter,
      can_play: canPlay,
      ranges,
      comment,
      updated_at: nowBuenosAires(),
    }),
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
  });

  return loadAppSummary();
}

type NotificationResult = {
  ok?: boolean;
  notified?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

async function notifyResultsIfComplete(summary: Summary): Promise<NotificationResult | null> {
  if (summary.votes.length < VOTERS.length) return null;

  try {
    const response = await fetch("/api/notify-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: summary.date }),
    });
    const result = (await response.json().catch(() => ({}))) as NotificationResult;
    if (!response.ok || result.error) {
      return { ok: false, error: result.error ?? "Discord no pudo enviar la notificacion." };
    }
    return result;
  } catch (error) {
    console.warn("No se pudo avisar los resultados por Discord.", error);
    return { ok: false, error: "No se pudo conectar con el endpoint de Discord." };
  }
}

async function deleteAppVote(voter: string): Promise<Summary> {
  if (!USE_SUPABASE) {
    return saveAppVote(voter, true, [], "");
  }

  const date = todayBuenosAires();
  await supabaseRequest<undefined>(`/votes?date=eq.${date}&voter_key=eq.${voter.toLowerCase()}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal",
    },
  });

  return loadAppSummary();
}

async function loadAppGames(): Promise<GameOption[]> {
  if (!USE_SUPABASE) {
    return readStoredGames();
  }

  const rows = await supabaseRequest<SupabaseGameRow[]>(
    "/games?select=id,name,created_by,created_at,updated_at,game_votes(voter_key,voter)&order=updated_at.desc",
  );
  return rows.map(gameFromSupabaseRow);
}

async function createAppGame(name: string, voter: string): Promise<GameOption[]> {
  if (!USE_SUPABASE) {
    const nextGames = [...readStoredGames(), { id: createGameId(), name, voters: [] }];
    localStorage.setItem(GAMES_STORAGE_KEY, JSON.stringify(nextGames));
    return nextGames;
  }

  await supabaseRequest<SupabaseGameRow[]>("/games", {
    method: "POST",
    body: JSON.stringify({
      name,
      created_by: voter ? voter.toLowerCase() : null,
      updated_at: nowBuenosAires(),
    }),
  });
  return loadAppGames();
}

async function updateAppGameName(gameId: string, name: string): Promise<GameOption[]> {
  if (!USE_SUPABASE) {
    const nextGames = readStoredGames().map((game) => (game.id === gameId ? { ...game, name } : game));
    localStorage.setItem(GAMES_STORAGE_KEY, JSON.stringify(nextGames));
    return nextGames;
  }

  await supabaseRequest<SupabaseGameRow[]>(`/games?id=eq.${gameId}`, {
    method: "PATCH",
    body: JSON.stringify({ name, updated_at: nowBuenosAires() }),
  });
  return loadAppGames();
}

async function deleteAppGame(gameId: string): Promise<GameOption[]> {
  if (!USE_SUPABASE) {
    const nextGames = readStoredGames().filter((game) => game.id !== gameId);
    localStorage.setItem(GAMES_STORAGE_KEY, JSON.stringify(nextGames));
    return nextGames;
  }

  await supabaseRequest<undefined>(`/games?id=eq.${gameId}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  return loadAppGames();
}

async function toggleAppGameVote(game: GameOption, voter: string): Promise<GameOption[]> {
  if (!USE_SUPABASE) {
    const nextGames = readStoredGames().map((item) => {
      if (item.id !== game.id) return item;
      const hasVote = item.voters.includes(voter);
      return {
        ...item,
        voters: hasVote ? item.voters.filter((name) => name !== voter) : [...item.voters, voter],
      };
    });
    localStorage.setItem(GAMES_STORAGE_KEY, JSON.stringify(nextGames));
    return nextGames;
  }

  const voterKey = voter.toLowerCase();
  if (game.voters.includes(voter)) {
    await supabaseRequest<undefined>(`/game_votes?game_id=eq.${game.id}&voter_key=eq.${voterKey}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } else {
    await supabaseRequest<SupabaseGameVoteRow[]>("/game_votes", {
      method: "POST",
      body: JSON.stringify({
        game_id: game.id,
        voter_key: voterKey,
        voter,
      }),
    });
  }
  return loadAppGames();
}

async function deleteTodayVotes(pin: string): Promise<Summary> {
  if (!USE_SUPABASE) {
    if (!ADMIN_PIN || pin !== ADMIN_PIN) {
      throw new Error("PIN incorrecto.");
    }
    return request<Summary>("/votes/today", {
      method: "DELETE",
      body: JSON.stringify({ pin }),
    });
  }

  if (IS_DEV) {
    if (!ADMIN_PIN || pin !== ADMIN_PIN) {
      throw new Error("PIN incorrecto. En local falta configurar ADMIN_PIN en .env.local o el PIN no coincide.");
    }

    const date = todayBuenosAires();
    await supabaseRequest<undefined>(`/votes?date=eq.${date}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    });
    return loadAppSummary();
  }

  await request<{ ok: boolean }>("/votes-today", {
    method: "DELETE",
    body: JSON.stringify({ pin }),
  });
  return loadAppSummary();
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("No se pudo conectar con la API. Usa npm run dev para levantar frontend y backend juntos.");
  }

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "La API no respondio con JSON. Revisa que el backend Python este corriendo." }));
    throw new Error(body.error ?? "No se pudo completar la solicitud");
  }

  return response.json();
}

function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("today");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [voterName, setVoterName] = useState("");
  const [pendingVoterName, setPendingVoterName] = useState("");
  const [canPlay, setCanPlay] = useState<boolean | null>(null);
  const [ranges, setRanges] = useState<Range[]>([DEFAULT_RANGE]);
  const [comment, setComment] = useState("");
  const [savedRanges, setSavedRanges] = useState<Range[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notificationNotice, setNotificationNotice] = useState("");
  const [dialModes, setDialModes] = useState<DialModes>({});
  const [activeRangeFields, setActiveRangeFields] = useState<ActiveRangeFields>({});
  const [collapsedRanges, setCollapsedRanges] = useState<CollapsedRanges>({});
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminPin, setAdminPin] = useState("");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminDeleting, setAdminDeleting] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminConfirming, setAdminConfirming] = useState(false);
  const [overlapFilters, setOverlapFilters] = useState<string[]>(VOTERS);
  const [games, setGames] = useState<GameOption[]>(() => (USE_SUPABASE ? [] : readStoredGames()));
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gameSaving, setGameSaving] = useState(false);
  const [newGameName, setNewGameName] = useState("");
  const [gameError, setGameError] = useState("");
  const [editingGame, setEditingGame] = useState<GameOption | null>(null);
  const [editingGameName, setEditingGameName] = useState("");
  const [gameToDelete, setGameToDelete] = useState<GameOption | null>(null);

  const currentVote = useMemo(
    () => summary?.votes.find((vote) => vote.voter.toLowerCase() === voterName.toLowerCase()),
    [summary, voterName],
  );
  const filteredOverlaps = useMemo(() => {
    const overlaps = summary?.overlaps ?? [];
    if (overlapFilters.length === VOTERS.length) return overlaps;
    if (overlapFilters.length < 2) return [];
    return overlaps.filter((overlap) => overlap.voters.every((voter) => overlapFilters.includes(voter)));
  }, [overlapFilters, summary?.overlaps]);
  const resultVotes = useMemo(
    () =>
      VOTERS.map(
        (name) =>
          summary?.votes.find((vote) => vote.voter.toLowerCase() === name.toLowerCase()) ?? {
            voter: name,
            canPlay: true,
            ranges: [],
            comment: "",
            updatedAt: "",
          },
      ),
    [summary?.votes],
  );
  const sortedGames = useMemo(
    () =>
      [...games].sort((firstGame, secondGame) => {
        if (secondGame.voters.length !== firstGame.voters.length) {
          return secondGame.voters.length - firstGame.voters.length;
        }
        return firstGame.name.localeCompare(secondGame.name);
      }),
    [games],
  );

  async function loadSummary() {
    setLoading(true);
    setError("");
    try {
      setSummary(await loadAppSummary());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los votos");
    } finally {
      setLoading(false);
    }
  }

  async function loadGames() {
    setGamesLoading(true);
    setGameError("");
    try {
      setGames(await loadAppGames());
    } catch (err) {
      setGameError(friendlyGameError(err));
    } finally {
      setGamesLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
    loadGames();
  }, []);

  useEffect(() => {
    if (!USE_SUPABASE && !gamesLoading) {
      localStorage.setItem(GAMES_STORAGE_KEY, JSON.stringify(games));
    }
  }, [games, gamesLoading]);

  useEffect(() => {
    if (!voterName) {
      setCanPlay(null);
      setRanges([]);
      setComment("");
      setSavedRanges([]);
      return;
    }

    if (currentVote) {
      setCanPlay(currentVote.canPlay);
      const loadedRanges = currentVote.ranges;
      setRanges(loadedRanges);
      setComment(currentVote.comment);
      setSavedRanges(currentVote.ranges);
      setCollapsedRanges(
        currentVote.canPlay
          ? Object.fromEntries(loadedRanges.map((_, index) => [index, true]))
          : {},
      );
      return;
    }

    setCanPlay(null);
    setRanges([]);
    setComment("");
    setSavedRanges([]);
    setCollapsedRanges({});
  }, [currentVote, voterName]);

  function requestVoterConfirmation(name: string) {
    if (voterName === name) return;
    resetVotingFlow();
    setPendingVoterName(name);
    setError("");
    setNotificationNotice("");
  }

  function confirmVoter() {
    if (!pendingVoterName) return;
    setVoterName(pendingVoterName);
    setPendingVoterName("");
    setError("");
  }

  function cancelVoterConfirmation() {
    setPendingVoterName("");
  }

  function toggleOverlapFilter(name: string) {
    setOverlapFilters((items) =>
      items.includes(name) ? items.filter((item) => item !== name) : [...items, name],
    );
  }

  async function addGame() {
    const trimmedName = newGameName.trim();
    if (!trimmedName) {
      setGameError("Escribe el nombre del juego antes de agregarlo.");
      return;
    }
    if (games.some((game) => game.name.toLowerCase() === trimmedName.toLowerCase())) {
      setGameError("Ese juego ya esta en la lista.");
      return;
    }
    setGameSaving(true);
    try {
      setGames(await createAppGame(trimmedName, voterName));
      setNewGameName("");
      setGameError("");
    } catch (err) {
      setGameError(err instanceof Error ? err.message : "No se pudo agregar el juego.");
    } finally {
      setGameSaving(false);
    }
  }

  async function toggleGameVote(game: GameOption) {
    if (!voterName) {
      setGameError("Selecciona quien vota antes de marcar un juego.");
      return;
    }
    setGameSaving(true);
    try {
      setGames(await toggleAppGameVote(game, voterName));
      setGameError("");
    } catch (err) {
      setGameError(err instanceof Error ? err.message : "No se pudo actualizar el voto del juego.");
    } finally {
      setGameSaving(false);
    }
  }

  async function removeGame(gameId: string) {
    setGameSaving(true);
    try {
      setGames(await deleteAppGame(gameId));
      setGameError("");
      setGameToDelete(null);
    } catch (err) {
      setGameError(err instanceof Error ? err.message : "No se pudo eliminar el juego.");
    } finally {
      setGameSaving(false);
    }
  }

  function openEditGame(game: GameOption) {
    setEditingGame(game);
    setEditingGameName(game.name);
    setGameError("");
  }

  function closeEditGame() {
    setEditingGame(null);
    setEditingGameName("");
  }

  async function saveEditGame() {
    if (!editingGame) return;
    const trimmedName = editingGameName.trim();
    if (!trimmedName) {
      setGameError("El juego no puede quedar vacio.");
      return;
    }
    if (games.some((game) => game.id !== editingGame.id && game.name.toLowerCase() === trimmedName.toLowerCase())) {
      setGameError("Ese juego ya esta en la lista.");
      return;
    }
    setGameSaving(true);
    try {
      setGames(await updateAppGameName(editingGame.id, trimmedName));
      setGameError("");
      closeEditGame();
    } catch (err) {
      setGameError(err instanceof Error ? err.message : "No se pudo editar el juego.");
    } finally {
      setGameSaving(false);
    }
  }

  function resetVotingFlow(options: { keepVoter?: boolean } = {}) {
    if (!options.keepVoter) {
      setVoterName("");
    }
    setPendingVoterName("");
    setCanPlay(null);
    setRanges([]);
    setComment("");
    setSavedRanges([]);
    setCollapsedRanges({});
    setDialModes({});
    setActiveRangeFields({});
  }

  function updateRange(index: number, field: TimeField, value: string) {
    setRanges((items) =>
      items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return { ...item, [field]: value };
      }),
    );
    setCollapsedRanges((items) => ({ ...items, [index]: false }));
  }

  function toggleOvernightRange(index: number, enabled: boolean) {
    updateRange(index, "end", enabled ? OVERNIGHT_TIME : PLACEHOLDER_TIME);
    setActiveRangeFields((items) => ({ ...items, [index]: "end" }));
    setDialModes((items) => ({ ...items, [`${index}-end`]: "hour" }));
  }

  function addRange() {
    setRanges((items) => [...items, DEFAULT_RANGE]);
    setCollapsedRanges((items) => ({ ...items, [ranges.length]: false }));
  }

  function removeRange(index: number) {
    const savedRange = savedRanges[index];
    if (savedRange) {
      setRanges((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, deleted: true } : item)));
      setCollapsedRanges((items) => ({ ...items, [index]: true }));
      return;
    }
    setRanges((items) => {
      const nextRanges = items.filter((_, itemIndex) => itemIndex !== index);
      setCollapsedRanges(Object.fromEntries(nextRanges.map((range, itemIndex) => [itemIndex, isCompleteRange(range)])));
      return nextRanges;
    });
    setSavedRanges((items) => items.filter((_, itemIndex) => itemIndex !== index));
    setDialModes({});
    setActiveRangeFields({});
  }

  function restoreRange(index: number) {
    setRanges((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, deleted: false } : item)));
    setCollapsedRanges((items) => ({ ...items, [index]: true }));
  }

  function resetRange(index: number) {
    setRanges((items) => items.map((item, itemIndex) => (itemIndex === index ? DEFAULT_RANGE : item)));
    setCollapsedRanges((items) => ({ ...items, [index]: false }));
    setDialModes((items) => ({
      ...items,
      [`${index}-start`]: "hour",
      [`${index}-end`]: "hour",
    }));
    setActiveRangeFields((items) => ({ ...items, [index]: "start" }));
  }

  function cancelRangeEdit(index: number) {
    const savedRange = savedRanges[index];
    setError("");
    if (!savedRange) {
      if (ranges.length >= 1) {
        removeRange(index);
        return;
      }
      return;
    }
    setRanges((items) => items.map((item, itemIndex) => (itemIndex === index ? savedRange : item)));
    setCollapsedRanges((items) => ({ ...items, [index]: true }));
    setDialModes((items) => ({
      ...items,
      [`${index}-start`]: "hour",
      [`${index}-end`]: "hour",
    }));
    setActiveRangeFields((items) => ({ ...items, [index]: "start" }));
  }

  function updateDialMode(index: number, field: TimeField, mode: "hour" | "minute") {
    setDialModes((items) => ({ ...items, [`${index}-${field}`]: mode }));
  }

  function updateActiveRangeField(index: number, field: TimeField) {
    setActiveRangeFields((items) => ({ ...items, [index]: field }));
  }

  function confirmRange(index: number) {
    const range = ranges[index];
    setError("");
    if (!range || !isCompleteRange(range)) {
      setError("Completa la hora de inicio y fin antes de avanzar.");
      return;
    }
    if (!isValidRange(range)) {
      setError("La hora final no puede ser inferior a la de inicio.");
      return;
    }
    setCollapsedRanges((items) => ({ ...items, [index]: true }));
  }

  function editRange(index: number) {
    setCollapsedRanges((items) => ({ ...items, [index]: false }));
  }

  async function saveVote() {
    if (!voterName) {
      return;
    }
    if (canPlay === null) return;

    setSaving(true);
    setError("");
    setNotificationNotice("");
    try {
      const usableRanges = canPlay ? ranges.filter(isActiveRange).map(({ start, end }) => ({ start, end })) : [];
      if (canPlay && !usableRanges.length) {
        if (!currentVote) {
          setError("Agrega al menos un rango horario antes de avanzar.");
          return;
        }
        const cleanSummary = await deleteAppVote(voterName);
        setSummary(cleanSummary);
        resetVotingFlow({ keepVoter: true });
        return;
      }
      if (canPlay && usableRanges.some((range) => !isCompleteRange(range))) {
        setError("Completa la hora de inicio y fin antes de avanzar.");
        return;
      }
      if (canPlay && usableRanges.some((range) => !isValidRange(range))) {
        setError("La hora final no puede ser inferior a la de inicio.");
        return;
      }
      const savedSummary = await saveAppVote(voterName, canPlay, usableRanges, comment.trim());
      setSummary(savedSummary);
      const notificationResult = await notifyResultsIfComplete(savedSummary);
      if (notificationResult?.notified) {
        setNotificationNotice("Voto guardado y resultados enviados a Discord.");
      } else if (notificationResult?.skipped) {
        setNotificationNotice(`Voto guardado. Discord no envio aviso: ${notificationResult.reason}`);
      } else if (notificationResult?.error) {
        setNotificationNotice(`Voto guardado. Discord fallo: ${notificationResult.error}`);
      }
      resetVotingFlow({ keepVoter: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar tu voto");
    } finally {
      setSaving(false);
    }
  }

  function addResultRangeToMyVote(range: Range) {
    if (!voterName) return;
    const baseRanges = canPlay === true ? ranges.filter(isActiveCompleteRange) : currentVote?.canPlay ? ranges.filter(isActiveCompleteRange) : [];
    const exists = baseRanges.some((item) => item.start === range.start && item.end === range.end);
    if (exists) {
      setError("Ese rango ya esta en tu voto.");
      return;
    }
    const nextRanges = [...baseRanges, range];
    setError("");
    setCanPlay(true);
    setRanges(nextRanges);
    setCollapsedRanges(Object.fromEntries(nextRanges.map((_, index) => [index, true])));
  }

  function removeResultRangeFromMyVote(index: number) {
    if (!voterName || !currentVote?.canPlay) return;
    const nextRanges = currentVote.ranges.map((range, itemIndex) =>
      itemIndex === index ? { ...range, deleted: true } : range,
    );
    setError("");
    setCanPlay(true);
    setComment(currentVote.comment);
    setRanges(nextRanges);
    setSavedRanges(currentVote.ranges);
    setCollapsedRanges(Object.fromEntries(nextRanges.map((_, rangeIndex) => [rangeIndex, true])));
  }

  function unlockAdmin() {
    setAdminError("");
    if ((IS_DEV || !USE_SUPABASE) && (!ADMIN_PIN || adminPin !== ADMIN_PIN)) {
      setAdminError("PIN incorrecto.");
      return;
    }
    setAdminUnlocked(true);
  }

  async function deleteDayVotes() {
    setAdminDeleting(true);
    setAdminError("");
    try {
      const cleanSummary = await deleteTodayVotes(adminPin);
      setSummary(cleanSummary);
      resetVotingFlow();
      setAdminOpen(false);
      setAdminUnlocked(false);
      setAdminConfirming(false);
      setAdminPin("");
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : "No se pudieron borrar los votos del dia.");
    } finally {
      setAdminDeleting(false);
    }
  }

  const dateLabel = summary ? formatDate(summary.date) : "Hoy";
  const hasPendingDeletedSavedRanges = ranges.some((range, index) => range.deleted && savedRanges[index]);
  const canSave =
    Boolean(voterName) &&
    canPlay !== null &&
    (canPlay === false || ranges.some(isActiveCompleteRange) || (Boolean(currentVote) && hasPendingDeletedSavedRanges));

  function shareResultsOnWhatsapp() {
    if (!summary) return;
    const message = buildResultsMessage(summary);
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="app-shell">
      <div className="app-layout">
        <div className="app-main">
          <header className="topbar">
            <div className="topbar-inner">
              <div>
                <p className="eyebrow">Pigs Manager</p>
                <h1>POR UN VICIO MEJOR</h1>
                <div className="meta-row">
                  <span>
                    <CalendarDays size={16} />
                    {dateLabel}
                  </span>
                </div>
              </div>
              <AdminControls
                adminDeleting={adminDeleting}
                adminError={adminError}
                adminOpen={adminOpen}
                adminPin={adminPin}
                adminUnlocked={adminUnlocked}
                adminConfirming={adminConfirming}
                onCancelConfirm={() => setAdminConfirming(false)}
                onDelete={deleteDayVotes}
                onPinChange={setAdminPin}
                onRequestDelete={() => setAdminConfirming(true)}
                onToggle={() => setAdminOpen((value) => !value)}
                onUnlock={unlockAdmin}
              />
            </div>
          </header>

          <div className="section-switch" aria-label="Secciones">
            <button className={activeSection === "today" ? "active" : ""} onClick={() => setActiveSection("today")}>
              HOY SE JUEGA?
            </button>
            <button className={activeSection === "game" ? "active" : ""} onClick={() => setActiveSection("game")}>
              QUE SE JUEGA?
            </button>
          </div>

          <section className="panel voter-panel-global">
            <h2 className="panel-title step-title sidebar-title">
              <span>
                <UserRound size={15} />
              </span>
              PIG QUE VOTA:
            </h2>
            <div className="voter-grid">
              {VOTERS.map((name) => (
                <button
                  className={`voter-button ${voterName === name ? "active" : ""} ${pendingVoterName === name ? "pending" : ""}`}
                  key={name}
                  onClick={() => requestVoterConfirmation(name)}
                >
                  <span className="voter-button-content">
                    <img className="voter-avatar" src={VOTER_AVATARS[name]} alt="" aria-hidden="true" />
                    <span>{name}</span>
                  </span>
                  {voterName === name ? <Check size={18} /> : null}
                </button>
              ))}
            </div>

            {pendingVoterName ? (
              <div className="voter-confirm">
                <img className="voter-confirm-avatar" src={VOTER_AVATARS[pendingVoterName]} alt="" aria-hidden="true" />
                <div className="voter-confirm-body">
                  <p>
                    Estas votando como <strong>{pendingVoterName}</strong>. Continuar?
                  </p>
                  <div>
                    <button onClick={confirmVoter}>SI, SOY {pendingVoterName}</button>
                    <button onClick={cancelVoterConfirmation}>CANCELAR</button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {activeSection === "today" ? (
            <div className="content-grid">
              <section className="space-y-4">
                {voterName ? (
                  <div className="panel vote-panel">
                    <div className="step-block first-step">
                      <h2 className="panel-title step-title">
                        <span>1</span>
                        DISPONIBILIDAD
                      </h2>
                      <div className="segmented" aria-label="Disponibilidad">
                        <button className={canPlay === true ? "active" : ""} onClick={() => setCanPlay(true)}>
                          Puedo jugar
                        </button>
                        <button className={canPlay === false ? "active danger" : ""} onClick={() => setCanPlay(false)}>
                          No puedo
                        </button>
                      </div>
                    </div>

                  {voterName && canPlay === true ? (
                    <div className="step-block">
                      <h2 className="panel-title step-title">
                        <span>2</span>
                        RANGO HORARIO
                      </h2>
                      <div className="space-y-4">
                        {ranges.map((range, index) => (
                          <RangeEditor
                            index={index}
                            key={index}
                            range={range}
                            canRemove
                            date={summary?.date}
                            onChange={updateRange}
                            onToggleOvernight={toggleOvernightRange}
                            onRemove={removeRange}
                            onRestore={restoreRange}
                            onReset={resetRange}
                            dialModes={dialModes}
                            onDialModeChange={updateDialMode}
                            activeField={activeRangeFields[index] ?? "start"}
                            onActiveFieldChange={updateActiveRangeField}
                            collapsed={Boolean(collapsedRanges[index])}
                            onConfirm={confirmRange}
                            onEdit={editRange}
                            onCancel={cancelRangeEdit}
                          />
                        ))}
                        <button
                          className={`add-range-button ${ranges.length ? "" : "wide"}`}
                          onClick={addRange}
                          title="Agregar rango"
                        >
                          <Plus size={17} />
                          {ranges.length ? null : "AGREGAR RANGO"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {voterName && canPlay === false ? (
                    <div className="notice">
                      <X size={18} />
                      Tu voto quedara guardado como no puedo jugar hoy.
                    </div>
                  ) : null}

                  {error ? <p className="error-text">{error}</p> : null}
                  {notificationNotice ? <p className="info-text">{notificationNotice}</p> : null}

                  {voterName && canPlay !== null ? (
                    <>
                      <label className="comment-field">
                        <span>Comentarios:</span>
                        <textarea
                          maxLength={180}
                          placeholder="Opcional"
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                        />
                      </label>
                      <button className="primary-button w-full" onClick={saveVote} disabled={saving || !canSave}>
                        {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        GUARDAR VOTO
                      </button>
                    </>
                  ) : null}
                  </div>
                ) : null}
              </section>

              <section className="space-y-6">
                <div className="panel">
                  <div className="section-heading">
                    <h2 className="panel-title">RESULTADOS DEL DIA</h2>
                    <div className="result-actions">
                      <span>{summary?.votes.length ?? 0} confirmaron</span>
                      <button className="secondary-button share-results-button" onClick={shareResultsOnWhatsapp} disabled={!summary || !summary.votes.length}>
                        <MessageCircle size={16} />
                        WHATSAPP
                      </button>
                    </div>
                  </div>
                  {summary?.suggestions?.length ? (
                    <div className="range-suggestions">
                      <h3>SUGERENCIAS</h3>
                      <div>
                        {summary.suggestions.map((suggestion) => (
                          <button
                            className="range-chip"
                            key={`${suggestion.start}-${suggestion.end}`}
                            onClick={() => addResultRangeToMyVote(suggestion)}
                            title="Agregar este rango a mi voto"
                          >
                            <strong>{formatRange(suggestion)}</strong>
                            <Plus size={16} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-4 grid gap-3">
                    {resultVotes.map((vote) => (
                      <VoteCard
                        key={vote.voter}
                        vote={vote}
                        currentVoter={voterName}
                        onAddRange={addResultRangeToMyVote}
                        onRemoveOwnRange={removeResultRangeFromMyVote}
                      />
                    ))}
                  </div>
                </div>

                <div className="panel">
                  <div className="section-heading">
                    <h2 className="panel-title">COINCIDENCIAS</h2>
                    <span>{filteredOverlaps.length} matches</span>
                  </div>
                  <div className="overlap-filter" aria-label="Filtrar coincidencias por jugador">
                    <span>Filtrar por:</span>
                    {VOTERS.map((name) => (
                      <button
                        className={overlapFilters.includes(name) ? "active" : ""}
                        key={name}
                        onClick={() => toggleOverlapFilter(name)}
                      >
                        <span>{name}</span>
                      </button>
                    ))}
                  </div>
                  <div className="overlap-list mt-4 grid gap-3">
                    {filteredOverlaps.length ? (
                      filteredOverlaps.map((overlap) => (
                        <div className="overlap-row" key={`${overlap.start}-${overlap.end}-${overlap.voters.join("-")}`}>
                            <strong>{formatRange(overlap)}</strong>
                          <span className="avatar-stack" aria-label={overlap.voters.join(", ")}>
                            {overlap.voters.map((voter) => (
                              <PlayerAvatar key={voter} name={voter} size="mini" />
                            ))}
                          </span>
                        </div>
                      ))
                    ) : summary?.overlaps.length ? (
                      <p className="empty-state">No hay coincidencias con ese filtro.</p>
                    ) : (
                      <p className="empty-state">Cuando haya horarios compatibles entre dos o mas personas, apareceran aca.</p>
                    )}
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <section className="panel game-panel">
                <div className="section-heading">
                  <h2 className="panel-title">QUE SE JUEGA?</h2>
                </div>

              <div className="game-add-row">
                <input
                  placeholder="Nombre del juego"
                  value={newGameName}
                  onChange={(event) => {
                    setNewGameName(event.target.value);
                    setGameError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      addGame();
                    }
                  }}
                  disabled={gameSaving}
                />
                <button className="secondary-button" onClick={addGame} disabled={gameSaving}>
                  <Plus size={17} />
                  AGREGAR JUEGO
                </button>
              </div>

              {gameError ? <p className="error-text">{gameError}</p> : null}

              <div className="game-list">
                {gamesLoading ? (
                  <p className="empty-state">Cargando juegos...</p>
                ) : sortedGames.length ? (
                  sortedGames.map((game) => {
                    const checked = voterName ? game.voters.includes(voterName) : false;
                    return (
                      <article className="game-row" key={game.id}>
                        <div className="game-main">
                          <label>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleGameVote(game)}
                              disabled={!voterName || gameSaving}
                            />
                            <span>{game.name}</span>
                          </label>
                        </div>
                        <div className="game-voters">
                          {game.voters.length ? (
                            game.voters.map((voter) => <span key={voter}>{voter}</span>)
                          ) : (
                            <em>Sin votos</em>
                          )}
                        </div>
                        <div className="game-actions">
                          <button className="icon-button small" onClick={() => openEditGame(game)} title="Editar juego" disabled={gameSaving}>
                            <Pencil size={15} />
                          </button>
                          <button className="icon-button small danger-button" onClick={() => setGameToDelete(game)} title="Eliminar juego" disabled={gameSaving}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <p className="empty-state">Todavia no hay juegos cargados.</p>
                )}
              </div>

              {editingGame ? (
                <div className="inline-modal" role="dialog" aria-modal="true" aria-label="Editar juego">
                  <div className="inline-modal-panel">
                    <div>
                      <h3>EDITAR JUEGO</h3>
                      <p>Los votos existentes se conservan.</p>
                    </div>
                    <input
                      value={editingGameName}
                      onChange={(event) => setEditingGameName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveEditGame();
                        if (event.key === "Escape") closeEditGame();
                      }}
                      autoFocus
                      disabled={gameSaving}
                    />
                    <div className="inline-modal-actions">
                      <button className="secondary-button" onClick={closeEditGame} disabled={gameSaving}>
                        CANCELAR
                      </button>
                      <button className="primary-button" onClick={saveEditGame} disabled={gameSaving}>
                        GUARDAR
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {gameToDelete ? (
                <div className="inline-modal" role="dialog" aria-modal="true" aria-label="Eliminar juego">
                  <div className="inline-modal-panel">
                    <div>
                      <h3>ELIMINAR JUEGO</h3>
                      <p>Seguro que queres eliminar {gameToDelete.name}? Tambien se borran sus votos.</p>
                    </div>
                    <div className="inline-modal-actions">
                      <button className="secondary-button" onClick={() => setGameToDelete(null)} disabled={gameSaving}>
                        CANCELAR
                      </button>
                      <button className="secondary-button danger-action" onClick={() => removeGame(gameToDelete.id)} disabled={gameSaving}>
                        <Trash2 size={15} />
                        ELIMINAR
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function AdminControls({
  adminDeleting,
  adminError,
  adminOpen,
  adminPin,
  adminUnlocked,
  adminConfirming,
  onCancelConfirm,
  onDelete,
  onPinChange,
  onRequestDelete,
  onToggle,
  onUnlock,
}: {
  adminDeleting: boolean;
  adminError: string;
  adminOpen: boolean;
  adminPin: string;
  adminUnlocked: boolean;
  adminConfirming: boolean;
  onCancelConfirm: () => void;
  onDelete: () => void;
  onPinChange: (value: string) => void;
  onRequestDelete: () => void;
  onToggle: () => void;
  onUnlock: () => void;
}) {
  return (
    <div className="admin-strip">
      <button className="secondary-button admin-toggle" onClick={onToggle}>
        ADMIN
      </button>
      {adminOpen ? (
        <div className="admin-panel">
          {!adminUnlocked ? (
            <>
              <label htmlFor="admin-pin">PIN</label>
              <input
                id="admin-pin"
                inputMode="numeric"
                type="password"
                value={adminPin}
                onChange={(event) => onPinChange(event.target.value)}
              />
              <button className="secondary-button" onClick={onUnlock}>
                ENTRAR
              </button>
            </>
          ) : adminConfirming ? (
            <div className="admin-confirm">
              <p>Seguro que queres borrar todos los votos de hoy?</p>
              <div>
                <button className="danger-admin-button" onClick={onDelete} disabled={adminDeleting}>
                  {adminDeleting ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                  SI, BORRAR
                </button>
                <button className="secondary-button" onClick={onCancelConfirm}>
                  CANCELAR
                </button>
              </div>
            </div>
          ) : (
            <button className="danger-admin-button" onClick={onRequestDelete} disabled={adminDeleting}>
              <Trash2 size={16} />
              BORRAR VOTOS DE HOY
            </button>
          )}
          {adminError ? <p className="admin-error">{adminError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function RangeEditor({
  index,
  range,
  canRemove,
  date,
  onChange,
  onToggleOvernight,
  onRemove,
  onRestore,
  onReset,
  dialModes,
  onDialModeChange,
  activeField,
  onActiveFieldChange,
  collapsed,
  onConfirm,
  onEdit,
  onCancel,
}: {
  index: number;
  range: Range;
  canRemove: boolean;
  date?: string;
  onChange: (index: number, field: TimeField, value: string) => void;
  onToggleOvernight: (index: number, enabled: boolean) => void;
  onRemove: (index: number) => void;
  onRestore: (index: number) => void;
  onReset: (index: number) => void;
  dialModes: DialModes;
  onDialModeChange: (index: number, field: TimeField, mode: "hour" | "minute") => void;
  activeField: TimeField;
  onActiveFieldChange: (index: number, field: TimeField) => void;
  collapsed: boolean;
  onConfirm: (index: number) => void;
  onEdit: (index: number) => void;
  onCancel: (index: number) => void;
}) {
  const startDate = date ? formatShortDate(date) : "hoy";
  const endDate = date ? formatShortDate(range.end === "24:00" || isOvernightTime(range.end) ? addDays(date, 1) : date) : "hoy";
  const rangeSummary = isCompleteRange(range) ? formatRange(range) : "Sin confirmar";

  if (collapsed) {
    return (
      <article className={`range-card range-card-collapsed ${range.deleted ? "range-card-deleted" : ""}`}>
        <button className="range-collapsed-summary" onClick={() => (range.deleted ? onRestore(index) : onEdit(index))}>
          <span>Rango {index + 1}</span>
          <strong>{range.deleted ? `${rangeSummary} - pendiente de eliminar` : rangeSummary}</strong>
        </button>
        <div className="range-actions">
          {range.deleted ? (
            <button className="icon-button small" onClick={() => onRestore(index)} title="Recuperar rango">
              <RotateCcw size={15} />
            </button>
          ) : (
            <>
              <button className="icon-button small" onClick={() => onEdit(index)} title="Editar rango">
                <Pencil size={15} />
              </button>
              <button className="icon-button small danger-button" onClick={() => onRemove(index)} disabled={!canRemove} title="Quitar rango">
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <article className="range-card">
      <div className="range-card-header">
        <strong>Rango {index + 1}</strong>
        <div className="range-actions">
          <button className="icon-button small" onClick={() => onReset(index)} title="Resetear rango">
            <RotateCcw size={15} />
          </button>
          <button className="icon-button small danger-button" onClick={() => onRemove(index)} disabled={!canRemove} title="Quitar rango">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="range-time-switcher">
        <button className={activeField === "start" ? "active" : ""} onClick={() => onActiveFieldChange(index, "start")}>
          <span>
            DESDE
            <small>{startDate}</small>
          </span>
          <strong>{range.start}</strong>
        </button>
        <button className={activeField === "end" ? "active" : ""} onClick={() => onActiveFieldChange(index, "end")}>
          <span>
            HASTA
            <small>{endDate}</small>
          </span>
          <strong>{range.end}</strong>
        </button>
      </div>
      {activeField === "end" ? (
        <label className={`overnight-toggle ${isOvernightTime(range.end) ? "active" : ""}`}>
          <input
            type="checkbox"
            checked={isOvernightTime(range.end)}
            onChange={(event) => onToggleOvernight(index, event.target.checked)}
          />
          <span>TRASNOCHE</span>
        </label>
      ) : null}
      {activeField === "end" && isOvernightTime(range.end) ? (
        <div className="overnight-preview">
          <strong>TRASNOCHE</strong>
          <span>Sin hora final por ahora.</span>
        </div>
      ) : (
        <TimePicker
          value={range[activeField]}
          dialMode={dialModes[`${index}-${activeField}`] ?? "hour"}
          onDialModeChange={(nextMode) => onDialModeChange(index, activeField, nextMode)}
          onChange={(value) => onChange(index, activeField, value)}
        />
      )}
      <div className="range-edit-actions with-cancel">
        <button className="cancel-range-button" onClick={() => onCancel(index)}>
          <X size={17} />
          CANCELAR
        </button>
        <button className="confirm-range-button" onClick={() => onConfirm(index)}>
          <Check size={17} />
          CONFIRMAR RANGO
        </button>
      </div>
    </article>
  );
}

function TimePicker({
  value,
  dialMode,
  onDialModeChange,
  onChange,
}: {
  value: string;
  dialMode: "hour" | "minute";
  onDialModeChange: (mode: "hour" | "minute") => void;
  onChange: (value: string) => void;
}) {
  const { hour: selectedHour, minute: selectedMinute } = splitTime(value);

  function selectHour(hour: string) {
    const minute = hour === "24" ? "00" : selectedMinute === "MM" ? "MM" : selectedMinute;
    onChange(`${hour}:${minute}`);
  }

  function selectMinute(minute: string) {
    if (selectedHour === "24" && minute !== "00") return;
    onChange(`${selectedHour}:${minute}`);
  }

  const handAngle = dialMode === "hour" && isSelectedHour(value)
    ? (Number(selectedHour) % 12) * 30
    : dialMode === "minute" && isSelectedMinute(value)
      ? Number(selectedMinute) * 6
      : 0;
  const handLength = dialMode === "hour" && isSelectedHour(value) && (selectedHour === "00" || Number(selectedHour) >= 13) ? "short" : "long";

  return (
    <div className="time-picker">
      <div className="clock-readout">
        <button className={dialMode === "hour" ? "active" : ""} onClick={() => onDialModeChange("hour")}>
          {selectedHour === "HH" ? "HORA" : selectedHour}
        </button>
        <span>:</span>
        <button className={dialMode === "minute" ? "active" : ""} onClick={() => onDialModeChange("minute")}>
          {selectedMinute === "MM" ? "MINUTOS" : selectedMinute}
        </button>
        <small>hs</small>
      </div>
      <div className={`clock-face ${dialMode}`}>
        {Array.from({ length: 60 }, (_, index) => (
          <span
            className={`clock-marker ${index % 5 === 0 ? "major" : "minor"}`}
            key={index}
            style={{ "--angle": `${index * 6}deg` } as React.CSSProperties}
          />
        ))}
        <div
          className={`clock-hand ${handLength} ${dialMode === "hour" && !isSelectedHour(value) ? "idle" : ""} ${dialMode === "minute" && !isSelectedMinute(value) ? "idle" : ""}`}
          style={{ transform: `rotate(${handAngle}deg)` }}
        />
        <div className="clock-center" />
        {dialMode === "hour"
          ? (
            <>
              {OUTER_HOURS.map((hour, index) => (
                <ClockOption
                  key={hour}
                  label={String(Number(hour))}
                  value={hour}
                  selected={selectedHour === hour}
                  index={index}
                  total={OUTER_HOURS.length}
                  radius={36.8}
                  onClick={() => selectHour(hour)}
                />
              ))}
              {INNER_HOURS.map((hour, index) => (
                <ClockOption
                  key={hour}
                  label={hour}
                  value={hour}
                  selected={selectedHour === hour}
                  index={index}
                  total={INNER_HOURS.length}
                  radius={24.5}
                  variant="inner"
                  onClick={() => selectHour(hour)}
                />
              ))}
            </>
          )
          : MINUTES.map((minute, index) => (
              <ClockOption
                key={minute}
                label={minute}
                value={minute}
                selected={selectedMinute === minute}
                disabled={selectedHour === "24" && minute !== "00"}
                index={index}
                total={MINUTES.length}
                radius={36.8}
                onClick={() => selectMinute(minute)}
              />
            ))}
      </div>
    </div>
  );
}

function ClockOption({
  label,
  value,
  selected,
  disabled,
  index,
  total,
  radius,
  variant,
  onClick,
}: {
  label: string;
  value: string;
  selected: boolean;
  disabled?: boolean;
  index: number;
  total: number;
  radius: number;
  variant?: "inner";
  onClick: () => void;
}) {
  const angle = -90 + (index * 360) / total;
  const x = 50 + Math.cos((angle * Math.PI) / 180) * radius;
  const y = 50 + Math.sin((angle * Math.PI) / 180) * radius;

  return (
    <button
      className={`clock-option ${variant ?? ""} ${selected ? "selected" : ""}`}
      disabled={disabled}
      onClick={onClick}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {label}
    </button>
  );
}

function PlayerAvatar({ name, size = "small" }: { name: string; size?: "micro" | "mini" | "small" }) {
  return (
    <img
      className={`player-avatar ${size}`}
      src={VOTER_AVATARS[name] ?? VOTER_AVATARS.MISHA}
      alt=""
      aria-hidden="true"
      title={name}
    />
  );
}

function VoteCard({
  vote,
  currentVoter,
  onAddRange,
  onRemoveOwnRange,
}: {
  vote: Vote;
  currentVoter: string;
  onAddRange: (range: Range) => void;
  onRemoveOwnRange: (index: number) => void;
}) {
  const isOwnVote = Boolean(currentVoter) && vote.voter === currentVoter;
  const canCopyRange = Boolean(currentVoter) && !isOwnVote;

  return (
    <article className="vote-card">
      <div className="vote-card-header">
        <div className="vote-player">
          <PlayerAvatar name={vote.voter} size="small" />
          <h3>{vote.voter}</h3>
        </div>
        {vote.updatedAt ? <p>Actualizado {formatUpdatedAt(vote.updatedAt)}</p> : null}
      </div>
      {!vote.updatedAt ? (
        <span className="no-vote">No tiene votos hoy</span>
      ) : vote.canPlay && vote.ranges.length ? (
        <div className="range-list">
          {vote.ranges.map((range, index) => (
            <span className="range-chip" key={`${range.start}-${range.end}-${index}`}>
              <strong>{formatRange(range)}</strong>
              {canCopyRange ? (
                <button onClick={() => onAddRange(range)} title="Agregar este rango a mi voto">
                  <Plus size={14} />
                </button>
              ) : null}
              {isOwnVote ? (
                <button className="danger" onClick={() => onRemoveOwnRange(index)} title="Borrar este rango de mi voto">
                  <X size={14} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : vote.canPlay ? (
        <span className="no-vote">No tiene votos hoy</span>
      ) : (
        <span className="cannot-play">No puede jugar hoy</span>
      )}
      {vote.comment ? <blockquote className="vote-comment">"{vote.comment}"</blockquote> : null}
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
