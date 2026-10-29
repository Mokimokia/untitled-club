const SESSION_KEY = "untitled-club-sync-session-v1";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function requireSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "Origem não permitida.");
  }
}

function config(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new HttpError(
      503,
      "Sincronização ainda não configurada. Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nos Secrets do Cloudflare Pages."
    );
  }
  return { base: url.replace(/\\/$/, "") + "/rest/v1", key };
}

export async function db(env, path, options = {}) {
  const { base, key } = config(env);
  const headers = new Headers(options.headers || {});
  headers.set("apikey", key);
  headers.set("Authorization", "Bearer " + key);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    headers.set("Prefer", "return=representation");
  }
  const response = await fetch(base + "/" + path, { ...options, headers });
  const text = await response.text();
  let result = null;
  if (text) {
    try { result = JSON.parse(text); } catch { result = null; }
  }
  if (!response.ok) {
    throw new HttpError(502, "O Supabase não conseguiu processar a alteração. Verifique as configurações e os logs do Cloudflare.");
  }
  return result;
}

export async function readSession(env) {
  const rows = await db(
    env,
    "sessions?code_hash=eq." + encodeURIComponent(SESSION_KEY) +
      "&select=id,name,status,active_track_id,timer_duration_seconds,timer_deadline_at,timer_running,updated_at&limit=1"
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new HttpError(503, "A sessão compartilhada não foi inicializada no Supabase.");
  }
  return rows[0];
}

export async function loadState(env) {
  const session = await readSession(env);
  const tracks = await db(
    env,
    "tracks?session_id=eq." + encodeURIComponent(session.id) +
      "&select=id,name,track_type,position,status&order=position.asc"
  );
  let remaining = Math.max(0, Number(session.timer_duration_seconds) || 0);
  if (session.timer_running && session.timer_deadline_at) {
    remaining = Math.max(0, Math.ceil((Date.parse(session.timer_deadline_at) - Date.now()) / 1000));
    if (remaining <= 0) {
      await db(env, "sessions?id=eq." + encodeURIComponent(session.id), {
        method: "PATCH",
        body: JSON.stringify({
          timer_running: false,
          timer_duration_seconds: 0,
          timer_deadline_at: null,
          updated_at: new Date().toISOString(),
        }),
      });
      session.timer_running = false;
      session.timer_duration_seconds = 0;
      session.timer_deadline_at = null;
      remaining = 0;
    }
  }
  return {
    session: {
      id: session.id,
      name: session.name,
      status: session.status,
      active_track_id: session.active_track_id,
      timer_duration_seconds: Number(session.timer_duration_seconds) || 0,
      timer_deadline_at: session.timer_deadline_at,
      timer_running: Boolean(session.timer_running),
      updated_at: session.updated_at,
    },
    tracks: Array.isArray(tracks) ? tracks : [],
    active_track: (tracks || []).find(t => t.id === session.active_track_id) || null,
    remaining_seconds: remaining,
    server_now: new Date().toISOString(),
  };
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
}

function fromBase64Url(value) {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmacKey(password, usage) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage
  );
}

export async function adminCookieValue(password, expiry) {
  const key = await hmacKey(password, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("untitled-club-admin:" + expiry));
  return String(expiry) + "." + toBase64Url(signature);
}

export async function hasAdminSession(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const rawCookie = request.headers.get("Cookie") || "";
  const part = rawCookie.split(";").map(v => v.trim()).find(v => v.startsWith("untitled_club_admin="));
  if (!part) return false;
  const value = part.slice("untitled_club_admin=".length);
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const expiry = value.slice(0, dot);
  const sigText = value.slice(dot + 1);
  if (!/^\\d+$/.test(expiry) || Number(expiry) <= Date.now() || !sigText) return false;
  try {
    const key = await hmacKey(env.ADMIN_PASSWORD, ["verify"]);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(sigText),
      new TextEncoder().encode("untitled-club-admin:" + expiry)
    );
  } catch {
    return false;
  }
}
