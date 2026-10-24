"""
actualizar.py
=============
El "robot": hace solo lo que antes hacías a mano.

  1. Entra a la página de Asuntos Provinciales (Secretaría de Hacienda).
  2. Busca los Excel de "Montos diarios" y de "Información consolidada".
  3. Descarga los que cambiaron y los guarda en 'diarios' y 'consolidados'
     (si un mes ya tenía archivo, reemplaza el viejo por el nuevo).
  4. Corre armar_base.py y armar_web.py  ->  nuevo index.html.

Lo corre GitHub Actions todos los días (.github/workflows/actualizar.yml).
También se puede correr a mano en la compu:  python3 actualizar.py

El IPC NO se descarga: se sigue cargando a mano en data/ipc.csv.
"""
import hashlib
import re
import shutil
import sys
import tempfile
import time
from datetime import date
from pathlib import Path
from urllib.parse import urljoin, unquote

import requests

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
import armar_base  # noqa: E402  (usa sus funciones para leer los Excel)
import armar_web   # noqa: E402

PAGINA = "https://www.argentina.gob.ar/economia/sechacienda/asuntosprovinciales/ron"
BASE_URL = "https://www.argentina.gob.ar"
CARPETA_DIARIOS = RAIZ / "diarios"
CARPETA_CONSOLIDADOS = RAIZ / "consolidados"
TEMPORAL = Path(tempfile.mkdtemp(prefix="copa_"))
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept-Language": "es-AR,es;q=0.9",
}


# ----------------------------------------------------------------------
# Descargas
# ----------------------------------------------------------------------
def bajar(url, intentos=3):
    """Descarga una URL con reintentos. Devuelve los bytes."""
    for i in range(1, intentos + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=60)
            r.raise_for_status()
            return r.content
        except requests.RequestException as e:
            if i == intentos:
                raise
            print(f"  ! Falló la descarga ({e}). Reintento en {10 * i} s...")
            time.sleep(10 * i)


def links_de_la_pagina():
    """Devuelve (links_diarios, links_consolidados) encontrados en la página."""
    html = bajar(PAGINA).decode("utf-8", errors="replace")
    rutas = set(re.findall(r'(?:https?://www\.argentina\.gob\.ar)?(/sites/default/files/[^"\'\s<>#?]+?\.xlsx?)',
                           html, flags=re.I))
    urls = sorted(urljoin(BASE_URL, r) for r in rutas)

    diarios = [u for u in urls if "diario" in u.lower() and u.lower().endswith(".xls")]
    anio_min = date.today().year - 1          # solo el año actual y el anterior
    consolidados = []
    for u in urls:
        m = re.search(r"consolidada_?(\d{4})", u.lower())
        if m and int(m.group(1)) >= anio_min:
            consolidados.append(u)
    return diarios, consolidados


def huella(datos):
    return hashlib.sha256(datos).hexdigest()


def nombre_de(url):
    return unquote(url.rsplit("/", 1)[-1])


# ----------------------------------------------------------------------
# Diarios: un archivo por mes. Si el mes ya estaba, se reemplaza.
# ----------------------------------------------------------------------
def meses_de_archivo(ruta):
    """Meses (AAAA-MM) que trae un Excel diario. Vacío si no se pudo leer."""
    try:
        d = armar_base.leer_diario(ruta)
    except Exception as e:
        print(f"  ! No pude leer {Path(ruta).name}: {e}")
        return set()
    return set(d["fecha"].dt.strftime("%Y-%m")) if len(d) else set()


def actualizar_diarios(links):
    CARPETA_DIARIOS.mkdir(exist_ok=True)
    existentes = {huella(f.read_bytes()): f for f in CARPETA_DIARIOS.glob("*.xls")}
    meses_existentes = None                    # se calcula solo si hace falta
    cambios = []

    for url in links:
        datos = bajar(url)
        if huella(datos) in existentes:
            continue                           # ya lo tenemos igualito
        nombre = nombre_de(url)
        tmp = TEMPORAL / nombre                # fuera de 'diarios' hasta confirmar
        tmp.write_bytes(datos)
        meses = meses_de_archivo(tmp)
        if not meses:
            print(f"  ! {nombre}: no tiene datos legibles todavía; lo salteo.")
            tmp.unlink()
            continue

        if meses_existentes is None:
            meses_existentes = {f: meses_de_archivo(f) for f in CARPETA_DIARIOS.glob("*.xls")}
        # Saco los archivos viejos de esos mismos meses (el nuevo los reemplaza)
        for viejo, ms in list(meses_existentes.items()):
            if ms & meses and viejo.exists():
                print(f"  - reemplazo {viejo.name}")
                viejo.unlink()
                del meses_existentes[viejo]
        destino = CARPETA_DIARIOS / nombre
        shutil.move(str(tmp), destino)
        meses_existentes[destino] = meses
        cambios.append(f"{nombre} ({', '.join(sorted(meses))})")
        print(f"  + {nombre}: {', '.join(sorted(meses))}")
    return cambios


# ----------------------------------------------------------------------
# Consolidados: un archivo por año. Si el año ya estaba, se reemplaza.
# ----------------------------------------------------------------------
def anio_de(nombre):
    m = re.search(r"consolidada_?(\d{4})", nombre.lower())
    return int(m.group(1)) if m else None


def actualizar_consolidados(links):
    CARPETA_CONSOLIDADOS.mkdir(exist_ok=True)
    existentes = list(CARPETA_CONSOLIDADOS.glob("*.xls*"))
    huellas = {huella(f.read_bytes()) for f in existentes}
    cambios = []
    for url in links:
        datos = bajar(url)
        if huella(datos) in huellas:
            continue
        nombre, anio = nombre_de(url), anio_de(nombre_de(url))
        for viejo in existentes:
            if anio_de(viejo.name) == anio and viejo.exists():
                print(f"  - reemplazo {viejo.name}")
                viejo.unlink()
        (CARPETA_CONSOLIDADOS / nombre).write_bytes(datos)
        cambios.append(nombre)
        print(f"  + {nombre}")
    return cambios


# ----------------------------------------------------------------------
def main():
    print(f"Buscando archivos en {PAGINA}\n")
    diarios, consolidados = links_de_la_pagina()
    print(f"Encontré {len(diarios)} archivos diarios y {len(consolidados)} consolidados.")
    if not diarios:
        raise SystemExit("No encontré ningún Excel de montos diarios en la página. "
                         "¿Cambió el diseño de la web del gobierno? Revisar a mano.")

    print("\nDIARIOS")
    c1 = actualizar_diarios(diarios)
    print("\nCONSOLIDADOS")
    c2 = actualizar_consolidados(consolidados)
    print(f"\nArchivos nuevos o actualizados: {len(c1) + len(c2)}\n")

    # Siempre se regenera: así también toma cambios en ipc.csv o en la plantilla
    armar_base.main()
    armar_web.main()


if __name__ == "__main__":
    main()
