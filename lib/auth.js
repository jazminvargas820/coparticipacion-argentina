// Sistema de acceso de la web de coparticipación.
// Lo usan las funciones de Cloudflare Pages (carpeta /functions).
//
// Variables que se configuran en Cloudflare (Settings → Variables and Secrets / Bindings):
//   DB              base D1 (binding)                         obligatoria
//   ADMIN_DNI       DNI de la administradora (sin puntos)     obligatoria
//   ADMIN_EMAIL     mail donde llegan los avisos de pedidos   opcional
//   RESEND_API_KEY  clave de Resend para mandar mails         obligatoria para mails
//   MAIL_FROM       remitente, ej: Coparticipación Federal <no-reply@coparticipacionfederalarg.com.ar>

export const COOKIE = "copa_sesion";
export const DIAS_SESION = 30;
const ITERACIONES = 100000;          // máximo que permite Cloudflare para PBKDF2
const MAX_FALLOS = 5;                // intentos de clave antes de bloquear
const MINUTOS_BLOQUEO = 15;
const MINUTOS_RESET = 60;            // validez del link para restablecer clave

// ---------------------------------------------------------------- base de datos
let esquemaListo = false;
export async function db(env) {
  if (!env.DB) throw new Error("Falta vincular la base D1 con el nombre DB en Cloudflare.");
  if (!esquemaListo) {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS usuarios (
        dni TEXT PRIMARY KEY, nombre TEXT NOT NULL, apellido TEXT NOT NULL, email TEXT NOT NULL,
        clave TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente',
        creado INTEGER NOT NULL, actualizado INTEGER NOT NULL,
        fallos INTEGER NOT NULL DEFAULT 0, bloqueado_hasta INTEGER NOT NULL DEFAULT 0)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sesiones (
        token TEXT PRIMARY KEY, dni TEXT NOT NULL, expira INTEGER NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS resets (
        token TEXT PRIMARY KEY, dni TEXT NOT NULL, expira INTEGER NOT NULL)`),
    ]);
    esquemaListo = true;
  }
  return env.DB;
}

export const ahora = () => Date.now();

// ---------------------------------------------------------------- criptografía
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function tokenAleatorio(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function sha256(texto) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(texto));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(clave, sal, iter) {
  const k = await crypto.subtle.importKey("raw", enc.encode(clave), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iter }, k, 256);
}

export async function hashClave(clave) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACIONES}$${b64(sal)}$${b64(await pbkdf2(clave, sal, ITERACIONES))}`;
}

export async function verificarClave(clave, guardada) {
  const [, iter, sal, hash] = String(guardada).split("$");
  const calc = b64(await pbkdf2(clave, deB64(sal), Number(iter)));
  if (calc.length !== hash.length) return false;
  let dif = 0;
  for (let i = 0; i < calc.length; i++) dif |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  return dif === 0;
}

// ---------------------------------------------------------------- sesiones
export function leerCookie(request, nombre = COOKIE) {
  const c = request.headers.get("Cookie") || "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
  return m ? m[1] : null;
}

export async function crearSesion(env, dni) {
  const base = await db(env);
  const token = tokenAleatorio();
  const expira = ahora() + DIAS_SESION * 864e5;
  await base.prepare("INSERT INTO sesiones (token, dni, expira) VALUES (?, ?, ?)")
    .bind(await sha256(token), dni, expira).run();
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS_SESION * 86400}`;
}

export const cookieBorrada = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Devuelve el usuario aprobado de la sesión, o null.
export async function usuarioDeSesion(request, env) {
  const token = leerCookie(request);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const base = await db(env);
  const u = await base.prepare(
    `SELECT u.dni, u.nombre, u.apellido, u.email, u.estado FROM sesiones s
     JOIN usuarios u ON u.dni = s.dni WHERE s.token = ? AND s.expira > ?`)
    .bind(await sha256(token), ahora()).first();
  if (!u || u.estado !== "aprobado") return null;
  u.admin = esAdmin(env, u.dni);
  return u;
}

export async function cerrarSesion(request, env) {
  const token = leerCookie(request);
  if (token) {
    const base = await db(env);
    await base.prepare("DELETE FROM sesiones WHERE token = ?").bind(await sha256(token)).run();
  }
}

export const esAdmin = (env, dni) => !!env.ADMIN_DNI && limpiarDni(env.ADMIN_DNI) === dni;

// ---------------------------------------------------------------- login con bloqueo
export async function intentarLogin(env, dni, clave) {
  const base = await db(env);
  const u = await base.prepare("SELECT * FROM usuarios WHERE dni = ?").bind(dni).first();
  const generico = { ok: false, error: "DNI o contraseña incorrectos." };
  if (!u) { await verificarClave(clave, await hashFalso()); return generico; }   // mismo tiempo de respuesta
  if (u.bloqueado_hasta > ahora()) {
    const min = Math.ceil((u.bloqueado_hasta - ahora()) / 60000);
    return { ok: false, error: `Demasiados intentos. Probá de nuevo en ${min} minuto(s).` };
  }
  if (!(await verificarClave(clave, u.clave))) {
    const fallos = u.fallos + 1;
    const bloqueo = fallos >= MAX_FALLOS ? ahora() + MINUTOS_BLOQUEO * 60000 : 0;
    await base.prepare("UPDATE usuarios SET fallos = ?, bloqueado_hasta = ? WHERE dni = ?")
      .bind(bloqueo ? 0 : fallos, bloqueo, dni).run();
    return generico;
  }
  await base.prepare("UPDATE usuarios SET fallos = 0, bloqueado_hasta = 0 WHERE dni = ?").bind(dni).run();
  if (u.estado === "pendiente") return { ok: false, error: "Tu pedido de acceso todavía está pendiente de aprobación." };
  if (u.estado !== "aprobado") return { ok: false, error: "No tenés acceso habilitado. Consultá con la administración del sitio." };
  return { ok: true, usuario: u };
}

let _hashFalso;
async function hashFalso() { return (_hashFalso ||= await hashClave(tokenAleatorio(8))); }

// ---------------------------------------------------------------- restablecer clave
export async function crearReset(env, dni) {
  const base = await db(env);
  const recientes = await base.prepare("SELECT COUNT(*) AS n FROM resets WHERE dni = ? AND expira > ?")
    .bind(dni, ahora()).first();
  if (recientes.n >= 3) return null;                     // máximo 3 links vigentes por persona
  const token = tokenAleatorio();
  await base.prepare("INSERT INTO resets (token, dni, expira) VALUES (?, ?, ?)")
    .bind(await sha256(token), dni, ahora() + MINUTOS_RESET * 60000).run();
  return token;
}

export async function dniDeReset(env, token) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const base = await db(env);
  const r = await base.prepare("SELECT dni FROM resets WHERE token = ? AND expira > ?")
    .bind(await sha256(token), ahora()).first();
  return r ? r.dni : null;
}

export async function aplicarReset(env, token, claveNueva) {
  const dni = await dniDeReset(env, token);
  if (!dni) return false;
  const base = await db(env);
  await base.batch([
    base.prepare("UPDATE usuarios SET clave = ?, fallos = 0, bloqueado_hasta = 0, actualizado = ? WHERE dni = ?")
      .bind(await hashClave(claveNueva), ahora(), dni),
    base.prepare("DELETE FROM resets WHERE dni = ?").bind(dni),
    base.prepare("DELETE FROM sesiones WHERE dni = ?").bind(dni),   // cierra sesiones abiertas
  ]);
  return true;
}

// ---------------------------------------------------------------- mails (Resend)
export async function enviarMail(env, { para, asunto, html }) {
  if (!env.RESEND_API_KEY) { console.log("Sin RESEND_API_KEY: no se envía mail a", para, "-", asunto); return false; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM || "Coparticipación Federal <no-reply@coparticipacionfederalarg.com.ar>",
      to: [para], subject: asunto, html,
    }),
  });
  if (!r.ok) console.log("Error enviando mail:", r.status, await r.text());
  return r.ok;
}

export const plantillaMail = (titulo, cuerpo) => `
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#2a1450">
  <h2 style="margin:0 0 12px;color:#6d2fd6">${titulo}</h2>
  ${cuerpo}
  <p style="color:#625a7d;font-size:13px;margin-top:28px">Coparticipación Federal · coparticipacionfederalarg.com.ar</p>
</div>`;

// ---------------------------------------------------------------- validaciones y utilidades
export const limpiarDni = (s) => String(s || "").replace(/\D/g, "");
export const dniValido = (dni) => /^\d{7,8}$/.test(dni);
export const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const limpiarTexto = (s, max = 60) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

export function escapar(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Rechaza formularios enviados desde otro sitio (protección CSRF)
export function mismoOrigen(request) {
  const origen = request.headers.get("Origin");
  if (!origen) return true;                              // navegadores viejos: lo cubre SameSite=Lax
  return origen === new URL(request.url).origin;
}

export const nombreUsuario = (u) => `${u.nombre} ${u.apellido} - ${u.dni}`;

export function redirigir(url, cookies = []) {
  const h = new Headers({ Location: url });
  for (const c of [].concat(cookies)) h.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers: h });
}
