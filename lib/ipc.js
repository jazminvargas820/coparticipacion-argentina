// IPC cargado a mano desde el Panel (tabla "ipc" en la base D1).
// mensual: variación % del mes. interanual: % vs mismo mes del año anterior (vacío = se calcula).
// fuente: "INDEC" (oficial) o "Estimado" (decisión propia).
import { ahora } from "./auth.js";

// Datos iniciales (se cargan solos la primera vez; después se editan desde el Panel)
const INICIAL = [
  ["2025-01", 2.2, null, "INDEC"], ["2025-02", 2.4, null, "INDEC"], ["2025-03", 3.7, null, "INDEC"],
  ["2025-04", 2.8, null, "INDEC"], ["2025-05", 1.5, null, "INDEC"], ["2025-06", 1.6, null, "INDEC"],
  ["2025-07", 1.9, null, "INDEC"], ["2025-08", 1.9, null, "INDEC"], ["2025-09", 2.1, null, "INDEC"],
  ["2025-10", 2.3, null, "INDEC"], ["2025-11", 2.5, null, "INDEC"], ["2025-12", 2.8, null, "INDEC"],
  ["2026-01", 2.9, 32.4, "INDEC"], ["2026-02", 2.9, 33.1, "INDEC"], ["2026-03", 3.4, 32.6, "INDEC"],
  ["2026-04", 2.6, 32.4, "INDEC"], ["2026-05", 2.1, 33.0, "INDEC"], ["2026-06", 1.9, 33.5, "INDEC"],
  ["2026-07", 2.1, 33.8, "INDEC"], ["2026-08", 1.7, 33.5, "INDEC"], ["2026-09", 1.9, 33.4, "INDEC"],
  ["2026-10", 1.6, null, "Estimado"],
];

let listo = false;
async function tabla(env) {
  if (listo) return env.DB;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ipc (
    mes TEXT PRIMARY KEY, mensual REAL NOT NULL, interanual REAL, fuente TEXT NOT NULL, actualizado INTEGER NOT NULL)`).run();
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM ipc").first();
  if (n === 0) {
    await env.DB.batch(INICIAL.map(([mes, m, i, f]) =>
      env.DB.prepare("INSERT INTO ipc (mes, mensual, interanual, fuente, actualizado) VALUES (?, ?, ?, ?, ?)")
        .bind(mes, m, i, f, ahora())));
  }
  listo = true;
  return env.DB;
}

export async function listarIpc(env) {
  const base = await tabla(env);
  const { results } = await base.prepare("SELECT mes, mensual, interanual, fuente FROM ipc ORDER BY mes").all();
  return completarInteranual(results);
}

export async function guardarIpc(env, { mes, mensual, interanual, fuente }) {
  const base = await tabla(env);
  await base.prepare(`INSERT INTO ipc (mes, mensual, interanual, fuente, actualizado) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(mes) DO UPDATE SET mensual = excluded.mensual, interanual = excluded.interanual,
    fuente = excluded.fuente, actualizado = excluded.actualizado`)
    .bind(mes, mensual, interanual, fuente, ahora()).run();
}

export async function borrarIpc(env, mes) {
  const base = await tabla(env);
  await base.prepare("DELETE FROM ipc WHERE mes = ?").bind(mes).run();
}

const clave = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
function corrida(mes, n) {               // mes desplazado n meses
  let y = +mes.slice(0, 4), m = +mes.slice(5) + n;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return clave(y, m);
}

// Interanual vacío: producto de los últimos 12 mensuales (como en la planilla);
// si falta alguno, se encadena desde el interanual del mes anterior.
function completarInteranual(filas) {
  const por = Object.fromEntries(filas.map((f) => [f.mes, { ...f }]));
  for (const f of filas.map((x) => por[x.mes])) {
    f.calculado = false;
    if (f.interanual != null) continue;
    let prod = 1, completo = true;
    for (let k = 0; k < 12; k++) {
      const x = por[corrida(f.mes, -k)];
      if (!x) { completo = false; break; }
      prod *= 1 + x.mensual / 100;
    }
    if (completo) { f.interanual = (prod - 1) * 100; f.calculado = true; continue; }
    const ant = por[corrida(f.mes, -1)], hace12 = por[corrida(f.mes, -12)];
    if (ant && ant.interanual != null && hace12) {
      f.interanual = ((1 + ant.interanual / 100) * (1 + f.mensual / 100) / (1 + hace12.mensual / 100) - 1) * 100;
      f.calculado = true;
    }
  }
  return filas.map((x) => por[x.mes]);
}

// Lo que recibe la web (mismo formato que datos.json)
export function ipcParaWeb(filas) {
  const r = { ipc_por_mes: {}, ipc_fuente_por_mes: {}, ipc_mensual_por_mes: {} };
  for (const f of filas) {
    r.ipc_mensual_por_mes[f.mes] = f.mensual;
    if (f.interanual != null) {
      r.ipc_por_mes[f.mes] = Math.round(f.interanual * 1e6) / 1e6;   // precisión completa: se redondea solo al mostrar
      r.ipc_fuente_por_mes[f.mes] = f.fuente;
    }
  }
  return r;
}

export function leerNumero(v) {
  const s = String(v ?? "").trim().replace("%", "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
