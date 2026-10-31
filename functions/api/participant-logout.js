import { json, requireSameOrigin } from "./_middleware.js";

export async function onRequestPost({ request }) {
  try {
    requireSameOrigin(request);
    return json({ ok: true }, 200, {
      "Set-Cookie": "untitled_club_participant=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0"
    });
  } catch (error) {
    return json({ error: error?.message || "Não foi possível sair da sessão." }, error?.status || 500);
  }
}
