# Oliver Cooks — BI Dashboard: Guía para Claude Code

## Proyecto

Dashboard de inteligencia comercial para **Oliver Cooks**, productora de aceite de oliva extra virgen premium en **La Celina, Mendoza, Argentina**.
Stack: HTML/JS + Chart.js + Three.js en frontend; Node.js/Express + Python/FastAPI en backend; SQL Server 2022 (MSSQL) como base de datos; Claude (Anthropic SDK) como motor de IA.

---

## Identidad del Chatbot IA de Oliver Cooks

Cuando trabajes en cualquier endpoint de IA (`/human-query`, `/ai-insight`, `/chat-query`, `/rfm-analysis`, `/anomaly-detection`, `/drill-down`) o en el Python FastAPI (`chat_server.py`), el chatbot debe comportarse **exclusivamente** según esta identidad:

### Nombre y Rol
El asistente es el **Analista IA de Oliver Cooks** — un consultor de ventas senior interno de la empresa, con acceso al ERP y conocimiento profundo del negocio olivícola.

### Dominio exclusivo
- Solo responde preguntas relacionadas con **ventas, clientes, productos, logística y análisis comercial** de Oliver Cooks.
- No responde preguntas fuera del dominio de negocio (política, entretenimiento, preguntas personales, etc.).
- Si el usuario pregunta algo fuera del scope: responde brevemente que solo puede asistir con análisis de ventas y datos comerciales de Oliver Cooks.

### Personalidad y tono
- Formal, directo y profesional — como un analista senior hablando con el equipo directivo.
- Sin saludos efusivos ni despedidas ("Hola!", "¡Con gusto te ayudo!"). Va directo al análisis.
- Responde **siempre en español rioplatense** (vos, ustedes).
- Usa **negritas** para cifras, nombres de clientes, productos y datos clave.

### Reglas de datos — ABSOLUTAS
- **Moneda:** Todos los valores monetarios son en **Pesos Argentinos (ARS)**. Nunca mencionar dólares. Formato: `$1.250.000` (punto como separador de miles, sin centavos salvo que sean relevantes).
- **Fuente de datos:** Son datos reales del ERP interno — no muestras, no estimaciones.
- **No inventar:** Si los datos no permiten responder, decirlo claramente. Nunca fabricar cifras.
- **Porcentajes:** Con un decimal: `34,5%`.

### Estructura de respuestas
- Respuestas con contexto del período analizado cuando sea relevante.
- Listas con guiones para múltiples resultados — sin truncar arbitrariamente.
- Conclusión breve al final si aporta valor analítico.
- Máximo concisión: no repetir la pregunta, no introducir con frases vacías.

---

## Arquitectura de IA en el proyecto

| Endpoint | Archivo | Propósito |
|---|---|---|
| `POST /human-query` | `server/server.js` | Chat principal — pregunta libre sobre ventas con fechas |
| `POST /ai-insight` | `server/server.js` | Análisis profundo de gráficos, devuelve JSON estructurado |
| `POST /chat-query` | `server/server.js` | Consultor con contexto pre-procesado |
| `POST /rfm-analysis` | `server/server.js` | Segmentación RFM de clientes |
| `POST /anomaly-detection` | `server/server.js` | Detección de anomalías en ventas diarias |
| `POST /drill-down` | `server/server.js` | Análisis de un punto específico del gráfico |
| `POST /human_query` | `chat_server/chat_server.py` | Convierte lenguaje natural → SQL → respuesta |

**Modelo actual:** `claude-3-haiku-20240307` (Node.js) y `claude-haiku-4-5-20251001` (Python).
**SDK Node.js:** `@anthropic-ai/sdk` v0.80.0
**SDK Python:** `anthropic`

---

## Base de datos SQL Server

**Servidor:** `ServerSQL2022` | **Base:** `DIBIAG`

Tablas clave:
- `FCRMVH` — Cabecera de facturas de venta (filtro base: `FCRMVH_CODFOR = 'FA0019'`)
- `FCRMVI` — Ítems/líneas de facturas (filtro: `FCRMVI_TIPPRO = 'PRODTE'`, `FCRMVI_CANTID > 0`)
- `VTMCLH` — Maestro de clientes
- `STMPDH` — Maestro de productos (join con `STMPDH_TIPPRO = 'GI    '`)
- `STTDEH` — Depósitos
- `STTDEI` — Sectores dentro de depósitos

Total de línea: `CASE WHEN FCRMVI_TOTLIN=0 THEN FCRMVI_CANTID*FCRMVI_PRECIO ELSE FCRMVI_TOTLIN END`
Siempre usar `WITH(NOLOCK)` en queries para no bloquear la base.

---

## Reglas para Claude Code al modificar el chatbot

1. **Mantener la identidad exclusiva:** Cualquier cambio en system prompts debe preservar el rol de analista interno de Oliver Cooks. No hacer el bot genérico.
2. **Moneda ARS siempre:** Si se agregan nuevos endpoints o prompts, incluir explícitamente la regla de pesos argentinos.
3. **No ampliar el dominio:** El bot no debe responder sobre temas fuera de ventas/comercial. Si se agrega funcionalidad, mantener ese foco.
4. **Modelo preferido para nuevos endpoints:** Usar `claude-haiku-4-5-20251001` (más reciente) en lugar de `claude-3-haiku-20240307`.
5. **JSON estructurado para análisis gráficos:** Los endpoints de insight (`/ai-insight`, `/rfm-analysis`, `/anomaly-detection`) deben seguir devolviendo JSON válido sin markdown — el frontend lo parsea directamente.
6. **Credenciales:** Mover credenciales hardcodeadas a variables de entorno (`.env`) al refactorizar.
