import { db, HttpError, json, hasAdminSession, loadState, readSession, requireSameOrigin } from "./_middleware.js";

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

async function act(env, action, body) {
  const session = await readSession(env);
  const state = await loadState(env);
  const active = state.active_track;
  if (action === "release") {
    const position = Number(body.position);
    if (!Number.isInteger(position) || position < 1 || position > 6) throw new HttpError(400, "Posição de faixa inválida.");
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
    if (!Number.isInteger(position) || position < 1 || position > 6) throw new HttpError(400, "Posição de faixa inválida.");
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
    if (session.status !== "open" || !active) throw new HttpError(409, "Libere uma faixa antes de iniciar o cronômetro.");
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
  } else {
    throw new HttpError(400, "Ação desconhecida.");
  }
  return await loadState(env);
}

export async function onRequestGet({ request, env }) {
  try {
    if (request.method !== "GET") return json({ error: "Método não permitido." }, 405, { Allow: "GET, POST" });
    return json(await loadState(env));
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
    return json(state);
  } catch (error) {
    return json({ error: error?.message || "Não foi possível atualizar a sessão." }, error?.status || 500);
  }
}
