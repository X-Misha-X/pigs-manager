const TIMEZONE = "America/Argentina/Buenos_Aires";

function todayBuenosAires() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

async function readJsonBody(request) {
  if (typeof request.body === "string") {
    return request.body.trim() ? JSON.parse(request.body) : {};
  }
  if (Buffer.isBuffer(request.body)) {
    const rawBody = request.body.toString("utf8");
    return rawBody.trim() ? JSON.parse(rawBody) : {};
  }
  if (request.body && typeof request.body === "object" && typeof request.body.pipe !== "function") {
    return request.body;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody.trim() ? JSON.parse(rawBody) : {};
}

async function deleteNotificationMark(date) {
  const eventKey = encodeURIComponent(`today-results:${date}`);
  await supabaseRequest(`/notification_events?event_key=eq.${eventKey}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export default async function handler(request, response) {
  if (request.method !== "DELETE") {
    response.setHeader("Allow", "DELETE");
    response.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  try {
    const adminPin = process.env.NOTIFICATION_ADMIN_PIN || process.env.VITE_ADMIN_PIN;
    const body = await readJsonBody(request);

    if (!adminPin || body.pin !== adminPin) {
      response.status(403).json({ error: "PIN incorrecto." });
      return;
    }

    const date = typeof body.date === "string" ? body.date : todayBuenosAires();
    await supabaseRequest(`/votes?date=eq.${encodeURIComponent(date)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    await deleteNotificationMark(date);

    response.status(200).json({ ok: true, date });
  } catch (error) {
    console.error("No se pudieron borrar los votos del dia.", error);
    response.status(error.status ?? 500).json({ error: error.message ?? "No se pudieron borrar los votos del dia." });
  }
}
