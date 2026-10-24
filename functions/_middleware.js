// Portero de la web: todo pedido pasa por acá.
// Sin sesión aprobada solo se ven las pantallas de acceso.
import {
  db, ahora, crearSesion, cookieBorrada, usuarioDeSesion, cerrarSesion, intentarLogin, esAdmin,
  crearReset, dniDeReset, aplicarReset, hashClave, enviarMail, plantillaMail, limpiarDni, dniValido,
  emailValido, limpiarTexto, escapar, mismoOrigen, nombreUsuario, redirigir,
} from "../lib/auth.js";
import {
  vistaAcceso, vistaRegistro, vistaSimple, vistaOlvide, vistaRestablecer, vistaAdmin,
} from "../lib/vistas.js";

const RUTAS = {
  "/acceso": acceso,
  "/registro": registro,
  "/olvide": olvide,
  "/restablecer": restablecer,
  "/salir": salir,
  "/admin": admin,
};

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const ruta = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (request.method === "POST" && !mismoOrigen(request)) {
      return new Response("Origen no permitido", { status: 403 });
    }
    if (RUTAS[ruta]) return await RUTAS[ruta](ctx, url);

    // Resto de la web: requiere usuario aprobado
    const usuario = await usuarioDeSesion(request, env);
    if (!usuario) {
      if (ruta === "/favicon.ico") return new Response(null, { status: 404 });
      const volver = url.pathname + url.search;
      return redirigir(`/acceso${volver !== "/" ? `?volver=${encodeURIComponent(volver)}` : ""}`);
    }
    const resp = await ctx.next();
    const tipo = resp.headers.get("Content-Type") || "";
    const nueva = new Response(resp.body, resp);
    nueva.headers.set("Cache-Control", "private, no-store");
    if (!tipo.includes("text/html")) return nueva;
    return new HTMLRewriter().on("body", new BarraUsuario(usuario)).transform(nueva);
  } catch (e) {
    console.log("Error:", e && e.stack || e);
    return vistaSimple("Algo salió mal", "Hubo un problema en el servidor. Probá de nuevo en unos minutos.",
      { tipo: "error", link: { href: "/acceso", texto: "Volver" } });
  }
}

// Pequeña barra con el nombre del usuario y "Salir" sobre la web
class BarraUsuario {
  constructor(u) { this.u = u; }
  element(el) {
    const admin = this.u.admin ? `<a href="/admin" style="color:inherit">Panel</a> · ` : "";
    el.append(`<div style="position:fixed;right:12px;bottom:12px;z-index:9999;font:13px system-ui,sans-serif;
      background:rgba(20,12,38,.85);color:#efe9fb;padding:7px 12px;border-radius:20px;backdrop-filter:blur(6px)">
      ${escapar(this.u.nombre)} · ${admin}<a href="/salir" style="color:inherit">Salir</a></div>`, { html: true });
  }
}

const volverSeguro = (v) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/");

// ---------------------------------------------------------------- /acceso
async function acceso({ request, env }, url) {
  if (request.method !== "POST") {
    if (await usuarioDeSesion(request, env)) return redirigir(volverSeguro(url.searchParams.get("volver")));
    return vistaAcceso({ volver: volverSeguro(url.searchParams.get("volver")) });
  }
  const f = await request.formData();
  const dni = limpiarDni(f.get("dni"));
  const volver = volverSeguro(f.get("volver"));
  if (!dniValido(dni)) return vistaAcceso({ msg: { texto: "Revisá el DNI (7 u 8 números, sin puntos)." }, dni, volver });
  const r = await intentarLogin(env, dni, String(f.get("clave") || ""));
  if (!r.ok) return vistaAcceso({ msg: { texto: r.error }, dni, volver });
  return redirigir(esAdmin(env, dni) && volver === "/" ? "/admin" : volver, await crearSesion(env, dni));
}

// ---------------------------------------------------------------- /registro
async function registro({ request, env }, url) {
  if (request.method !== "POST") return vistaRegistro();
  const f = await request.formData();
  const datos = {
    nombre: limpiarTexto(f.get("nombre")), apellido: limpiarTexto(f.get("apellido")),
    dni: limpiarDni(f.get("dni")), email: limpiarTexto(f.get("email"), 120).toLowerCase(),
  };
  const clave = String(f.get("clave") || ""), clave2 = String(f.get("clave2") || "");
  const error = (texto) => vistaRegistro({ msg: { texto }, datos });

  if (!datos.nombre || !datos.apellido) return error("Completá nombre y apellido.");
  if (!dniValido(datos.dni)) return error("Revisá el DNI (7 u 8 números, sin puntos).");
  if (!emailValido(datos.email)) return error("Revisá el mail.");
  if (clave.length < 8) return error("La contraseña tiene que tener al menos 8 caracteres.");
  if (clave !== clave2) return error("Las contraseñas no coinciden.");
  if (f.get("acepto") !== "si") return error("Tenés que aceptar el uso de tus datos para pedir acceso.");

  const base = await db(env);
  const existe = await base.prepare("SELECT estado FROM usuarios WHERE dni = ?").bind(datos.dni).first();
  if (existe) {
    return error(existe.estado === "aprobado"
      ? "Ese DNI ya tiene acceso. Si no recordás la contraseña, usá \"Olvidé mi contraseña\"."
      : "Ya hay un pedido con ese DNI. Si creés que es un error, consultá con la administración del sitio.");
  }
  // La cuenta de administradora solo se crea con su DNI Y su mail (los dos configurados en Cloudflare)
  const admin = esAdmin(env, datos.dni);
  if (admin && (!env.ADMIN_EMAIL || datos.email !== env.ADMIN_EMAIL.trim().toLowerCase())) {
    return error("No se pudo registrar ese DNI. Consultá con la administración del sitio.");
  }
  const t = ahora();
  await base.prepare(`INSERT INTO usuarios (dni, nombre, apellido, email, clave, estado, creado, actualizado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(datos.dni, datos.nombre, datos.apellido, datos.email, await hashClave(clave),
      admin ? "aprobado" : "pendiente", t, t).run();

  if (admin) return vistaSimple("Cuenta creada", "Tu cuenta de administradora está lista. Ya podés ingresar.");

  if (env.ADMIN_EMAIL) {
    await enviarMail(env, {
      para: env.ADMIN_EMAIL,
      asunto: `Nuevo pedido de acceso: ${datos.nombre} ${datos.apellido}`,
      html: plantillaMail("Nuevo pedido de acceso", `
        <p><b>${escapar(nombreUsuario(datos))}</b><br>${escapar(datos.email)}</p>
        <p><a href="${url.origin}/admin" style="color:#6d2fd6">Abrir el panel para aprobar o rechazar</a></p>`),
    });
  }
  return vistaSimple("Pedido enviado",
    "Recibimos tu pedido de acceso. Te vamos a avisar por mail cuando esté aprobado.");
}

// ---------------------------------------------------------------- /olvide
async function olvide({ request, env }, url) {
  if (request.method !== "POST") return vistaOlvide();
  const dni = limpiarDni((await request.formData()).get("dni"));
  const listo = vistaSimple("Revisá tu mail",
    "Si el DNI corresponde a un usuario con acceso, te mandamos un link para elegir una contraseña nueva. Vence en 1 hora. Mirá también en spam.");
  if (!dniValido(dni)) return vistaOlvide({ msg: { texto: "Revisá el DNI (7 u 8 números, sin puntos)." } });

  const base = await db(env);
  const u = await base.prepare("SELECT * FROM usuarios WHERE dni = ?").bind(dni).first();
  if (!u || u.estado !== "aprobado") return listo;          // misma respuesta: no revela quién existe
  const token = await crearReset(env, dni);
  if (!token) return listo;
  await enviarMail(env, {
    para: u.email,
    asunto: "Restablecer tu contraseña",
    html: plantillaMail("Restablecer contraseña", `
      <p>Hola ${escapar(u.nombre)}, pediste elegir una contraseña nueva.</p>
      <p><a href="${url.origin}/restablecer?t=${token}" style="display:inline-block;background:#6d2fd6;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none">Elegir contraseña nueva</a></p>
      <p style="color:#625a7d;font-size:13px">El link vence en 1 hora. Si no fuiste vos, ignorá este mail: tu contraseña no cambia.</p>`),
  });
  return listo;
}

// ---------------------------------------------------------------- /restablecer
async function restablecer({ request, env }, url) {
  const vencido = vistaSimple("Link vencido", "Este link ya no es válido. Pedí uno nuevo desde \"Olvidé mi contraseña\".",
    { tipo: "error", link: { href: "/olvide", texto: "Pedir otro link" } });
  if (request.method !== "POST") {
    const token = url.searchParams.get("t");
    return (await dniDeReset(env, token)) ? vistaRestablecer({ token }) : vencido;
  }
  const f = await request.formData();
  const token = String(f.get("t") || ""), clave = String(f.get("clave") || ""), clave2 = String(f.get("clave2") || "");
  if (clave.length < 8) return vistaRestablecer({ token, msg: { texto: "La contraseña tiene que tener al menos 8 caracteres." } });
  if (clave !== clave2) return vistaRestablecer({ token, msg: { texto: "Las contraseñas no coinciden." } });
  if (!(await aplicarReset(env, token, clave))) return vencido;
  return vistaSimple("Contraseña actualizada", "Listo. Ya podés ingresar con tu contraseña nueva.");
}

// ---------------------------------------------------------------- /salir
async function salir({ request, env }) {
  await cerrarSesion(request, env);
  return redirigir("/acceso", cookieBorrada);
}

// ---------------------------------------------------------------- /admin
async function admin({ request, env }, url) {
  const yo = await usuarioDeSesion(request, env);
  if (!yo) return redirigir("/acceso?volver=/admin");
  if (!yo.admin) return new Response("No autorizado", { status: 403 });
  const base = await db(env);
  let msg = null;

  if (request.method === "POST") {
    const f = await request.formData();
    const dni = limpiarDni(f.get("dni")), accion = f.get("accion");
    const u = await base.prepare("SELECT * FROM usuarios WHERE dni = ?").bind(dni).first();
    if (!u || dni === yo.dni) {
      msg = { texto: "No se pudo hacer esa acción." };
    } else if (accion === "aprobar") {
      await base.prepare("UPDATE usuarios SET estado = 'aprobado', actualizado = ? WHERE dni = ?").bind(ahora(), dni).run();
      const enviado = await enviarMail(env, {
        para: u.email, asunto: "Tu acceso fue aprobado",
        html: plantillaMail("¡Acceso aprobado!", `
          <p>Hola ${escapar(u.nombre)}, ya podés ingresar con tu DNI y la contraseña que elegiste.</p>
          <p><a href="${url.origin}/acceso" style="display:inline-block;background:#6d2fd6;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none">Ingresar</a></p>`),
      });
      msg = { tipo: "ok", texto: `Aprobaste a ${u.nombre} ${u.apellido}.${enviado ? " Le avisamos por mail." : " (No se pudo enviar el mail de aviso.)"}` };
    } else if (accion === "rechazar" || accion === "quitar") {
      await base.batch([
        base.prepare("UPDATE usuarios SET estado = 'rechazado', actualizado = ? WHERE dni = ?").bind(ahora(), dni),
        base.prepare("DELETE FROM sesiones WHERE dni = ?").bind(dni),
      ]);
      msg = { tipo: "ok", texto: `${u.nombre} ${u.apellido} ya no tiene acceso.` };
    } else if (accion === "borrar") {
      await base.batch([
        base.prepare("DELETE FROM usuarios WHERE dni = ?").bind(dni),
        base.prepare("DELETE FROM sesiones WHERE dni = ?").bind(dni),
        base.prepare("DELETE FROM resets WHERE dni = ?").bind(dni),
      ]);
      msg = { tipo: "ok", texto: `Se borraron los datos de ${u.nombre} ${u.apellido}.` };
    }
  }

  const { results } = await base.prepare(
    "SELECT dni, nombre, apellido, email, estado, actualizado FROM usuarios ORDER BY actualizado DESC").all();
  return vistaAdmin({ usuarios: results, adminDni: yo.dni, msg });
}
