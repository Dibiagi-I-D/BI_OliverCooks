import json
import logging
import pyodbc
import anthropic
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Conexión SQL Server ─────────────────────────────────────
DB_CONN_STR = (
    "DRIVER={ODBC Driver 18 for SQL Server};"
    "SERVER=ServerSQL2022;"
    "DATABASE=DIBIAG;"
    "UID=sa;"
    "PWD=Password1!;"
    "TrustServerCertificate=yes;"
)

ANTHROPIC_API_KEY = "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"
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

app = FastAPI(title="Oliver Cooks — Chat IA")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schema de la base de datos (tablas relevantes) ──────────
DB_SCHEMA = """
Tablas relevantes en la base de datos DIBIAG (SQL Server):

1. FCRMVH — Cabecera de comprobantes de ventas
   - FCRMVH_CODEMP  : Código de empresa
   - FCRMVH_MODFOR  : Módulo (usar 'FC')
   - FCRMVH_CODFOR  : Tipo de comprobante (usar 'FA0019' para facturas de venta)
   - FCRMVH_NROFOR  : Número de comprobante
   - FCRMVH_FCHMOV  : Fecha del movimiento (DATE)
   - FCRMVH_FECALT  : Fecha de alta (DATE)
   - FCRMVH_NROCTA  : Número de cuenta del cliente
   - FCRMVH_NROSUB  : Número de subcuenta del cliente
   - FCRMVH_SUCURS  : Sucursal
   - FCRMVH_USERID  : Usuario que realizó la venta

2. FCRMVI — Ítems/líneas de comprobantes de ventas
   - FCRMVI_CODEMP  : Código de empresa
   - FCRMVI_MODFOR  : Módulo
   - FCRMVI_CODFOR  : Tipo de comprobante
   - FCRMVI_NROFOR  : Número de comprobante (clave foránea a FCRMVH)
   - FCRMVI_NROITM  : Número de ítem
   - FCRMVI_ARTCOD  : Código de producto
   - FCRMVI_TIPPRO  : Tipo de producto (usar 'PRODTE' para productos de aceite)
   - FCRMVI_CANTID  : Cantidad vendida
   - FCRMVI_PRECIO  : Precio unitario
   - FCRMVI_TOTLIN  : Total de la línea (si 0, calcular CANTID * PRECIO)
   - FCRMVI_DEPOSI  : Código de depósito
   - FCRMVI_SECTOR  : Código de sector
   - FCRMVI_PRESEC  : Precio en moneda secundaria

3. VTMCLH — Clientes
   - VTMCLH_NROCTA  : Número de cuenta
   - VTMCLH_NROSUB  : Número de subcuenta
   - VTMCLH_NOMBRE  : Nombre del cliente

4. STMPDH — Productos/Artículos
   - STMPDH_ARTCOD  : Código de artículo
   - STMPDH_DESCRP  : Descripción del producto
   - STMPDH_TIPPRO  : Tipo de producto (usar 'GI    ' con espacios)

5. STTDEH — Depósitos
   - STTDEH_DEPOSI  : Código de depósito
   - STTDEH_DESCRP  : Nombre del depósito

6. STTDEI — Sectores dentro de depósitos
   - STTDEI_DEPOSI  : Código de depósito
   - STTDEI_SECTOR  : Código de sector
   - STTDEI_DESCRP  : Nombre del sector

JOINS estándar:
  FCRMVH h JOIN FCRMVI i ON h.FCRMVH_CODEMP=i.FCRMVI_CODEMP AND h.FCRMVH_MODFOR=i.FCRMVI_MODFOR AND h.FCRMVH_CODFOR=i.FCRMVI_CODFOR AND h.FCRMVH_NROFOR=i.FCRMVI_NROFOR
  JOIN VTMCLH c ON h.FCRMVH_NROCTA=c.VTMCLH_NROCTA AND h.FCRMVH_NROSUB=c.VTMCLH_NROSUB
  JOIN STMPDH art ON art.STMPDH_TIPPRO='GI    ' AND TRY_CAST(LTRIM(art.STMPDH_ARTCOD) AS INT)=TRY_CAST(LTRIM(i.FCRMVI_ARTCOD) AS INT)

Filtros obligatorios base:
  h.FCRMVH_CODFOR = 'FA0019'
  i.FCRMVI_TIPPRO = 'PRODTE'
  i.FCRMVI_CANTID > 0

Total de línea: CASE WHEN i.FCRMVI_TOTLIN=0 THEN i.FCRMVI_CANTID*i.FCRMVI_PRECIO ELSE i.FCRMVI_TOTLIN END

Empresa: Oliver Cooks — aceite de oliva extra virgen, Mendoza, Argentina.
Moneda: pesos argentinos (ARS).
"""


def get_connection():
    return pyodbc.connect(DB_CONN_STR, timeout=30)


def run_query(sql: str) -> list[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(sql)
    columns = [col[0] for col in cursor.description]
    rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    cursor.close()
    conn.close()
    return rows


async def human_query_to_sql(human_query: str) -> str:
    system_prompt = f"""Sos un experto en SQL Server trabajando para Oliver Cooks, empresa de aceite de oliva extra virgen de Mendoza, Argentina.

Tu única tarea es convertir preguntas en lenguaje natural a consultas SQL válidas para SQL Server.

{DB_SCHEMA}

REGLAS:
- Respondé ÚNICAMENTE con un objeto JSON válido, sin markdown, sin texto adicional.
- Formato: {{"sql_query": "SELECT ..."}}
- Usá siempre WITH(NOLOCK) en las tablas para no bloquear la base.
- Limitá los resultados a máximo 50 filas con TOP 50 si no se pide un número específico.
- Para fechas usá FCRMVH_FCHMOV con BETWEEN o >= y <=.
- Formateá totales con CAST(... AS DECIMAL(18,2)).
- Si la pregunta incluye un período, aplicalo siempre al filtro de fechas.
- Si no podés generar una consulta válida, devolvé: {{"sql_query": null, "error": "motivo"}}
"""
    msg = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        system=system_prompt,
        messages=[{"role": "user", "content": human_query}],
    )
    return msg.content[0].text.strip()


async def build_answer(rows: list[dict], human_query: str) -> str:
    system_prompt = f"""Sos un analista de ventas senior de Oliver Cooks (aceite de oliva extra virgen, Mendoza, Argentina).

Tu tarea es interpretar los resultados de una consulta SQL y redactar una respuesta clara, estructurada y formal para el equipo comercial.

REGLAS:
- Respondé en español, de forma directa y que seas como un chat al estilo chatgpt/claude, que realiza una conversacion abierta.
- Usá **negritas** para destacar cifras y datos clave.
- Si hay múltiples resultados, presentalos como lista con guiones (- item).
- Formateá los valores monetarios con el símbolo $ y separador de miles.
- Máximo 5 ítems en listas; si hay más, agrupá o resumí.
- Incluí una conclusión breve al final si el resultado lo amerita.
- Si el resultado está vacío, informalo claramente.
"""
    rows_text = json.dumps(rows, ensure_ascii=False, default=str, indent=2)
    user_msg = f"Pregunta del usuario: {human_query}\n\nResultados SQL:\n{rows_text}"

    msg = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=800,
        system=system_prompt,
        messages=[{"role": "user", "content": user_msg}],
    )
    return msg.content[0].text.strip()


# ── Modelos de request/response ─────────────────────────────
class HumanQueryPayload(BaseModel):
    human_query: str


# ── Endpoint principal ───────────────────────────────────────
@app.post("/human_query")
async def human_query(payload: HumanQueryPayload):
    logger.info(f"Consulta recibida: {payload.human_query[:80]}")

    # 1. Convertir pregunta → SQL
    sql_raw = await human_query_to_sql(payload.human_query)
    logger.info(f"SQL generado: {sql_raw[:120]}")

    try:
        parsed = json.loads(sql_raw.strip().strip("```json").strip("```").strip())
    except Exception:
        return {"answer": "No pude interpretar la pregunta como una consulta de base de datos. Por favor reformulá tu pregunta."}

    if not parsed.get("sql_query"):
        reason = parsed.get("error", "consulta no válida")
        return {"answer": f"No pude generar una consulta para esa pregunta: {reason}. Intentá reformularla."}

    # 2. Ejecutar SQL
    try:
        rows = run_query(parsed["sql_query"])
    except Exception as e:
        logger.error(f"Error SQL: {e}")
        return {"answer": f"Hubo un error al consultar la base de datos. Intentá reformular la pregunta o verificá que el período sea válido."}

    # 3. Construir respuesta en lenguaje natural
    answer = await build_answer(rows, payload.human_query)
    return {"answer": answer}


@app.get("/health")
def health():
    try:
        conn = get_connection()
        conn.close()
        return {"status": "ok", "db": "DIBIAG@ServerSQL2022"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
