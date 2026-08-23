const VOTERS = ["MISHA", "LEKU", "SEPIA", "ICHITBO"];
const TIMEZONE = "America/Argentina/Buenos_Aires";

function todayBuenosAires() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "full",
    timeZone: TIMEZONE,
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function timeToMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function rangeEndToMinutes(range) {
  return range.end === "TRASNOCHE" ? 24 * 60 : timeToMinutes(range.end);
}

function minutesToTime(value) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function minutesToRangeEnd(value) {
  return value >= 24 * 60 ? "TRASNOCHE" : minutesToTime(value);
}

function formatRange(range) {
  const end = range.end === "TRASNOCHE" ? "TRASNOCHE" : `${range.end} hs`;
  return `${range.start} hs a ${end}`;
}

const DISCORD_EMOJI = {
  calendar: String.fromCodePoint(0x1f4c5),
  check: String.fromCodePoint(0x2705),
  trophy: String.fromCodePoint(0x1f3c6),
  medals: [String.fromCodePoint(0x1f947), String.fromCodePoint(0x1f948), String.fromCodePoint(0x1f949)],
  star: String.fromCodePoint(0x2b50),
};

function combinations(items, size) {
  if (size === 0) return [[]];
  if (items.length < size) return [];

  return items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));
}

function intersectRanges(existing, ranges) {
  const next = [];
  existing.forEach(([currentStart, currentEnd]) => {
    ranges.forEach((range) => {
      const start = Math.max(currentStart, timeToMinutes(range.start));
      const end = Math.min(currentEnd, rangeEndToMinutes(range));
      if (end > start) next.push([start, end]);
    });
  });
  return next;
}

function mergeIntervals(intervals) {
  return intervals
    .sort(([aStart, aEnd], [bStart, bEnd]) => aStart - bStart || aEnd - bEnd)
    .reduce((merged, [start, end]) => {
      const last = merged.at(-1);
      if (last && start <= last[1]) {
        last[1] = Math.max(last[1], end);
        return merged;
      }
      merged.push([start, end]);
      return merged;
    }, []);
}

function calculateOverlaps(votes) {
  const playableVotes = votes.filter((vote) => vote.canPlay && vote.ranges.length);
  const overlapsByTime = new Map();

  for (let size = 2; size <= playableVotes.length; size += 1) {
    combinations(playableVotes, size).forEach((group) => {
      const [firstVote, ...otherVotes] = group;
      const initialIntervals = firstVote.ranges.map((range) => [timeToMinutes(range.start), rangeEndToMinutes(range)]);
      const commonIntervals = otherVotes.reduce((intervals, vote) => intersectRanges(intervals, vote.ranges), initialIntervals);
      const voters = group.map((vote) => vote.voter).sort();

      mergeIntervals(commonIntervals).forEach(([start, end]) => {
        const key = `${start}-${end}`;
        const existingVoters = overlapsByTime.get(key) ?? new Set();
        voters.forEach((voter) => existingVoters.add(voter));
        overlapsByTime.set(key, existingVoters);
      });
    });
  }

  return [...overlapsByTime.entries()]
    .map(([key, voters]) => {
      const [start, end] = key.split("-").map(Number);
      return { start: minutesToTime(start), end: minutesToRangeEnd(end), voters: [...voters].sort() };
    })
    .filter((overlap) => overlap.voters.length >= 2)
    .sort((first, second) => {
      const playersDiff = second.voters.length - first.voters.length;
      if (playersDiff) return playersDiff;
      const durationDiff = rangeEndToMinutes(second) - timeToMinutes(second.start) - (rangeEndToMinutes(first) - timeToMinutes(first.start));
      if (durationDiff) return durationDiff;
      return timeToMinutes(first.start) - timeToMinutes(second.start);
    });
}

function voteFromRow(row) {
  return {
    voter: row.voter,
    canPlay: row.can_play,
    ranges: row.ranges ?? [],
    comment: row.comment ?? "",
    updatedAt: row.updated_at,
  };
}

function buildDiscordEmbed(date, votes, overlaps) {
  const overlapLines = overlaps.length
    ? overlaps
        .slice(0, 5)
        .map((overlap, index) => {
          const rank = DISCORD_EMOJI.medals[index] ?? DISCORD_EMOJI.star;
          return `${rank} **${formatRange(overlap)}**\n${overlap.voters.join(", ")}`;
        })
    : ["Sin coincidencias para todos por ahora."];

  return {
    author: {
      name: "Pigs Manager",
    },
    title: "Resultados del día",
    description: [
      `${DISCORD_EMOJI.calendar} ${formatDate(date)}`,
      "",
      `${DISCORD_EMOJI.check} **${votes.length}/${VOTERS.length} confirmaron**`,
    ].join("\n"),
    color: 0xff4fa3,
    fields: [
      {
        name: `${DISCORD_EMOJI.trophy} TOP MATCHES`,
        value: overlapLines.join("\n\n"),
        inline: false,
      },
    ],
  };
}

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Faltan VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  }

  const response = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(body || "Supabase no pudo completar la solicitud.");
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return undefined;
  return response.json();
}

async function markNotificationPending(date) {
  const eventKey = `today-results:${date}`;

  try {
    await supabaseRequest("/notification_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        event_key: eventKey,
        date,
        channel: "discord",
      }),
    });
  } catch (error) {
    if (error.status === 409) return false;
    throw error;
  }

  return true;
}

async function getNotificationStatus(date) {
  const eventKey = encodeURIComponent(`today-results:${date}`);
  const rows = await supabaseRequest(`/notification_events?event_key=eq.${eventKey}&select=event_key,created_at&limit=1`);
  return rows.length > 0 ? rows[0] : null;
}

async function deleteNotificationMark(date) {
  const eventKey = encodeURIComponent(`today-results:${date}`);
  await supabaseRequest(`/notification_events?event_key=eq.${eventKey}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    return request.body.trim() ? JSON.parse(request.body) : {};
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody.trim() ? JSON.parse(rawBody) : {};
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    const date = typeof request.query?.date === "string" ? request.query.date : todayBuenosAires();
    const hasDiscordWebhook = Boolean(process.env.DISCORD_WEBHOOK_URL);
    const hasSupabaseUrl = Boolean(process.env.VITE_SUPABASE_URL);
    const hasSupabaseServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

    if (!hasSupabaseUrl || !hasSupabaseServiceRole) {
      response.status(200).json({
        ok: true,
        date,
        configured: {
          discordWebhook: hasDiscordWebhook,
          supabaseUrl: hasSupabaseUrl,
          supabaseServiceRole: hasSupabaseServiceRole,
        },
      });
      return;
    }

    try {
      const rows = await supabaseRequest(`/votes?date=eq.${encodeURIComponent(date)}&select=*&order=voter.asc`);
      const votes = rows.map(voteFromRow);
      const votedKeys = new Set(votes.map((vote) => vote.voter.toLowerCase()));
      const missingVoters = VOTERS.filter((voter) => !votedKeys.has(voter.toLowerCase()));
      const notification = await getNotificationStatus(date);

      response.status(200).json({
        ok: true,
        date,
        configured: {
          discordWebhook: hasDiscordWebhook,
          supabaseUrl: hasSupabaseUrl,
          supabaseServiceRole: hasSupabaseServiceRole,
        },
        voteCount: votes.length,
        expectedVoteCount: VOTERS.length,
        missingVoters,
        notificationSent: Boolean(notification),
        notificationCreatedAt: notification?.created_at ?? null,
      });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "No se pudo diagnosticar Discord." });
    }
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!discordWebhookUrl) {
    response.status(200).json({ ok: true, skipped: true, reason: "Discord no esta configurado." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const date = typeof body.date === "string" ? body.date : todayBuenosAires();
    const force = body.force === true;
    const adminPin = process.env.ADMIN_PIN || process.env.NOTIFICATION_ADMIN_PIN || process.env.VITE_ADMIN_PIN;
    const rows = await supabaseRequest(`/votes?date=eq.${encodeURIComponent(date)}&select=*&order=voter.asc`);
    const votes = rows.map(voteFromRow);
    const votedKeys = new Set(votes.map((vote) => vote.voter.toLowerCase()));
    const allVoted = VOTERS.every((voter) => votedKeys.has(voter.toLowerCase()));

    if (!allVoted) {
      response.status(200).json({ ok: true, skipped: true, reason: "Todavia faltan votos." });
      return;
    }

    const previousNotification = await getNotificationStatus(date);
    if (previousNotification && !force) {
      response.status(200).json({ ok: true, skipped: true, reason: "Los resultados ya fueron enviados." });
      return;
    }
    if (force) {
      if (!adminPin || body.pin !== adminPin) {
        response.status(403).json({ error: "PIN incorrecto." });
        return;
      }
      await deleteNotificationMark(date);
    }

    const overlaps = calculateOverlaps(votes);
    const discordResponse = await fetch(discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Pigs Manager",
        content: "Ya votaron todos.",
        embeds: [buildDiscordEmbed(date, votes, overlaps)],
      }),
    });

    if (!discordResponse.ok) {
      response.status(502).json({ error: "Discord no acepto la notificacion." });
      return;
    }

    await markNotificationPending(date);
    response.status(200).json({ ok: true, notified: true });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "No se pudo enviar la notificacion." });
  }
}
