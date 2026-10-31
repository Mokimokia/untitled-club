import { db, json, HttpError, requireSameOrigin, hasAdminSession } from "./_middleware.js";

const BUCKET = "music-submissions";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "flac", "aiff", "aif", "m4a", "aac", "ogg", "opus"]);

function clean(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function fileExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

async function uploadFile(env, file, submissionId, slot) {
  if (!file || typeof file.arrayBuffer !== "function" || file.size <= 0) {
    throw new HttpError(400, "Selecione um arquivo de áudio válido para " + slot + ".");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new HttpError(413, "Cada arquivo pode ter no máximo 50 MB.");
  }
  const ext = fileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new HttpError(415, "Formato não aceito. Envie MP3, WAV, FLAC, AIFF, M4A, AAC, OGG ou OPUS.");
  }
  const safeName = String(file.name || "audio").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100);
  const path = submissionId + "/" + slot + "-" + crypto.randomUUID() + "-" + safeName;
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new HttpError(503, "O armazenamento de envios ainda não está configurado.");
  const response = await fetch(base + "/storage/v1/object/" + BUCKET + "/" + path.split("/").map(encodeURIComponent).join("/"), {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "false"
    },
    body: await file.arrayBuffer()
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new HttpError(502, "Não foi possível armazenar o áudio. " + (details.includes("Payload too large") ? "O arquivo excede o limite do armazenamento." : "Tente novamente ou use um arquivo menor."));
  }
  return {
    path,
    name: clean(file.name, 180) || "audio." + ext,
    size: file.size,
    mime: file.type || "application/octet-stream"
  };
}

async function removeFile(env, path) {
  if (!path) return;
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await fetch(base + "/storage/v1/object/" + BUCKET + "/" + path.split("/").map(encodeURIComponent).join("/"), {
      method: "DELETE",
      headers: { apikey: key, Authorization: "Bearer " + key }
    });
  } catch {}
}


async function signedDownload(env, path) {
  if (!path) return null;
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(base + "/storage/v1/object/sign/" + BUCKET + "/" + encoded, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ expiresIn: 3600 })
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  const signed = data.signedURL || data.signedUrl || null;
  return signed ? (signed.startsWith("http") ? signed : base + "/storage/v1" + signed) : null;
}

export async function onRequestGet({ request, env }) {
  try {
    if (!await hasAdminSession(request, env)) throw new HttpError(401, "Acesso restrito ao administrador.");
    const rows = await db(env, "music_submissions?select=*&order=submitted_at.desc&limit=200");
    const submissions = await Promise.all((Array.isArray(rows) ? rows : []).map(async row => ({
      ...row,
      track1_download_url: await signedDownload(env, row.track1_file_path),
      track2_download_url: await signedDownload(env, row.track2_file_path)
    })));
    return json({ submissions });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: "Não foi possível carregar os envios." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  let uploaded = [];
  try {
    requireSameOrigin(request);
    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > 105 * 1024 * 1024) throw new HttpError(413, "O envio excede o limite permitido.");
    const form = await request.formData();
    if (clean(form.get("website"), 200)) return json({ ok: true });
    const name = clean(form.get("name"), 100);
    const email = clean(form.get("email"), 254).toLowerCase();
    const social = clean(form.get("social"), 160);
    const t1Name = clean(form.get("track1_name"), 160);
    const t1Artists = clean(form.get("track1_artists"), 200);
    const t1Genre = clean(form.get("track1_genre"), 100);
    const t2Name = clean(form.get("track2_name"), 160);
    const t2Artists = clean(form.get("track2_artists"), 200);
    const t2Genre = clean(form.get("track2_genre"), 100);
    const f1 = form.get("track1_file");
    const f2 = form.get("track2_file");
    if (!name || !email || !social || !t1Name || !t1Artists || !t1Genre) {
      throw new HttpError(400, "Preencha todos os campos obrigatórios da primeira faixa e seus dados.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Informe um e-mail válido.");
    const secondStarted = Boolean(t2Name || t2Artists || t2Genre || (f2 && f2.size));
    if (secondStarted && (!t2Name || !t2Artists || !t2Genre || !f2 || !f2.size)) {
      throw new HttpError(400, "Para enviar a segunda faixa, preencha nome, artistas, gênero e arquivo.");
    }
    const existing = await db(env, "music_submissions?email=eq." + encodeURIComponent(email) + "&select=id&limit=1");
    if (Array.isArray(existing) && existing.length) {
      throw new HttpError(409, "Já existe um envio registrado com este e-mail. Se precisar corrigir algo, entre em contato com a equipe do Untitled Club.");
    }
    const id = crypto.randomUUID();
    const file1 = await uploadFile(env, f1, id, "faixa-1");
    uploaded.push(file1.path);
    let file2 = null;
    if (secondStarted) {
      file2 = await uploadFile(env, f2, id, "faixa-2");
      uploaded.push(file2.path);
    }
    const row = {
      id, name, email, social,
      track1_name: t1Name, track1_artists: t1Artists, track1_genre: t1Genre,
      track1_file_path: file1.path, track1_file_name: file1.name,
      track1_file_size: file1.size, track1_mime_type: file1.mime,
      ...(file2 ? {
        track2_name: t2Name, track2_artists: t2Artists, track2_genre: t2Genre,
        track2_file_path: file2.path, track2_file_name: file2.name,
        track2_file_size: file2.size, track2_mime_type: file2.mime
      } : {})
    };
    await db(env, "music_submissions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row)
    });
    return json({ ok: true, message: "Suas músicas foram enviadas com sucesso." }, 201);
  } catch (error) {
    for (const path of uploaded) await removeFile(env, path);
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: "Não foi possível concluir o envio agora. Tente novamente em instantes." }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    requireSameOrigin(request);
    if (!await hasAdminSession(request, env)) throw new HttpError(401, "Acesso restrito ao administrador.");
    const rows = await db(env, "music_submissions?select=id,track1_file_path,track2_file_path&limit=1000");
    const prefixes = (Array.isArray(rows) ? rows : [])
      .flatMap(row => [row.track1_file_path, row.track2_file_path])
      .filter(Boolean);
    if (prefixes.length) {
      const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
      const key = env.SUPABASE_SERVICE_ROLE_KEY;
      const response = await fetch(base + "/storage/v1/object/" + BUCKET, {
        method: "DELETE",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prefixes })
      });
      if (!response.ok) {
        throw new HttpError(502, "Não foi possível apagar todos os arquivos de áudio. Os registros foram preservados.");
      }
    }
    await db(env, "music_submissions?id=not.is.null", { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return json({ ok: true, deleted: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: "Não foi possível limpar os envios." }, 500);
  }
}

export async function onRequestPut() { return json({ error: "Método não permitido." }, 405, { Allow: "GET, POST, DELETE" }); }
