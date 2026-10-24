// Pantallas del sistema de acceso (mismo estilo que la web neon).
import { escapar, nombreUsuario } from "./auth.js";

export function pagina(titulo, cuerpo, { ancho = 420 } = {}) {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapar(titulo)} · Coparticipación federal</title>
<style>
:root{--tinta:#2a1450;--papel:#f6f3fc;--panel:#fff;--acento:#6d2fd6;--acento2:#9b6dff;--niebla:#ddd5ee;--suave:#625a7d;--ok:#1f7a4d;--mal:#b3342e;--aviso:#c97b00;
--sans:"Avenir Next","Segoe UI",system-ui,-apple-system,sans-serif;--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif}
@media (prefers-color-scheme:dark){:root{--tinta:#efe9fb;--papel:#140c26;--panel:#1e1438;--acento:#b393ff;--acento2:#9b6dff;--niebla:#38285c;--suave:#a99fc4;--ok:#4cc38a;--mal:#ff7a70;--aviso:#ffb454}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--papel);color:var(--tinta);font-family:var(--sans);display:flex;flex-direction:column;align-items:center;padding:40px 16px}
.marca{font-family:var(--serif);font-size:15px;letter-spacing:.04em;color:var(--suave);margin-bottom:18px;text-align:center}
.marca b{display:block;font-size:24px;color:var(--tinta);letter-spacing:0}
.tarjeta{width:100%;max-width:${ancho}px;background:var(--panel);border:1px solid var(--niebla);border-radius:14px;padding:28px;box-shadow:0 10px 40px -20px rgba(109,47,214,.35)}
h1{font-family:var(--serif);font-weight:600;font-size:22px;margin:0 0 6px}
p{line-height:1.5}
.sub{color:var(--suave);margin:0 0 20px;font-size:14px}
label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
input[type=text],input[type=email],input[type=password]{width:100%;padding:11px 12px;border:1px solid var(--niebla);border-radius:9px;background:var(--papel);color:var(--tinta);font:inherit;font-size:16px}
input:focus{outline:2px solid var(--acento2);outline-offset:1px}
.fila{display:flex;gap:12px}.fila>div{flex:1;min-width:0}
.check{display:flex;gap:9px;align-items:flex-start;font-weight:400;font-size:13px;color:var(--suave);margin-top:16px}
.check input{margin-top:3px}
button,.boton{display:inline-block;width:100%;margin-top:20px;padding:12px;border:0;border-radius:9px;background:var(--acento);color:#fff;font:inherit;font-weight:600;font-size:15px;cursor:pointer;text-align:center;text-decoration:none}
@media (prefers-color-scheme:dark){button,.boton{color:#140c26}}
.links{margin-top:18px;font-size:14px;text-align:center;color:var(--suave)}
a{color:var(--acento)}
.msg{padding:11px 13px;border-radius:9px;font-size:14px;margin-bottom:16px;line-height:1.45}
.msg.error{background:color-mix(in srgb,var(--mal) 12%,transparent);color:var(--mal)}
.msg.ok{background:color-mix(in srgb,var(--ok) 13%,transparent);color:var(--ok)}
.pie{margin-top:22px;font-size:12px;color:var(--suave);text-align:center;max-width:420px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--niebla);vertical-align:middle}
th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--suave)}
td.acc{white-space:nowrap;text-align:right}
td.acc form{display:inline}
td.acc button{width:auto;margin:0 0 0 6px;padding:7px 12px;font-size:13px}
button.sec{background:transparent;color:var(--tinta);border:1px solid var(--niebla)}
button.peligro{background:transparent;color:var(--mal);border:1px solid var(--mal)}
h2{font-size:15px;margin:28px 0 8px;display:flex;gap:8px;align-items:center}
.n{background:var(--niebla);border-radius:20px;padding:1px 9px;font-size:12px}
.vacio{color:var(--suave);font-size:14px;padding:8px 0}
.peq{color:var(--suave);font-size:12px}
.barra{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.barra a{font-size:14px}
@media (max-width:640px){.fila{flex-direction:column;gap:0}.tabla-resp thead{display:none}.tabla-resp tr{display:block;border-bottom:1px solid var(--niebla);padding:8px 0}
.tabla-resp td{display:block;border:0;padding:3px 0}.tabla-resp td.acc{text-align:left;padding-top:8px}.tabla-resp td.acc button{margin:0 6px 0 0}}
</style>
</head>
<body>
<div class="marca">Datos oficiales de Hacienda<b>Coparticipación federal</b></div>
${cuerpo}
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const mensaje = (m) => (m ? `<div class="msg ${m.tipo || "error"}">${escapar(m.texto)}</div>` : "");

export function vistaAcceso({ msg, dni = "", volver = "/" } = {}) {
  return pagina("Ingresar", `
<div class="tarjeta">
  <h1>Ingresar</h1>
  <p class="sub">Acceso restringido a usuarios autorizados.</p>
  ${mensaje(msg)}
  <form method="post" action="/acceso">
    <input type="hidden" name="volver" value="${escapar(volver)}">
    <label for="dni">DNI</label>
    <input id="dni" name="dni" type="text" inputmode="numeric" autocomplete="username" value="${escapar(dni)}" required>
    <label for="clave">Contraseña</label>
    <input id="clave" name="clave" type="password" autocomplete="current-password" required>
    <button type="submit">Ingresar</button>
  </form>
  <div class="links"><a href="/olvide">Olvidé mi contraseña</a> · <a href="/registro">Pedir acceso</a></div>
</div>`);
}

export function vistaRegistro({ msg, datos = {} } = {}) {
  const v = (k) => escapar(datos[k] || "");
  return pagina("Pedir acceso", `
<div class="tarjeta">
  <h1>Pedir acceso</h1>
  <p class="sub">Completá tus datos. Te avisamos por mail cuando tu acceso esté aprobado.</p>
  ${mensaje(msg)}
  <form method="post" action="/registro">
    <div class="fila">
      <div><label for="nombre">Nombre</label><input id="nombre" name="nombre" type="text" autocomplete="given-name" value="${v("nombre")}" required></div>
      <div><label for="apellido">Apellido</label><input id="apellido" name="apellido" type="text" autocomplete="family-name" value="${v("apellido")}" required></div>
    </div>
    <label for="dni">DNI (sin puntos)</label>
    <input id="dni" name="dni" type="text" inputmode="numeric" autocomplete="username" value="${v("dni")}" required>
    <label for="email">Mail</label>
    <input id="email" name="email" type="email" autocomplete="email" value="${v("email")}" required>
    <label for="clave">Contraseña (mínimo 8 caracteres)</label>
    <input id="clave" name="clave" type="password" autocomplete="new-password" minlength="8" required>
    <label for="clave2">Repetir contraseña</label>
    <input id="clave2" name="clave2" type="password" autocomplete="new-password" minlength="8" required>
    <label class="check"><input type="checkbox" name="acepto" value="si" required>
      <span>Acepto que mis datos (nombre, apellido, DNI y mail) se usen únicamente para gestionar mi acceso a este sitio. Puedo pedir su baja en cualquier momento.</span></label>
    <button type="submit">Enviar pedido</button>
  </form>
  <div class="links">¿Ya tenés acceso? <a href="/acceso">Ingresar</a></div>
</div>`);
}

export function vistaSimple(titulo, texto, { tipo = "ok", link = { href: "/acceso", texto: "Volver al ingreso" } } = {}) {
  return pagina(titulo, `
<div class="tarjeta">
  <h1>${escapar(titulo)}</h1>
  ${mensaje({ tipo, texto })}
  ${link ? `<a class="boton" href="${escapar(link.href)}">${escapar(link.texto)}</a>` : ""}
</div>`);
}

export function vistaOlvide({ msg } = {}) {
  return pagina("Recuperar contraseña", `
<div class="tarjeta">
  <h1>Recuperar contraseña</h1>
  <p class="sub">Ingresá tu DNI y te mandamos un link al mail que registraste para elegir una contraseña nueva.</p>
  ${mensaje(msg)}
  <form method="post" action="/olvide">
    <label for="dni">DNI</label>
    <input id="dni" name="dni" type="text" inputmode="numeric" autocomplete="username" required>
    <button type="submit">Enviar link</button>
  </form>
  <div class="links"><a href="/acceso">Volver al ingreso</a></div>
</div>`);
}

export function vistaRestablecer({ token, msg } = {}) {
  return pagina("Nueva contraseña", `
<div class="tarjeta">
  <h1>Elegí una contraseña nueva</h1>
  ${mensaje(msg)}
  <form method="post" action="/restablecer">
    <input type="hidden" name="t" value="${escapar(token)}">
    <label for="clave">Contraseña nueva (mínimo 8 caracteres)</label>
    <input id="clave" name="clave" type="password" autocomplete="new-password" minlength="8" required>
    <label for="clave2">Repetir contraseña</label>
    <input id="clave2" name="clave2" type="password" autocomplete="new-password" minlength="8" required>
    <button type="submit">Guardar contraseña</button>
  </form>
</div>`);
}

const fecha = (ms) => new Date(ms).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });

function tablaUsuarios(lista, acciones, vacio) {
  if (!lista.length) return `<div class="vacio">${vacio}</div>`;
  return `<table class="tabla-resp"><thead><tr><th>Usuario</th><th>Mail</th><th>Fecha</th><th></th></tr></thead><tbody>
${lista.map((u) => `<tr>
  <td><b>${escapar(nombreUsuario(u))}</b></td>
  <td>${escapar(u.email)}</td>
  <td class="peq">${fecha(u.actualizado)}</td>
  <td class="acc">${acciones(u)}</td></tr>`).join("")}
</tbody></table>`;
}

const boton = (dni, accion, texto, clase = "") => `<form method="post" action="/admin">
  <input type="hidden" name="dni" value="${escapar(dni)}"><input type="hidden" name="accion" value="${accion}">
  <button type="submit" class="${clase}"${accion === "borrar" ? ` onclick="return confirm('¿Borrar definitivamente este usuario y sus datos?')"` : ""}>${texto}</button></form>`;

export function vistaAdmin({ usuarios, adminDni, msg }) {
  const pend = usuarios.filter((u) => u.estado === "pendiente");
  const apro = usuarios.filter((u) => u.estado === "aprobado");
  const rech = usuarios.filter((u) => u.estado === "rechazado");
  return pagina("Panel de accesos", `
<div class="tarjeta">
  <div class="barra"><h1>Panel de accesos</h1><span><a href="/">Ver la web</a> · <a href="/salir">Salir</a></span></div>
  ${mensaje(msg)}
  <h2>Pendientes <span class="n">${pend.length}</span></h2>
  ${tablaUsuarios(pend, (u) => boton(u.dni, "aprobar", "Aprobar") + boton(u.dni, "rechazar", "Rechazar", "sec"), "No hay pedidos pendientes.")}
  <h2>Con acceso <span class="n">${apro.length}</span></h2>
  ${tablaUsuarios(apro, (u) => (u.dni === adminDni ? `<span class="peq">Administradora</span>` : boton(u.dni, "quitar", "Quitar acceso", "sec")), "Todavía nadie tiene acceso.")}
  <h2>Rechazados o dados de baja <span class="n">${rech.length}</span></h2>
  ${tablaUsuarios(rech, (u) => boton(u.dni, "aprobar", "Dar acceso", "sec") + boton(u.dni, "borrar", "Borrar datos", "peligro"), "Ninguno.")}
</div>
<p class="pie">Al aprobar a alguien le llega un mail avisándole. "Borrar datos" elimina definitivamente su nombre, DNI y mail.</p>`, { ancho: 860 });
}
