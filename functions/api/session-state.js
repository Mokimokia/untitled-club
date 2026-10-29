import {
  db, HttpError, json, hasAdminSession, loadState, readSession,
  requireSameOrigin, sha256Hex
} from "./_middleware.js";

async function updateSession(env, session, patch) {
  await db(env, "sessions?id=eq." + encodeURIComponent(session.id), {
    method: "PATCH",
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function getTrackAtPosition(env, sessionId, position) {
  const rows = await db(
    env,
    "tracks?session_id=eq." + encodeURIComponent(sessionId) +
      "&position=eq." + encodeURIComponent(position) +
      "&select=id,name,track_type,position,status&limit=1"
  );
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(404, "Faixa não encontrada.");
  return rows[0];
}

async function loadAdminData(env, sessionId) {
  const [participants, ratings] = await Promise.all([
    db(env, "participants?session_id=eq." + encodeURIComponent(sessionId) +
      "&select=id,display_name,joined_at,last_seen_at&order=joined_at.asc"),
    db(env, "ratings?session_id=eq." + encodeURIComponent(sessionId) +
      "&select=id,participant_id,track_id,initial_impression,melody,composition,production,vocal_performance,originality,emotional_connection,commercial_potential,replay_memorability,overall,liked,improve,is_submitted,submitted_at,updated_at&order=updated_at.desc")
  ]);
  return {
    participants: Array.isArray(participants) ? participants : [],
    ratings: Array.isArray(ratings) ? ratings : [],
  };
}

async function act(env, action, body) {
  const session = await readSession(env);
  const state = await loadState(env);
  if (action === "release") {
    const position = Number(body.position);
    if (!Number.isInteger(position) || position < 1 || position > 100) throw new HttpError(400, "Posição de faixa inválida.");
    if (session.status === "closed") throw new HttpError(409, "Reabra a sessão antes de liberar uma faixa.");
    const target = await getTrackAtPosition(env, session.id, position);
    if (session.active_track_id && session.active_track_id !== target.id) {
      await db(env, "tracks?id=eq." + encodeURIComponent(session.active_track_id), {
        method: "PATCH",
        body: JSON.stringify({ status: "closed" }),
      });
    }
    await db(env, "tracks?id=eq." + encodeURIComponent(target.id), {
      method: "PATCH",
      body: JSON.stringify({ status: "released" }),
    });
    await updateSession(env, session, {
      status: "open",
      active_track_id: target.id,
      timer_duration_seconds: 180,
      timer_deadline_at: null,
      timer_running: false,
    });
  } else if (action === "close_track") {
    const position = Number(body.position);
    if (!Number.isInteger(position) || position < 1 || position > 100) throw new HttpError(400, "Posição de faixa inválida.");
    const target = await getTrackAtPosition(env, session.id, position);
    await db(env, "tracks?id=eq." + encodeURIComponent(target.id), {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
    });
    if (session.active_track_id === target.id) {
      await updateSession(env, session, {
        active_track_id: null,
        timer_duration_seconds: 180,
        timer_deadline_at: null,
        timer_running: false,
      });
    }
  } else if (action === "end") {
    await updateSession(env, session, {
      status: "closed",
      active_track_id: null,
      timer_deadline_at: null,
      timer_running: false,
      timer_duration_seconds: state.remaining_seconds,
    });
  } else if (action === "reopen") {
    await db(env, "tracks?session_id=eq." + encodeURIComponent(session.id), {
      method: "PATCH",
      body: JSON.stringify({ status: "pending" }),
    });
    await updateSession(env, session, {
      status: "open",
      active_track_id: null,
      timer_duration_seconds: 180,
      timer_deadline_at: null,
      timer_running: false,
    });
  } else if (action === "start") {
    if (session.status !== "open" || !state.active_track) throw new HttpError(409, "Libere uma faixa antes de iniciar o cronômetro.");
    if (state.remaining_seconds <= 0) throw new HttpError(409, "O tempo terminou. Libere novamente a faixa para reiniciar os três minutos.");
    const deadline = new Date(Date.now() + state.remaining_seconds * 1000).toISOString();
    await updateSession(env, session, {
      timer_duration_seconds: state.remaining_seconds,
      timer_deadline_at: deadline,
      timer_running: true,
    });
  } else if (action === "pause") {
    await updateSession(env, session, {
      timer_duration_seconds: state.remaining_seconds,
      timer_deadline_at: null,
      timer_running: false,
    });
  } else if (action === "add_minute") {
    if (session.status !== "open") throw new HttpError(409, "A sessão está encerrada.");
    const remaining = Math.max(0, state.remaining_seconds) + 60;
    await updateSession(env, session, {
      timer_duration_seconds: remaining,
      timer_deadline_at: session.timer_running ? new Date(Date.now() + remaining * 1000).toISOString() : null,
      timer_running: Boolean(session.timer_running),
    });
  } else if (action === "set_entry_code") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (code && (code.length < 4 || code.length > 40)) {
      throw new HttpError(400, "O código de entrada deve ter entre 4 e 40 caracteres. Deixe vazio para permitir entrada sem código.");
    }
    await updateSession(env, session, {
      entry_code_hash: code ? await sha256Hex(code) : null,
    });
  } else if (action === "add_track") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type = body.track_type === "reference" ? "reference" : "unreleased";
    if (!name || name.length > 120) throw new HttpError(400, "Informe um nome de faixa de até 120 caracteres.");
    const existing = await db(env, "tracks?session_id=eq." + encodeURIComponent(session.id) +
      "&select=position&order=position.desc&limit=1");
    const position = (Array.isArray(existing) && existing.length ? Number(existing[0].position) : 0) + 1;
    if (position > 100) throw new HttpError(409, "O limite é de 100 faixas por sessão.");
    await db(env, "tracks", {
      method: "POST",
      body: JSON.stringify({ session_id: session.id, name, track_type: type, position, status: "pending" }),
    });
  } else if (action === "rename_track") {
    const position = Number(body.position);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!Number.isInteger(position) || position < 1 || position > 100) throw new HttpError(400, "Posição de faixa inválida.");
    if (!name || name.length > 120) throw new HttpError(400, "Informe um nome de faixa de até 120 caracteres.");
    const target = await getTrackAtPosition(env, session.id, position);
    await db(env, "tracks?id=eq." + encodeURIComponent(target.id), {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  } else {
    throw new HttpError(400, "Ação desconhecida.");
  }
  return await loadState(env);
}

export async function onRequestGet({ request, env }) {
  try {
    if (request.method !== "GET") return json({ error: "Método não permitido." }, 405, { Allow: "GET, POST" });
    const state = await loadState(env);
    if (await hasAdminSession(request, env)) {
      state.admin = await loadAdminData(env, state.session.id);
    }
    return json(state);
  } catch (error) {
    return json({ error: error?.message || "Não foi possível ler a sessão." }, error?.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireSameOrigin(request);
    if (!await hasAdminSession(request, env)) {
      return json({ error: "Entre no modo Admin com a senha administrativa antes de controlar a sessão." }, 401);
    }
    let body;
    try { body = await request.json(); } catch { return json({ error: "Corpo JSON inválido." }, 400); }
    const state = await act(env, body.action, body);
    if (await hasAdminSession(request, env)) {
      state.admin = await loadAdminData(env, state.session.id);
    }
    return json(state);
  } catch (error) {
    return json({ error: error?.message || "Não foi possível atualizar a sessão." }, error?.status || 500);
  }
}
