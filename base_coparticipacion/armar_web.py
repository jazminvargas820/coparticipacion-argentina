"""
armar_web.py
============
Arma la página web (UN solo archivo: index.html) con tus datos y el mapa adentro.

Qué necesita, todo en la MISMA carpeta que este script (base_coparticipacion):
    armar_web.py
    plantilla_neon.html          <- el diseño de la web (los cambios estéticos se hacen ACÁ)
    ProvinciasArgentina.geojson  <- los contornos de las provincias
    data/datos.json              <- lo genera armar_base.py
    banderas/                    <- (opcional) una imagen por provincia: la-rioja.png, cordoba.jpg, caba.png...

Cómo usarlo: primero corré armar_base.py (para actualizar datos.json) y después este.
Resultado: index.html. Se abre con doble click y es lo que se sube a Cloudflare Pages.
"""
import json
import re
import base64
import unicodedata
from pathlib import Path

try:
    RAIZ = Path(__file__).parent
except NameError:
    RAIZ = Path.cwd()

PLANTILLA = RAIZ / "plantilla_neon.html"   # única plantilla que se usa
GEOJSON = RAIZ / "ProvinciasArgentina.geojson"
DATOS = RAIZ / "data" / "datos.json"
SALIDA = RAIZ / "index.html"
CARPETA_BANDERAS = RAIZ / "banderas"
ALTO_BANDERA = 64   # px; alcanza de sobra para mostrarlas chicas, incluso en pantallas retina


def a_js(obj):
    """JSON compacto y seguro para pegar adentro de un <script>."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


# ======================================================================
# BANDERAS (opcional): una imagen por provincia dentro de la carpeta 'banderas'
# ======================================================================
def normalizar(texto):
    t = unicodedata.normalize("NFD", str(texto))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", t.lower())


# Otras formas de escribir el nombre (ya normalizadas: sin tildes, sin espacios)
ALIAS = {
    "ciudaddebuenosaires": "CABA", "ciudadautonomadebuenosaires": "CABA", "capitalfederal": "CABA",
    "ciudadautonoma": "CABA", "caba": "CABA",
    "sgodelestero": "Santiago del Estero", "stgodelestero": "Santiago del Estero",
    "tdelfuego": "Tierra del Fuego", "tierradelfuegoantartidaeislasdelatlanticosur": "Tierra del Fuego",
}
PREFIJOS = ("banderadelaprovinciade", "banderadelaprovincia", "banderadeprovinciade", "banderade",
            "bandera", "flagof")


def provincia_de_archivo(nombre_archivo, provincias):
    """Adivina a qué provincia corresponde un archivo por su nombre. Devuelve None si no lo reconoce."""
    n = normalizar(Path(nombre_archivo).stem)
    for pre in PREFIJOS:
        if n.startswith(pre) and len(n) > len(pre):
            n = n[len(pre):]
            break
    n = re.sub(r"(province|provincia|argentina)$", "", n) or n
    # 1) alias (el más largo que esté contenido), 2) nombre de provincia (el más largo contenido)
    for clave in sorted(ALIAS, key=len, reverse=True):
        if clave in n:
            return ALIAS[clave]
    for prov in sorted(provincias, key=lambda x: len(normalizar(x)), reverse=True):
        if normalizar(prov) in n:
            return prov
    return None


def preparar_imagen(ruta):
    """Devuelve la imagen como 'data:...;base64,...' (achicada si se puede). None si no se pudo."""
    ruta = Path(ruta)
    ext = ruta.suffix.lower()
    datos = ruta.read_bytes()
    if ext == ".svg":
        if len(datos) > 120_000:
            print(f"   ! {ruta.name}: el SVG pesa {len(datos)//1024} KB; conviene usar una versión PNG más liviana.")
        return "data:image/svg+xml;base64," + base64.b64encode(datos).decode()
    try:
        from PIL import Image                       # Pillow: achica las imágenes (si está instalado)
        import io
        im = Image.open(ruta).convert("RGBA")
        if im.height > ALTO_BANDERA:
            im = im.resize((max(1, round(im.width * ALTO_BANDERA / im.height)), ALTO_BANDERA), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except ImportError:
        if len(datos) > 60_000:
            print(f"   ! {ruta.name} pesa {len(datos)//1024} KB. Para que se achiquen solas, instalá Pillow "
                  f"(en la Terminal: pip3 install pillow) y volvé a correr.")
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
                ".gif": "image/gif"}.get(ext)
        return f"data:{mime};base64," + base64.b64encode(datos).decode() if mime else None
    except Exception as e:
        print(f"   ! No pude leer {ruta.name}: {e}")
        return None


def cargar_banderas(provincias):
    if not CARPETA_BANDERAS.exists():
        print("Banderas: no hay carpeta 'banderas' (es opcional). Si la creás con una imagen por provincia, aparecen en la web.\n")
        return {}
    out, sin_reconocer, vistos = {}, [], set()
    archivos = sorted(f for f in CARPETA_BANDERAS.iterdir()
                      if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"))
    for f in archivos:
        prov = provincia_de_archivo(f.name, provincias)
        if prov is None:
            sin_reconocer.append(f.name)
            continue
        if prov in out:
            print(f"   ! Hay dos archivos para {prov} ({vistos_nombre(prov, vistos)} y {f.name}); me quedo con el último.")
        uri = preparar_imagen(f)
        if uri:
            out[prov] = uri
            vistos.add((prov, f.name))
    faltan = [p for p in provincias if p not in out]
    print(f"Banderas: {len(out)} cargadas de {len(provincias)}.")
    if faltan:
        print(f"   Faltan: {', '.join(faltan)}")
    if sin_reconocer:
        print(f"   No reconocí estos archivos (renombralos con el nombre de la provincia): {', '.join(sin_reconocer)}")
    print()
    return out


def vistos_nombre(prov, vistos):
    return next((n for p, n in vistos if p == prov), "?")


def main():
    print(f"Carpeta de trabajo: {RAIZ}\n")
    faltan = [p.name for p in (PLANTILLA, GEOJSON, DATOS) if not p.exists()]
    if faltan:
        raise SystemExit(f"Faltan archivos en la carpeta: {faltan}\n"
                         f"Tienen que estar al lado de armar_web.py (datos.json va dentro de 'data').")

    datos = json.loads(DATOS.read_text(encoding="utf-8"))
    geo = json.loads(GEOJSON.read_text(encoding="utf-8"))

    # Control: datos.json tiene que ser el de la versión nueva de armar_base.py
    necesarias = ("inicio", "fin", "serie_diaria", "ipc_por_mes")
    sin = [k for k in necesarias if k not in datos]
    if sin:
        raise SystemExit(f"Tu data/datos.json es de una versión vieja (le faltan: {sin}).\n"
                         f"Corré primero armar_base.py (la versión nueva) para regenerarlo y después este script.")

    provincias = sorted(p for p in datos["serie_diaria"] if p != "TOTAL")
    datos["banderas"] = cargar_banderas(provincias)

    html = PLANTILLA.read_text(encoding="utf-8")
    for marca in ("/*__DATOS__*/null", "/*__GEO__*/null"):
        if marca not in html:
            raise SystemExit(f"{PLANTILLA.name} no tiene la marca {marca}. ¿Es la versión correcta?")
    html = html.replace("/*__DATOS__*/null", a_js(datos)).replace("/*__GEO__*/null", a_js(geo))

    # plantilla_neon.html -> index.html (lo que publica Cloudflare)
    SALIDA.write_text(html, encoding="utf-8")
    kb = SALIDA.stat().st_size / 1024
    print(f"Listo: {SALIDA.name} ({kb:.0f} KB) · datos hasta el {datos['fin']} · "
          f"{len(datos['serie_diaria'])} jurisdicciones · {len(geo['features'])} provincias en el mapa")
    print("Abrilo con doble click para verlo.")


if __name__ == "__main__":
    main()
