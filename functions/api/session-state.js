import {
  db, HttpError, json, hasAdminSession, loadState, readSession,
  requireSameOrigin, sha256Hex
} from "./_middleware.js";

const SCORE_FIELDS = [
  "initial_impression", "melody", "composition", "production",
  "vocal_performance", "originality", "emotional_connection",
  "commercial_potential", "replay_memorability", "overall"
];

function isoOrNow(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function importScore(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 10 || number * 2 !== Math.round(number * 2)) {
    throw new HttpError(400, "Nota inválida no backup (" + label + "). Use valores de 0 a 10, em incrementos de 0,5.");
  }
  return number;
}

async function replaceSessionData(env, session, data) {
  return db(env, "rpc/replace_listening_session", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      p_session_id: session.id,
      p_session_name: data.name || "Untitled Club",
      p_entry_code_hash: data.entry_code_hash || null,
      p_tracks: data.tracks,
      p_participants: data.participants,
      p_ratings: data.ratings
    })
  });
}

function defaultTracks() {
  return [
    ["Referência 01","reference"],
    ["Referência 02","reference"],
    ["Referência 03","reference"],
    ["Inédita 01","unreleased"],
    ["Inédita 02","unreleased"],
    ["Inédita 03","unreleased"]
  ].map(([name, track_type], i) => ({
    id: crypto.randomUUID(),
    name,
    track_type,
    position: i + 1,
    status: "pending"
  }));
}

async function buildImportedData(session, backup) {
  if (!backup || backup.format !== "untitled-club-session-backup" || backup.version !== 1) {
    throw new HttpError(400, "O arquivo não é um backup compatível do untitled Club (formato/version 1).");
  }
  const rawTracks = backup.tracks;
  const rawParticipants = backup.participants;
  const rawRatings = backup.ratings;
  if (!Array.isArray(rawTracks) || rawTracks.length < 1 || rawTracks.length > 100) {
    throw new HttpError(400, "O backup deve conter de 1 a 100 faixas.");
  }
  if (!Array.isArray(rawParticipants) || rawParticipants.length > 2000) {
    throw new HttpError(400, "Lista de participantes inválida ou acima do limite de 2.000.");
  }
  if (!Array.isArray(rawRatings) || rawRatings.length > 20000) {
    throw new HttpError(400, "Lista de avaliações inválida ou acima do limite de 20.000.");
  }

  const seenTrackIds = new Set();
  const trackIdMap = new Map();
  const sortedTracks = [...rawTracks].sort((a,b) => Number(a.position || 0) - Number(b.position || 0));
  const tracks = sortedTracks.map((track, i) => {
    const oldId = String(track?.id || "");
    const name = typeof track?.name === "string" ? track.name.trim() : "";
    if (!oldId || seenTrackIds.has(oldId)) throw new HttpError(400, "O backup contém IDs de faixa ausentes ou duplicados.");
    if (!name || name.length > 120) throw new HttpError(400, "Nome de faixa inválido no backup.");
    seenTrackIds.add(oldId);
    const id = crypto.randomUUID();
    trackIdMap.set(oldId, id);
    return {
      id, name,
      track_type: track.track_type === "reference" || track.type === "Referência" ? "reference" : "unreleased",
      position: i + 1,
      status: "pending",
      internal_comment: typeof track?.internal_comment === "string" ? track.internal_comment.slice(0, 2000) : null
    };
  });
  const requestedActiveId = String(backup.session?.active_track_id || "");
  if (requestedActiveId && trackIdMap.has(requestedActiveId) && backup.session?.status !== "closed") {
    tracks.find(t => t.id === trackIdMap.get(requestedActiveId)).status = "released";
  }

  const seenParticipantIds = new Set();
  const participantIdMap = new Map();
  const participants = [];
  for (const participant of rawParticipants) {
    const oldId = String(participant?.id || "");
    const name = typeof participant?.display_name === "string" ? participant.display_name.trim() : "";
    if (!oldId || seenParticipantIds.has(oldId)) throw new HttpError(400, "O backup contém IDs de participantes ausentes ou duplicados.");
    if (!name || name.length > 80) throw new HttpError(400, "Nome de participante inválido no backup.");
    seenParticipantIds.add(oldId);
    const id = crypto.randomUUID();
    participantIdMap.set(oldId, id);
    participants.push({
      id,
      display_name: name,
      token_hash: await sha256Hex(crypto.randomUUID() + ":" + crypto.getRandomValues(new Uint32Array(1))[0]),
      joined_at: isoOrNow(participant.joined_at),
      last_seen_at: isoOrNow(participant.last_seen_at)
    });
  }

  const ratings = rawRatings.map((rating) => {
    const participant_id = participantIdMap.get(String(rating?.participant_id || ""));
    const track_id = trackIdMap.get(String(rating?.track_id || ""));
    if (!participant_id || !track_id) throw new HttpError(400, "Uma avaliação do backup aponta para participante ou faixa inexistente.");
    const normalized = {
      id: crypto.randomUUID(),
      participant_id,
      track_id,
      is_submitted: rating?.is_submitted === true,
      created_at: isoOrNow(rating?.created_at),
      updated_at: isoOrNow(rating?.updated_at),
      submitted_at: rating?.submitted_at ? isoOrNow(rating.submitted_at) : null,
      liked: typeof rating?.liked === "string" ? rating.liked.slice(0,2000) : null,
      improve: typeof rating?.improve === "string" ? rating.improve.slice(0,2000) : null
    };
    for (const field of SCORE_FIELDS) normalized[field] = importScore(rating?.[field], field);
    if (normalized.is_submitted && SCORE_FIELDS.some(field => normalized[field] === null)) {
      throw new HttpError(400, "O backup contém uma avaliação enviada sem os dez critérios preenchidos.");
    }
    return normalized;
  });

  return {
    name: typeof backup.session?.name === "string" ? backup.session.name.trim().slice(0,120) : "Untitled Club",
    entry_code_hash: session.entry_code_hash || null,
    tracks, participants, ratings
  };
}

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
  const [participants, ratings, tracks] = await Promise.all([
    db(env, "participants?session_id=eq." + encodeURIComponent(sessionId) +
      "&select=id,display_name,joined_at,last_seen_at&order=joined_at.asc"),
    db(env, "ratings?session_id=eq." + encodeURIComponent(sessionId) +
      "&select=id,participant_id,track_id,initial_impression,melody,composition,production,vocal_performance,originality,emotional_connection,commercial_potential,replay_memorability,overall,liked,improve,is_submitted,created_at,updated_at,submitted_at&order=updated_at.desc"),
    db(env, "tracks?session_id=eq." + encodeURIComponent(sessionId) +
      "&select=id,internal_comment&order=position.asc")
  ]);
  return {
    participants: Array.isArray(participants) ? participants : [],
    ratings: Array.isArray(ratings) ? ratings : [],
    tracks: Array.isArray(tracks) ? tracks : [],
  };
}

async function act(env, action, body) {
  const session = await readSession(env);
  const state = await loadState(env);
  if (action === "set_submission_mode") {
    await updateSession(env, session, { submission_mode: Boolean(body.enabled) });
  } else if (action === "release") {
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
    const deadline = new Date(Date.now() + 180000).toISOString();
    await updateSession(env, session, {
      status: "open",
      active_track_id: target.id,
      timer_duration_seconds: 180,
      timer_deadline_at: deadline,
      timer_running: true,
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
  } else if (action === "set_track_comment") {
    const trackId = typeof body.track_id === "string" ? body.track_id.trim() : "";
    const comment = typeof body.comment === "string" ? body.comment : "";
    if (!/^[0-9a-f-]{36}$/i.test(trackId)) throw new HttpError(400, "Identificador de faixa inválido.");
    if (comment.length > 2000) throw new HttpError(400, "O comentário interno deve ter no máximo 2.000 caracteres.");
    const target = await db(env, "tracks?session_id=eq." + encodeURIComponent(session.id) +
      "&id=eq." + encodeURIComponent(trackId) + "&select=id&limit=1");
    if (!Array.isArray(target) || !target.length) throw new HttpError(404, "Faixa não encontrada nesta sessão.");
    await db(env, "tracks?session_id=eq." + encodeURIComponent(session.id) +
      "&id=eq." + encodeURIComponent(trackId), {
        method: "PATCH",
        body: JSON.stringify({ internal_comment: comment.trim() || null }),
      });
  } else if (action === "new_session") {
    await replaceSessionData(env, session, {
      name: "Untitled Club",
      entry_code_hash: null,
      tracks: defaultTracks(),
      participants: [],
      ratings: []
    });
  } else if (action === "import_session") {
    const backup = body.backup;
    const imported = await buildImportedData(session, backup);
    await replaceSessionData(env, session, imported);
    const tracksWithComments = imported.tracks.filter(track => track.internal_comment);
    await Promise.all(tracksWithComments.map(track => db(env,
      "tracks?session_id=eq." + encodeURIComponent(session.id) + "&id=eq." + encodeURIComponent(track.id), {
        method: "PATCH",
        body: JSON.stringify({ internal_comment: track.internal_comment }),
      }
    )));
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
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 5 * 1024 * 1024) return json({ error: "O backup excede o limite de 5 MB." }, 413);
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
