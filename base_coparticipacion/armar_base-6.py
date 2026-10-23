"""
armar_base.py
=============
Arma la base de coparticipación y genera el archivo de datos para la web.

ESTRUCTURA DE CARPETAS (todo al lado de este script):
    armar_base.py
    diarios/               <- acá van los internet_diario*.xls (2025, 2026, ...)
    consolidados/          <- acá van los informacion_consolidada_AAAA*.xlsx (uno por año)
    data/
        ipc.csv            <- lo completás vos: mes,ipc_interanual,fuente  (ej: 2026-10,32.4,Estimado)
        coparticipacion.csv  (la crea el script)
        datos.json           (lo crea el script, es el que lee la web)

CÓMO CORRERLO EN SPYDER:
    Abrí el archivo y apretá F5. Para probar por etapas, comentá con # las
    líneas del bloque "main()" que no quieras ejecutar todavía.

REQUISITOS (una sola vez, en la consola de Spyder):
    pip install pandas xlrd openpyxl
"""
import glob
import json
import re
from pathlib import Path

import pandas as pd

# ----------------------------------------------------------------------
# CONFIGURACIÓN
# ----------------------------------------------------------------------
try:
    RAIZ = Path(__file__).parent          # carpeta donde está este script
except NameError:                          # por si lo pegás en la consola
    RAIZ = Path.cwd()

CARPETA_DIARIOS = RAIZ / "diarios"
CARPETA_CONSOLIDADOS = RAIZ / "consolidados"
BASE_CSV = RAIZ / "data" / "coparticipacion.csv"
BASE_MENSUAL_CSV = RAIZ / "data" / "consolidado_mensual.csv"
IPC_CSV = RAIZ / "data" / "ipc.csv"
SALIDA_JSON = RAIZ / "data" / "datos.json"

COL_TOTAL = 28            # columna AC: "Total (1)+(2)"
FILA_NOMBRE = 4           # fila 5 (índices de pandas arrancan en 0)
FILA_MES = 8              # fila 9
FILAS_DIAS = (17, 48)     # filas 18 a 48 -> días 1 a 31

# Hojas del consolidado: una por mes (la hoja "CONS" es el acumulado y se usa solo para chequear)
MESES_HOJA = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
              "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
FILA_PRIMERA_PROV = 9     # fila 10 del consolidado = Buenos Aires
# Filas del consolidado que NO son provincias (se ignoran)
NO_PROVINCIAS = {"PROVINCIAS", "FDO.COMPENSADOR", "TESORO NACIONAL (*)", "SEGURIDAD SOCIAL", "FONDO A.T.N."}

MESES = {"ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4, "MAYO": 5, "JUNIO": 6,
         "JULIO": 7, "AGOSTO": 8, "SEPTIEMBRE": 9, "SETIEMBRE": 9, "OCTUBRE": 10,
         "NOVIEMBRE": 11, "DICIEMBRE": 12}


# ======================================================================
# PASO 1: BASE ÚNICA  (fecha | provincia | monto)
# ======================================================================
def limpiar_nombre(texto):
    """'PROVINCIA DE LA RIOJA' -> 'La Rioja', etc."""
    t = str(texto).strip().upper()
    if t.startswith("24 JURISDICCIONES"):
        return "TOTAL"
    if "CIUDAD DE BUENOS AIRES" in t or t.replace(".", "") == "CABA":
        return "CABA"
    t = re.sub(r"^PROVINCIA (DEL|DE)\s+", "", t)      # saca "PROVINCIA DE/DEL"
    t = t.title()
    t = t.replace("Sgo. Del", "Santiago del").replace("Santiago Del", "Santiago del")
    t = t.replace("Tierra Del", "Tierra del")
    return t


def es_hoja_de_provincia(df):
    """Las hojas válidas tienen el nombre en la fila 5 y llegan hasta la col AC."""
    if df.shape[1] <= COL_TOTAL or df.shape[0] <= FILAS_DIAS[1]:
        return False
    celda = str(df.iloc[FILA_NOMBRE, 0]).upper()
    return any(p in celda for p in ("PROVINCIA", "GOBIERNO", "JURISDICCIONES"))


def leer_diario(ruta):
    """Lee UN archivo .xls y devuelve un DataFrame fecha | provincia | monto."""
    xls = pd.ExcelFile(ruta, engine="xlrd")
    filas = []
    omitidas = []                                      # hojas que no tienen el formato esperado
    for hoja in xls.sheet_names:
        df = xls.parse(hoja, header=None)
        if not es_hoja_de_provincia(df):
            if not hoja.strip().lower().startswith("punto"):   # "Punto I.c" se ignora a propósito
                omitidas.append(hoja)
            continue

        # mes y año: "MES DE OCTUBRE DEL 2026"
        m = re.search(r"MES DE (\w+) DEL (\d{4})", str(df.iloc[FILA_MES, 0]).upper())
        if not m:
            print(f"  ! No pude leer el mes en la hoja '{hoja}' de {Path(ruta).name}")
            continue
        mes, anio = MESES[m.group(1)], int(m.group(2))
        provincia = limpiar_nombre(df.iloc[FILA_NOMBRE, 0])

        # días 1..31 y su monto
        for _, fila in df.iloc[FILAS_DIAS[0]:FILAS_DIAS[1] + 1].iterrows():
            dia, monto = fila[0], fila[COL_TOTAL]
            es_dia = isinstance(dia, (int, float)) and pd.notna(dia)
            if es_dia and pd.notna(monto) and monto > 0:   # los días en 0 no se guardan
                try:
                    fecha = pd.Timestamp(year=anio, month=mes, day=int(dia))
                except ValueError:                         # ej: día 31 en un mes de 30
                    continue
                filas.append({"fecha": fecha, "provincia": provincia, "monto": float(monto)})
    out = pd.DataFrame(filas, columns=["fecha", "provincia", "monto"])
    out.attrs["omitidas"] = omitidas
    return out


def paso1_armar_base(carpeta=CARPETA_DIARIOS, base_csv=BASE_CSV):
    """Lee todos los .xls de la carpeta y actualiza data/coparticipacion.csv."""
    archivos = sorted(glob.glob(str(Path(carpeta) / "*.xls")))
    if not archivos:
        raise SystemExit(f"No encontré archivos .xls en: {carpeta}\n"
                         f"El script tiene que estar en la MISMA carpeta que 'diarios', 'consolidados' y 'data'.\n"
                         f"Ahora está corriendo desde: {RAIZ}\n"
                         f"Abrí en IDLE el armar_base.py que está dentro de tu carpeta base_coparticipacion.")

    print(f"PASO 1 · leyendo {len(archivos)} archivo(s)...")
    partes, por_mes, avisos = [], {}, []
    for ruta in archivos:
        nombre = Path(ruta).name
        d = leer_diario(ruta)
        meses = sorted(d["fecha"].dt.strftime("%Y-%m").unique()) if len(d) else []
        print(f"  {nombre}: {len(d)} filas · mes detectado: {', '.join(meses) if meses else '¡NINGUNO!'}")
        if d.empty:
            avisos.append(f"{nombre}: no se pudo leer ningún dato (¿formato distinto?)")
        if d.attrs.get("omitidas"):
            avisos.append(f"{nombre}: hojas omitidas por formato distinto: {d.attrs['omitidas']}")
        for m in meses:
            por_mes.setdefault(m, []).append(nombre)
        partes.append(d)
    nuevos = pd.concat(partes, ignore_index=True)

    # Controles: mes repetido en 2 archivos y meses sin archivo
    for m, nombres in sorted(por_mes.items()):
        if len(nombres) > 1:
            avisos.append(f"el mes {m} aparece en {len(nombres)} archivos: {nombres} "
                          f"(se queda con el último en orden alfabético)")
    if por_mes:
        rango = pd.period_range(min(por_mes), max(por_mes), freq="M").astype(str)
        faltan = [m for m in rango if m not in por_mes]
        if faltan:
            avisos.append(f"meses sin archivo entre {min(por_mes)} y {max(por_mes)}: {faltan}")
    for a in avisos:
        print(f"  ! {a}")

    # Si ya había base, la sumamos; en caso de duplicados (mismo día y
    # provincia) gana lo NUEVO (keep="last").
    if Path(base_csv).exists():
        viejo = pd.read_csv(base_csv, parse_dates=["fecha"])
        todo = pd.concat([viejo, nuevos], ignore_index=True)
    else:
        todo = nuevos
    todo = (todo.drop_duplicates(subset=["fecha", "provincia"], keep="last")
                .sort_values(["provincia", "fecha"]))

    Path(base_csv).parent.mkdir(parents=True, exist_ok=True)
    todo.to_csv(base_csv, index=False)
    print(f"  Base guardada: {len(todo)} filas · {todo['provincia'].nunique()} jurisdicciones · "
          f"{todo['fecha'].min().date()} a {todo['fecha'].max().date()}\n")
    return todo


# ======================================================================
# PASO 1b: CONSOLIDADO MENSUAL  (mes | provincia | monto)
# ======================================================================
# Un libro por año (informacion_consolidada_2026_6.xlsx): una hoja por mes,
# provincias en filas, y el mismo "Total (1)+(2)" en la columna AC.
def _filas_consolidado(df):
    """Devuelve {provincia: monto} de una hoja (mes o CONS). Ignora Tesoro, ATN, etc."""
    out = {}
    for i in range(FILA_PRIMERA_PROV, len(df)):
        celda = df.iloc[i, 0]
        if pd.isna(celda):
            continue
        t = str(celda).strip().upper()
        if t.startswith("TOTAL"):
            break                                    # termina la tabla de provincias
        if t in NO_PROVINCIAS:
            continue
        monto = df.iloc[i, COL_TOTAL]
        if pd.notna(monto):
            out[limpiar_nombre(celda)] = float(monto)
    return out


def leer_consolidado(ruta):
    """Lee UN libro consolidado. Devuelve (DataFrame mes|provincia|monto, dict CONS)."""
    xls = pd.ExcelFile(ruta)
    m = re.search(r"consolidada_?(\d{4})", Path(ruta).name)
    anio = int(m.group(1)) if m else None
    if anio is None and "CONS" in xls.sheet_names:       # plan B: título de la hoja CONS
        titulo = " ".join(str(v) for v in xls.parse("CONS", header=None).iloc[:6, :].values.ravel() if pd.notna(v))
        m = re.search(r"AÑO (\d{4})", titulo.upper())
        anio = int(m.group(1)) if m else None
    if anio is None:
        raise SystemExit(f"No pude saber el año de {Path(ruta).name}")

    filas = []
    for hoja in xls.sheet_names:
        if hoja.strip().lower() not in MESES_HOJA:
            continue                                     # saltea CONS u otras hojas
        df = xls.parse(hoja, header=None)
        if df.shape[1] <= COL_TOTAL:
            continue
        datos_mes = _filas_consolidado(df)
        if sum(datos_mes.values()) <= 0:
            continue                                     # mes vacío / todavía sin datos
        mes = f"{anio}-{MESES_HOJA[hoja.strip().lower()]:02d}"
        for prov, monto in datos_mes.items():
            filas.append({"mes": mes, "provincia": prov, "monto": monto})
        filas.append({"mes": mes, "provincia": "TOTAL", "monto": sum(datos_mes.values())})  # 24 jurisdicciones

    cons = _filas_consolidado(xls.parse("CONS", header=None)) if "CONS" in xls.sheet_names else {}
    return pd.DataFrame(filas, columns=["mes", "provincia", "monto"]), cons


def paso1b_armar_base_mensual(carpeta=CARPETA_CONSOLIDADOS, base_csv=BASE_MENSUAL_CSV):
    """Lee los libros consolidados y actualiza data/consolidado_mensual.csv."""
    archivos = sorted(glob.glob(str(Path(carpeta) / "*.xlsx")) + glob.glob(str(Path(carpeta) / "*.xls")))
    if not archivos:
        print(f"PASO 1b · no hay archivos .xlsx/.xls en {carpeta}: la vista mensual usará solo los diarios.\n")
        return pd.read_csv(base_csv) if Path(base_csv).exists() else pd.DataFrame(columns=["mes", "provincia", "monto"])

    print(f"PASO 1b · leyendo {len(archivos)} consolidado(s)...")
    partes = []
    for ruta in archivos:
        d, cons = leer_consolidado(ruta)
        meses = sorted(d["mes"].unique())
        print(f"  {Path(ruta).name}: meses {meses[0] if meses else '-'} a {meses[-1] if meses else '-'} "
              f"({len(meses)} hojas)")
        # CHEQUEO: la suma de las hojas mensuales debe dar lo que dice la hoja CONS
        if cons and meses:
            suma = d[d.provincia != "TOTAL"].groupby("provincia")["monto"].sum()
            dif = max(abs(suma.get(p, 0) - v) for p, v in cons.items())
            print(f"    Chequeo contra hoja CONS: {'OK' if dif < 1 else 'REVISAR'} (diferencia máxima {dif:,.2f} mm $)")
        partes.append(d)
    nuevos = pd.concat(partes, ignore_index=True)

    if Path(base_csv).exists():
        todo = pd.concat([pd.read_csv(base_csv), nuevos], ignore_index=True)
    else:
        todo = nuevos
    todo = (todo.drop_duplicates(subset=["mes", "provincia"], keep="last")   # lo nuevo pisa lo viejo
                .sort_values(["provincia", "mes"]))
    Path(base_csv).parent.mkdir(parents=True, exist_ok=True)
    todo.to_csv(base_csv, index=False)
    print(f"  Base mensual guardada: {len(todo)} filas · meses {todo['mes'].min()} a {todo['mes'].max()}\n")
    return todo


def comparar_diarios_vs_consolidado(base, mensual, provincia="La Rioja"):
    """Informativo: para los meses que están en las dos fuentes, compara la suma de días vs el consolidado."""
    if mensual.empty:
        return
    d = base[base.provincia == provincia].assign(mes=lambda x: x.fecha.dt.strftime("%Y-%m"))
    suma_d = d.groupby("mes")["monto"].sum()
    for _, f in mensual[mensual.provincia == provincia].iterrows():
        if f["mes"] in suma_d.index:
            dif = (suma_d[f["mes"]] / f["monto"] - 1) * 100
            print(f"  {provincia} {f['mes']}: diarios {suma_d[f['mes']]:,.1f} vs consolidado {f['monto']:,.1f} "
                  f"({dif:+.2f}%)")


# ======================================================================
# PASO 2: CÁLCULOS POR PROVINCIA
# ======================================================================
def leer_ipc(ipc_csv=IPC_CSV):
    """Devuelve el IPC como serie {Period('2026-10'): 32.4}. Crea la plantilla si falta."""
    if not Path(ipc_csv).exists():
        Path(ipc_csv).parent.mkdir(parents=True, exist_ok=True)
        Path(ipc_csv).write_text("mes,ipc_interanual\n", encoding="utf-8")
        raise SystemExit(f"Creé la plantilla {ipc_csv}. Completala (mes,ipc_interanual) y volvé a correr.")
    ipc = pd.read_csv(ipc_csv)
    if ipc.empty:
        raise SystemExit(f"{ipc_csv} está vacío: cargá al menos un mes (ej: 2026-10,32.4).")
    ipc["mes"] = pd.PeriodIndex(ipc["mes"].astype(str), freq="M")
    return ipc.set_index("mes")["ipc_interanual"].sort_index()


def leer_fuentes_ipc(ipc_csv=IPC_CSV):
    """Devuelve {'2026-09': 'REM BCRA', ...}. La columna 'fuente' es opcional."""
    ipc = pd.read_csv(ipc_csv)
    if "fuente" not in ipc.columns:
        return {}
    return {str(m): str(f) for m, f in zip(ipc["mes"], ipc["fuente"].fillna(""))}


def elegir_ipc(serie, anio, mes):
    """IPC del mes del corte; si no está, el último disponible anterior."""
    periodo = pd.Period(f"{anio}-{mes:02d}", freq="M")
    previos = serie[serie.index <= periodo]
    if periodo in serie.index:
        return float(serie[periodo]), str(periodo)
    if not previos.empty:
        ult = previos.index[-1]
        print(f"  ! Falta el IPC de {periodo}: uso el último disponible ({ult}).")
        return float(previos.iloc[-1]), str(ult)
    ult = serie.index[0]
    print(f"  ! No hay IPC hasta {periodo}: uso el primero cargado ({ult}).")
    return float(serie.iloc[0]), str(ult)


def acumulado_hasta_corte(df, anio, mes, dia):
    """Filas del mes `mes` de `anio`, desde el día 1 hasta el día `dia`."""
    return df[(df.fecha.dt.year == anio) & (df.fecha.dt.month == mes) & (df.fecha.dt.day <= dia)]


def variaciones(actual, anterior, ipc_pct):
    """Devuelve (actualizada, var_nominal %, var_real %). None si no hay año anterior."""
    if not anterior:
        return None, None, None
    actualizada = anterior * (1 + ipc_pct / 100)
    nominal = (actual / anterior - 1) * 100
    real = (actual / actualizada - 1) * 100
    return actualizada, nominal, real


def paso2_calcular(base, ipc_csv=IPC_CSV):
    """Calcula todo para cada provincia. Devuelve un dict listo para el JSON."""
    print("PASO 2 · calculando...")
    corte = base["fecha"].max()                      # último día con datos publicados
    anio, mes, dia = corte.year, corte.month, corte.day
    ipc_pct, ipc_mes = elegir_ipc(leer_ipc(ipc_csv), anio, mes)
    print(f"  Corte: {corte.date()} · IPC interanual usado: {ipc_pct}% (mes {ipc_mes})")

    r2 = lambda x: None if x is None else round(float(x), 2)
    provincias = {}
    sin_anterior = []
    for nombre, d in base.groupby("provincia"):
        act = acumulado_hasta_corte(d, anio, mes, dia).sort_values("fecha")
        ant = acumulado_hasta_corte(d, anio - 1, mes, dia).sort_values("fecha")
        suma_act, suma_ant = act["monto"].sum(), ant["monto"].sum()
        actualizada, nominal, real = variaciones(suma_act, suma_ant, ipc_pct)

        provincias[nombre] = {
            "acum_actual": r2(suma_act),
            "acum_anterior": r2(suma_ant) if suma_ant else None,
            "actualizada": r2(actualizada),
            "var_nominal": r2(nominal),
            "var_real": r2(real),
            "diario_actual": [{"dia": int(f.fecha.day), "monto": r2(f.monto)} for f in act.itertuples()],
            "diario_anterior": [{"dia": int(f.fecha.day), "monto": r2(f.monto)} for f in ant.itertuples()],
        }
        if not suma_ant:
            sin_anterior.append(nombre)

    if sin_anterior:
        print(f"  ! {len(sin_anterior)} jurisdicción(es) sin datos del año anterior "
              f"para ese corte (¿falta cargar el diario de {anio-1}?)")

    return {
        "actualizado": str(corte.date()),
        "corte": {"anio": anio, "mes": mes, "dia": dia},
        "ipc_interanual": ipc_pct,
        "ipc_mes": ipc_mes,
        "provincias": provincias,
    }


# ======================================================================
# PASO 3: GENERAR datos.json  (series diarias completas + IPC por mes)
# ======================================================================
# La web recibe TODOS los días de cada provincia y el IPC de cada mes, y
# calcula en el navegador lo que el usuario pida (diario, mensual o anual
# hasta la fecha que elija). Por eso acá no hace falta precalcular rangos.
def paso3_guardar_json(datos, base, mensual, ipc_csv=IPC_CSV, salida=SALIDA_JSON):
    # Calendario completo: del 1/1 del primer año cargado hasta el último dato
    inicio = pd.Timestamp(year=base["fecha"].min().year, month=1, day=1)
    fin = base["fecha"].max()
    calendario = pd.date_range(inicio, fin)

    # Una lista de montos por provincia: posición 0 = inicio, 1 = inicio+1 día...
    # Los días sin pago quedan en 0.
    series = {}
    for nombre, d in base.groupby("provincia"):
        s = d.set_index("fecha")["monto"].reindex(calendario, fill_value=0)
        series[nombre] = [round(float(x), 2) for x in s]

    ipc = leer_ipc(ipc_csv)
    datos["inicio"] = str(inicio.date())
    datos["fin"] = str(fin.date())
    datos["ipc_por_mes"] = {str(p): float(v) for p, v in ipc.items()}   # "2026-10": 32.4
    datos["ipc_fuente_por_mes"] = leer_fuentes_ipc(ipc_csv)             # "2026-09": "REM BCRA"
    datos["serie_diaria"] = series
    # Consolidado mensual: {"La Rioja": {"2026-09": 137927.3, ...}}  (vista mensual de la web)
    datos["mensual_consolidado"] = {
        prov: {r.mes: round(float(r.monto), 2) for r in g.itertuples()}
        for prov, g in mensual.groupby("provincia")}

    Path(salida).parent.mkdir(parents=True, exist_ok=True)
    with open(salida, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, separators=(",", ":"))
    kb = Path(salida).stat().st_size / 1024
    print(f"PASO 3 · guardado {salida} ({len(series)} jurisdicciones, {len(calendario)} días, {kb:.0f} KB)\n")


# ======================================================================
# EJECUCIÓN  (comentá con # lo que no quieras correr)
# ======================================================================
def main():
    print(f"Carpeta de trabajo: {RAIZ}\n")
    base = paso1_armar_base()                 # PASO 1  · diarios
    mensual = paso1b_armar_base_mensual()     # PASO 1b · consolidado mensual
    comparar_diarios_vs_consolidado(base, mensual)   # (informativo)
    datos = paso2_calcular(base)              # PASO 2
    paso3_guardar_json(datos, base, mensual)  # PASO 3

    # Chequeo rápido: La Rioja debe coincidir con tu planilla
    lr = datos["provincias"].get("La Rioja")
    if lr:
        print("La Rioja →", {k: lr[k] for k in ("acum_actual", "acum_anterior", "actualizada",
                                                 "var_nominal", "var_real")})


if __name__ == "__main__":
    main()
