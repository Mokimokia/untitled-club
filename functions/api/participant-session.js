import {
  db, HttpError, json, loadState, readSession, requireSameOrigin,
  participantClaims
} from "./_middleware.js";

const SCORE_FIELDS = [
  "initial_impression", "melody", "composition", "production",
  "vocal_performance", "originality", "emotional_connection",
  "commercial_potential", "replay_memorability", "overall"
];

async function authParticipant(request, env, session) {
  const claims = await participantClaims(request, env);
  if (!claims) throw new HttpError(401, "Sua sessão de participante expirou. Entre novamente.");
  const rows = await db(env,
    "participants?id=eq." + encodeURIComponent(claims.sub) +
    "&session_id=eq." + encodeURIComponent(session.id) +
    "&select=id,session_id,display_name,joined_at,last_seen_at&limit=1"
  );
  const participant = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!participant) throw new HttpError(401, "Não foi possível validar o participante. Entre novamente.");
  return participant;
}

async function getOwnRatings(env, sessionId, participantId) {
  const rows = await db(env,
    "ratings?session_id=eq." + encodeURIComponent(sessionId) +
    "&participant_id=eq." + encodeURIComponent(participantId) +
    "&select=id,track_id,initial_impression,melody,composition,production,vocal_performance,originality,emotional_connection,commercial_potential,replay_memorability,overall,liked,improve,is_submitted,submitted_at,updated_at&order=updated_at.desc"
  );
  return Array.isArray(rows) ? rows : [];
}

function validateScores(raw, isSubmitted) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "As notas estão inválidas.");
  const scores = {};
  for (const key of SCORE_FIELDS) {
    const value = raw[key];
    if (value === undefined || value === null || value === "") {
      scores[key] = null;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 5) {
      throw new HttpError(400, "Cada nota deve estar entre 0 e 5, em números inteiros.");
    }
    scores[key] = value;
  }
  if (isSubmitted && SCORE_FIELDS.some(key => scores[key] === null)) {
    throw new HttpError(400, "Preencha os dez critérios antes de enviar a avaliação.");
  }
  return scores;
}

export async function onRequestGet({ request, env }) {
  try {
    const session = await readSession(env);
    const participant = await authParticipant(request, env, session);
    const lastSeen = Date.parse(participant.last_seen_at || "");
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen >= 15000) {
      await db(env, "participants?id=eq." + encodeURIComponent(participant.id), {
        method: "PATCH",
        body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
      });
    }
    return json({ participant, state: await loadState(env), ratings: await getOwnRatings(env, session.id, participant.id) });
  } catch (error) {
    return json({ error: error?.message || "Não foi possível carregar as avaliações." }, error?.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireSameOrigin(request);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Corpo JSON inválido." }, 400); }
    if (body.action !== "save_rating") throw new HttpError(400, "Ação desconhecida.");
    const session = await readSession(env);
    const participant = await authParticipant(request, env, session);
    if (session.status !== "open") throw new HttpError(409, "A sessão está encerrada.");
    if (!session.active_track_id || body.track_id !== session.active_track_id) {
      throw new HttpError(409, "Esta faixa não está liberada neste momento.");
    }
    const state = await loadState(env);
    if (state.remaining_seconds <= 0) throw new HttpError(409, "O tempo para avaliar terminou.");
    const scores = validateScores(body.scores, body.is_submitted === true);
    const now = new Date().toISOString();
    const payload = {
      session_id: session.id,
      participant_id: participant.id,
      track_id: session.active_track_id,
      ...scores,
      liked: typeof body.liked === "string" ? body.liked.slice(0, 2000) : null,
      improve: typeof body.improve === "string" ? body.improve.slice(0, 2000) : null,
      is_submitted: body.is_submitted === true,
      updated_at: now,
      submitted_at: body.is_submitted === true ? now : null,
    };
    const rows = await db(env,
      "ratings?on_conflict=participant_id,track_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(payload),
      }
    );
    const saved = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!saved) throw new HttpError(502, "A avaliação não foi confirmada pelo Supabase.");
    return json({ saved, state: await loadState(env), ratings: await getOwnRatings(env, session.id, participant.id) });
  } catch (error) {
    return json({ error: error?.message || "Não foi possível salvar a avaliação." }, error?.status || 500);
  }
}
