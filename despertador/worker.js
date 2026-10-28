// Despertador del robot: Cloudflare lo ejecuta a horario exacto y le pide a GitHub
// que corra "Actualizar datos" (descargar Excel de Hacienda y regenerar la web).
// Necesita el secreto GITHUB_TOKEN (permiso "Actions: read and write" solo sobre este repo).
//
// Horarios (Cron Triggers en Cloudflare, hora UTC = Argentina + 3), lunes a viernes:
//   */10 18-19 * * 1-5   -> 15:00 a 16:50, cada 10 minutos
//   0 20,22 * * 1-5      -> 17:00 y 19:00
//   0 1 * * 2-6          -> 22:00

const REPO = "jazminvargas820/coparticipacion-argentina";
const WORKFLOW = "actualizar.yml";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(disparar(env));
  },
  async fetch() {
    return new Response("Despertador del robot de coparticipación: funcionando.");
  },
};

async function disparar(env) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "copa-despertador",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (r.ok) console.log("Robot disparado");
  else console.log("Error al disparar el robot:", r.status, await r.text());
}
