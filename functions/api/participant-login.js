import {
  db, HttpError, json, loadState, readSession, requireSameOrigin,
  sha256Hex, participantCookieValue, participantClaims, enforceRateLimit
} from "./_middleware.js";

const COOKIE_NAME = "untitled_club_participant";

async function findParticipant(env, sessionId, participantId) {
  const rows = await db(env,
    "participants?id=eq." + encodeURIComponent(participantId) +
    "&session_id=eq." + encodeURIComponent(sessionId) +
    "&select=id,session_id,display_name,joined_at,last_seen_at&limit=1"
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function onRequestPost({ request, env }) {
  try {
    requireSameOrigin(request);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Corpo JSON inválido." }, 400); }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!name || name.length > 80) throw new HttpError(400, "Informe um nome de 1 a 80 caracteres.");
    await enforceRateLimit(request, env, "participant-login", 100, 300);
    if (!env.ADMIN_PASSWORD) throw new HttpError(503, "O servidor ainda não foi configurado. O administrador precisa revisar os Secrets do Cloudflare.");
    const session = await readSession(env);
    if (session.status !== "open") throw new HttpError(409, "A sessão está encerrada. Aguarde o administrador reabri-la.");
    if (session.entry_code_hash) {
      if (!code || await sha256Hex(code) !== session.entry_code_hash) {
        throw new HttpError(403, "Código de entrada inválido. Confira a chave fornecida pelo administrador.");
      }
    }
    const existingClaims = await participantClaims(request, env);
    if (existingClaims) {
      const existing = await findParticipant(env, session.id, existingClaims.sub);
      if (existing) {
        await db(env, "participants?id=eq." + encodeURIComponent(existing.id), {
          method: "PATCH",
          body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
        });
        return json({ participant: existing, state: await loadState(env) });
      }
    }
    const rawToken = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(rawToken, b => b.toString(16).padStart(2, "0")).join("");
    const rows = await db(env, "participants", {
      method: "POST",
      body: JSON.stringify({
        session_id: session.id,
        display_name: name,
        token_hash: await sha256Hex(token),
        last_seen_at: new Date().toISOString(),
      }),
    });
    const participant = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!participant?.id) throw new HttpError(502, "Não foi possível registrar o participante no Supabase.");
    const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const cookieValue = await participantCookieValue(env.ADMIN_PASSWORD, participant.id, expiry);
    return json({ participant, state: await loadState(env) }, 200, {
      "Set-Cookie": COOKIE_NAME + "=" + cookieValue + "; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=604800"
    });
  } catch (error) {
    return json({ error: error?.message || "Não foi possível entrar na sessão." }, error?.status || 500);
  }
}
