import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Check,
  Clock3,
  Loader2,
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
};

type DialModes = Record<string, "hour" | "minute">;
type ActiveRangeFields = Record<string, keyof Range>;
type CollapsedRanges = Record<number, boolean>;

type Vote = {
  voter: string;
  canPlay: boolean;
  ranges: Range[];
  updatedAt: string;
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
};

type SupabaseVoteRow = {
  date: string;
  voter_key: string;
  voter: string;
  can_play: boolean;
  ranges: Range[];
  updated_at: string;
};

const API_BASE = import.meta.env.DEV ? "http://127.0.0.1:8000/api" : "/api";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const VOTERS = ["MISHA", "LEKU", "SEPIA", "ICHITBO"];
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const END_HOURS = [...HOURS, "24"];
const OUTER_HOURS = ["12", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"];
const INNER_HOURS = ["00", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23"];
const MIN_RANGE_MINUTES = 5;
const PLACEHOLDER_TIME = "HH:MM";
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
  return isSelectedTime(range.start) && isSelectedTime(range.end);
}

function isValidRange(range: Range) {
  return isCompleteRange(range) && timeToMinutes(range.end) - timeToMinutes(range.start) >= MIN_RANGE_MINUTES;
}

function minutesToTime(value: number) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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
    voter: row.voter,
    canPlay: row.can_play,
    ranges: row.ranges,
    updatedAt: row.updated_at,
  };
}

function toOverlap(start: number, end: number, voters: string[]) {
  return { start: minutesToTime(start), end: minutesToTime(end), voters };
}

function calculateOverlaps(votes: Vote[]): Summary["overlaps"] {
  const events = new Map<string, Set<string>>();

  votes.forEach((vote) => {
    if (!vote.canPlay) return;
    vote.ranges.forEach((range) => {
      for (let minute = timeToMinutes(range.start); minute < timeToMinutes(range.end); minute += 5) {
        const key = `${minute}-${minute + 5}`;
        const voters = events.get(key) ?? new Set<string>();
        voters.add(vote.voter);
        events.set(key, voters);
      }
    });
  });

  const overlaps: Summary["overlaps"] = [];
  let activeVoters: string[] | null = null;
  let activeStart: number | null = null;
  let activeEnd: number | null = null;

  Array.from(events.entries())
    .map(([key, voters]) => {
      const [start, end] = key.split("-").map(Number);
      return { start, end, voters: Array.from(voters).sort() };
    })
    .sort((a, b) => a.start - b.start)
    .forEach(({ start, end, voters }) => {
      if (voters.length < 2) return;
      const sameVoters = activeVoters?.join("|") === voters.join("|");
      if (sameVoters && activeEnd === start) {
        activeEnd = end;
        return;
      }
      if (activeVoters && activeStart !== null && activeEnd !== null) {
        overlaps.push(toOverlap(activeStart, activeEnd, activeVoters));
      }
      activeVoters = voters;
      activeStart = start;
      activeEnd = end;
    });

  if (activeVoters && activeStart !== null && activeEnd !== null) {
    overlaps.push(toOverlap(activeStart, activeEnd, activeVoters));
  }

  return overlaps;
}

async function supabaseRequest<T>(path: string, options?: RequestInit): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Faltan las variables de Supabase.");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
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
  const votes = rows.map(voteFromSupabaseRow);

  return {
    date,
    timezone: "America/Argentina/Buenos_Aires",
    votes,
    overlaps: calculateOverlaps(votes),
  };
}

async function saveAppVote(voter: string, canPlay: boolean, ranges: Range[]): Promise<Summary> {
  if (!USE_SUPABASE) {
    return request<Summary>("/votes", {
      method: "POST",
      body: JSON.stringify({ voter, canPlay, ranges }),
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
      updated_at: nowBuenosAires(),
    }),
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [voterName, setVoterName] = useState("");
  const [pendingVoterName, setPendingVoterName] = useState("");
  const [canPlay, setCanPlay] = useState<boolean | null>(null);
  const [ranges, setRanges] = useState<Range[]>([DEFAULT_RANGE]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dialModes, setDialModes] = useState<DialModes>({});
  const [activeRangeFields, setActiveRangeFields] = useState<ActiveRangeFields>({});
  const [collapsedRanges, setCollapsedRanges] = useState<CollapsedRanges>({});

  const currentVote = useMemo(
    () => summary?.votes.find((vote) => vote.voter.toLowerCase() === voterName.toLowerCase()),
    [summary, voterName],
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

  useEffect(() => {
    loadSummary();
  }, []);

  useEffect(() => {
    if (!voterName) {
      setCanPlay(null);
      setRanges([DEFAULT_RANGE]);
      return;
    }

    if (currentVote) {
      setCanPlay(currentVote.canPlay);
      setRanges(currentVote.ranges.length ? currentVote.ranges : [DEFAULT_RANGE]);
      setCollapsedRanges({});
      return;
    }

    setCanPlay(null);
    setRanges([DEFAULT_RANGE]);
    setCollapsedRanges({});
  }, [currentVote, voterName]);

  function requestVoterConfirmation(name: string) {
    if (voterName === name) return;
    setPendingVoterName(name);
    setError("");
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

  function updateRange(index: number, field: keyof Range, value: string) {
    setRanges((items) =>
      items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return { ...item, [field]: value };
      }),
    );
    setCollapsedRanges((items) => ({ ...items, [index]: false }));
  }

  function addRange() {
    setRanges((items) => [...items, DEFAULT_RANGE]);
    setCollapsedRanges((items) => ({ ...items, [ranges.length]: false }));
  }

  function removeRange(index: number) {
    setRanges((items) => (items.length === 1 ? items : items.filter((_, itemIndex) => itemIndex !== index)));
    setCollapsedRanges({});
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

  function updateDialMode(index: number, field: keyof Range, mode: "hour" | "minute") {
    setDialModes((items) => ({ ...items, [`${index}-${field}`]: mode }));
  }

  function updateActiveRangeField(index: number, field: keyof Range) {
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
    try {
      const usableRanges = canPlay ? ranges : [];
      if (canPlay && usableRanges.some((range) => !isCompleteRange(range))) {
        setError("Completa la hora de inicio y fin antes de avanzar.");
        return;
      }
      if (canPlay && usableRanges.some((range) => !isValidRange(range))) {
        setError("La hora final no puede ser inferior a la de inicio.");
        return;
      }
      const savedSummary = await saveAppVote(voterName, canPlay, usableRanges);
      setSummary(savedSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar tu voto");
    } finally {
      setSaving(false);
    }
  }

  const dateLabel = summary ? formatDate(summary.date) : "Hoy";
  const canSave = Boolean(voterName) && canPlay !== null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div>
            <p className="eyebrow">Vicio manager</p>
            <h1>HOY SE JUEGA?</h1>
            <div className="meta-row">
              <span>
                <CalendarDays size={16} />
                {dateLabel}
              </span>
              <span>
                <Clock3 size={16} />
                Buenos Aires
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="content-grid">
        <section className="space-y-4">
          <div className="panel vote-panel">
            <h2 className="panel-title step-title">
              <span>1</span>
              <UserRound size={18} />
              CHUPAPIG QUE VOTA:
            </h2>
            <div className="voter-grid">
              {VOTERS.map((name) => (
                <button
                  className={`voter-button ${voterName === name ? "active" : ""} ${pendingVoterName === name ? "pending" : ""}`}
                  key={name}
                  onClick={() => requestVoterConfirmation(name)}
                >
                  <span>{name}</span>
                  {voterName === name ? <Check size={18} /> : null}
                </button>
              ))}
            </div>

            {pendingVoterName ? (
              <div className="voter-confirm">
                <p>Estas votando como {pendingVoterName}?</p>
                <div>
                  <button onClick={confirmVoter}>SI, SOY {pendingVoterName}</button>
                  <button onClick={cancelVoterConfirmation}>CANCELAR</button>
                </div>
              </div>
            ) : null}

            {voterName ? (
              <div className="step-block">
                <h2 className="panel-title step-title">
                  <span>2</span>
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
            ) : null}

            {voterName && canPlay === true ? (
              <div className="step-block">
                <h2 className="panel-title step-title">
                  <span>3</span>
                  RANGO HORARIO
                </h2>
                <div className="space-y-4">
                  {ranges.map((range, index) => (
                    <RangeEditor
                      index={index}
                      key={index}
                      range={range}
                      canRemove={ranges.length > 1}
                      date={summary?.date}
                      onChange={updateRange}
                      onRemove={removeRange}
                      onReset={resetRange}
                      dialModes={dialModes}
                      onDialModeChange={updateDialMode}
                      activeField={activeRangeFields[index] ?? "start"}
                      onActiveFieldChange={updateActiveRangeField}
                      collapsed={Boolean(collapsedRanges[index])}
                      onConfirm={confirmRange}
                      onEdit={editRange}
                    />
                  ))}
                  <button className="add-range-button" onClick={addRange} title="Agregar otro rango">
                    <Plus size={17} />
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

            {voterName && canPlay !== null ? (
              <button className="primary-button w-full" onClick={saveVote} disabled={saving || !canSave}>
                {saving ? <Loader2 className="animate-spin" size={18} /> : currentVote ? <Pencil size={18} /> : <Save size={18} />}
                {currentVote ? "ACTUALIZAR VOTO" : "GUARDAR VOTO"}
              </button>
            ) : null}
          </div>
        </section>

        <section className="space-y-6">
          <div className="panel">
            <div className="section-heading">
              <h2 className="panel-title">RESULTADOS DEL DIA</h2>
              <span>{summary?.votes.length ?? 0} confirmaron</span>
            </div>
            <div className="mt-4 grid gap-3">
              {summary?.votes.length ? (
                summary.votes.map((vote) => <VoteCard key={vote.voter} vote={vote} />)
              ) : (
                <p className="empty-state">Todavia no hay votos cargados para hoy.</p>
              )}
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">COINCIDENCIAS</h2>
            <div className="mt-4 grid gap-3">
              {summary?.overlaps.length ? (
                summary.overlaps.map((overlap) => (
                  <div className="overlap-row" key={`${overlap.start}-${overlap.end}-${overlap.voters.join("-")}`}>
                    <strong>
                      {overlap.start} hs a {overlap.end} hs
                    </strong>
                    <span>{overlap.voters.join(", ")}</span>
                  </div>
                ))
              ) : (
                <p className="empty-state">Cuando haya horarios compatibles entre dos o mas personas, apareceran aca.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function RangeEditor({
  index,
  range,
  canRemove,
  date,
  onChange,
  onRemove,
  onReset,
  dialModes,
  onDialModeChange,
  activeField,
  onActiveFieldChange,
  collapsed,
  onConfirm,
  onEdit,
}: {
  index: number;
  range: Range;
  canRemove: boolean;
  date?: string;
  onChange: (index: number, field: keyof Range, value: string) => void;
  onRemove: (index: number) => void;
  onReset: (index: number) => void;
  dialModes: DialModes;
  onDialModeChange: (index: number, field: keyof Range, mode: "hour" | "minute") => void;
  activeField: keyof Range;
  onActiveFieldChange: (index: number, field: keyof Range) => void;
  collapsed: boolean;
  onConfirm: (index: number) => void;
  onEdit: (index: number) => void;
}) {
  const startDate = date ? formatShortDate(date) : "hoy";
  const endDate = date ? formatShortDate(range.end === "24:00" ? addDays(date, 1) : date) : "hoy";
  const rangeSummary = isCompleteRange(range) ? `${range.start} hs a ${range.end} hs` : "Sin confirmar";

  if (collapsed) {
    return (
      <article className="range-card range-card-collapsed">
        <button className="range-collapsed-summary" onClick={() => onEdit(index)}>
          <span>Rango {index + 1}</span>
          <strong>{rangeSummary}</strong>
        </button>
        <div className="range-actions">
          <button className="icon-button small" onClick={() => onEdit(index)} title="Editar rango">
            <Pencil size={15} />
          </button>
          <button className="icon-button small danger-button" onClick={() => onRemove(index)} disabled={!canRemove} title="Quitar rango">
            <Trash2 size={16} />
          </button>
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
      <TimePicker
        value={range[activeField]}
        dialMode={dialModes[`${index}-${activeField}`] ?? "hour"}
        onDialModeChange={(nextMode) => onDialModeChange(index, activeField, nextMode)}
        onChange={(value) => onChange(index, activeField, value)}
      />
      <button className="confirm-range-button" onClick={() => onConfirm(index)}>
        <Check size={17} />
        CONFIRMAR RANGO
      </button>
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
                  radius={31.5}
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
                  radius={19.5}
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
                radius={31.5}
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

function VoteCard({ vote }: { vote: Vote }) {
  return (
    <article className="vote-card">
      <div className="vote-card-header">
        <h3>{vote.voter}</h3>
        <p>Actualizado {new Intl.DateTimeFormat("es-AR", { timeStyle: "short", dateStyle: "short" }).format(new Date(vote.updatedAt))}</p>
      </div>
      {vote.canPlay ? (
        <div className="range-list">
          {vote.ranges.map((range) => (
            <span key={`${range.start}-${range.end}`}>
              {range.start} hs a {range.end} hs
            </span>
          ))}
        </div>
      ) : (
        <span className="cannot-play">No puede jugar hoy</span>
      )}
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
