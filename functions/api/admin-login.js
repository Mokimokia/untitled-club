import { adminCookieValue, json, requireSameOrigin } from "./_shared.js";

export async function onRequestPost({ request, env }) {
  try {
    requireSameOrigin(request);
    if (!env.ADMIN_PASSWORD) {
      return json({
        error: "Defina ADMIN_PASSWORD como Secret em Cloudflare Pages → Settings → Variables and Secrets."
      }, 503);
    }
    let body;
    try { body = await request.json(); } catch { return json({ error: "Corpo JSON inválido." }, 400); }
    if (typeof body.password !== "string" || body.password.length === 0 || body.password !== env.ADMIN_PASSWORD) {
      return json({ error: "Senha administrativa incorreta." }, 401);
    }
    const expiry = Date.now() + 12 * 60 * 60 * 1000;
    const value = await adminCookieValue(env.ADMIN_PASSWORD, expiry);
    return json({ ok: true, expires_at: new Date(expiry).toISOString() }, 200, {
      "Set-Cookie": "untitled_club_admin=" + value + "; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=43200"
    });
  } catch (error) {
    return json({ error: error?.message || "Não foi possível autenticar o administrador." }, error?.status || 500);
  }
}

export async function onRequest({ request }) {
  if (request.method === "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  return new Response("Not Found", { status: 404 });
}
