// Registro de actividad de los usuarios (ingresos, visitas, consultas y descargas).
// No se registra a la administradora. Se guardan 180 días.
import { ahora } from "./auth.js";

const DIAS_GUARDADO = 180;
const TIPOS = new Set(["ingreso", "visita", "consulta", "descarga"]);

let listo = false;
async function tabla(env) {
  if (listo) return env.DB;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, dni TEXT NOT NULL, tipo TEXT NOT NULL,
      detalle TEXT, dispositivo TEXT, ts INTEGER NOT NULL)`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS eventos_dni_ts ON eventos (dni, ts)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS eventos_ts ON eventos (ts)"),
  ]);
  listo = true;
  return env.DB;
}

export const dispositivo = (request) =>
  /Mobi|Android|iPhone|iPad/i.test(request.headers.get("User-Agent") || "") ? "Celular" : "Compu";

export async function registrar(env, usuario, tipo, detalle, request) {
  if (!usuario || usuario.admin || !TIPOS.has(tipo)) return;
  try {
    const base = await tabla(env);
    if (tipo === "visita") {
      // Una "entrada" por sesión: si ya entró en los últimos 30 minutos, no se cuenta de nuevo
      const r = await base.prepare(`SELECT 1 FROM eventos WHERE dni = ? AND tipo IN ('ingreso','visita') AND ts > ? LIMIT 1`)
        .bind(usuario.dni, ahora() - 30 * 60e3).first();
      if (r) return;
    }
    await base.prepare("INSERT INTO eventos (dni, tipo, detalle, dispositivo, ts) VALUES (?, ?, ?, ?, ?)")
      .bind(usuario.dni, tipo, detalle ? String(detalle).slice(0, 200) : null, request ? dispositivo(request) : null, ahora()).run();
    if (Math.random() < 0.02) {   // limpieza ocasional de lo viejo
      await base.prepare("DELETE FROM eventos WHERE ts < ?").bind(ahora() - DIAS_GUARDADO * 864e5).run();
    }
  } catch (e) { console.log("No se pudo registrar actividad:", e); }   // nunca rompe la web
}

// Inicio del día de hoy en hora argentina (UTC-3), en milisegundos
function inicioHoy() {
  const ar = new Date(ahora() - 3 * 3600e3);
  return Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate()) + 3 * 3600e3;
}

export async function resumenActividad(env) {
  const base = await tabla(env);
  const hoy = inicioHoy(), semana = ahora() - 7 * 864e5;
  const { results: porUsuario } = await base.prepare(`
    SELECT e.dni, u.nombre, u.apellido,
      MAX(CASE WHEN e.tipo IN ('ingreso','visita') THEN e.ts END) AS ultima,
      SUM(CASE WHEN e.tipo IN ('ingreso','visita') AND e.ts >= ?1 THEN 1 ELSE 0 END) AS entradas_hoy,
      SUM(CASE WHEN e.tipo IN ('ingreso','visita') AND e.ts >= ?2 THEN 1 ELSE 0 END) AS entradas_7d,
      SUM(CASE WHEN e.tipo = 'descarga' AND e.ts >= ?2 THEN 1 ELSE 0 END) AS descargas_7d,
      SUM(CASE WHEN e.tipo = 'descarga' THEN 1 ELSE 0 END) AS descargas_total
    FROM eventos e LEFT JOIN usuarios u ON u.dni = e.dni
    GROUP BY e.dni ORDER BY ultima DESC`).bind(hoy, semana).all();
  const { results: provincias } = await base.prepare(`
    SELECT json_extract(detalle, '$.prov') AS prov, COUNT(*) AS n FROM eventos
    WHERE tipo IN ('consulta','descarga') AND ts >= ? AND json_valid(detalle) AND json_extract(detalle, '$.prov') IS NOT NULL
    GROUP BY prov ORDER BY n DESC LIMIT 8`).bind(semana).all();
  const tot = await base.prepare(`
    SELECT COUNT(DISTINCT CASE WHEN ts >= ?1 THEN dni END) AS usuarios_hoy,
      SUM(CASE WHEN tipo IN ('ingreso','visita') AND ts >= ?1 THEN 1 ELSE 0 END) AS entradas_hoy,
      SUM(CASE WHEN tipo = 'descarga' AND ts >= ?1 THEN 1 ELSE 0 END) AS descargas_hoy
    FROM eventos`).bind(hoy).first();
  return { porUsuario, provincias, totales: tot };
}

export async function ultimosEventos(env, { dni = null, limite = 60 } = {}) {
  const base = await tabla(env);
  const q = dni
    ? base.prepare(`SELECT e.*, u.nombre, u.apellido FROM eventos e LEFT JOIN usuarios u ON u.dni = e.dni
        WHERE e.dni = ? ORDER BY e.ts DESC LIMIT ?`).bind(dni, limite)
    : base.prepare(`SELECT e.*, u.nombre, u.apellido FROM eventos e LEFT JOIN usuarios u ON u.dni = e.dni
        ORDER BY e.ts DESC LIMIT ?`).bind(limite);
  return (await q.all()).results;
}

export async function borrarActividad(env, dni) {
  const base = await tabla(env);
  await base.prepare("DELETE FROM eventos WHERE dni = ?").bind(dni).run();
}
