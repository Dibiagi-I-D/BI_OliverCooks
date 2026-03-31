const express    = require('express');
const cors       = require('cors');
const sql        = require('mssql');
const https      = require('https');
const Anthropic  = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXT_API_BASE = 'https://apirest-dibiagi.onrender.com';
const EXT_API_KEY  = 'db_dibia_MkI5YVBYZzRRbmx0WTJKM09UVTFNRmhaTmxjdw==';

function fetchVentas(startDate, endDate, limit = 2000) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ startDate, endDate, page: 1, limit });
    const url    = `${EXT_API_BASE}/oliver-cooks/visualizacion-ventas?${params}`;
    const req = https.get(url, {
      headers: { 'Authorization': `Bearer ${EXT_API_KEY}` },
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Respuesta inválida del API')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

const DB_CONFIG = {
  server:   'ServerSQL2022',
  database: 'DIBIAG',
  user:     'sa',
  password: 'Password1!',
  port:     1433,
  options: {
    encrypt:                false,
    trustServerCertificate: true,
    enableArithAbort:       true,
    requestTimeout:         60000,
    connectionTimeout:      30000,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let pool;
async function getPool() {
  if (!pool) {
    pool = await sql.connect(DB_CONFIG);
    console.log('✅ Conectado a SQL Server:', DB_CONFIG.server, '/', DB_CONFIG.database);
  }
  return pool;
}

/* ============================================================
   GET /oliver-cooks/visualizacion-ventas
============================================================ */
app.get('/oliver-cooks/visualizacion-ventas', async (req, res) => {
  try {
    const page      = Math.max(1, parseInt(req.query.page  || '1'));
    const limit     = Math.min(2000, Math.max(1, parseInt(req.query.limit || '50')));
    const offset    = (page - 1) * limit;
    const startDate = req.query.startDate || null;
    const endDate   = req.query.endDate   || null;

    let dateFilter = '';
    if (startDate) dateFilter += ` AND h.FCRMVH_FCHMOV >= @startDate`;
    if (endDate)   dateFilter += ` AND h.FCRMVH_FCHMOV <= @endDate`;

    const baseFrom = `
      FROM dbo.FCRMVH h WITH(NOLOCK)
      INNER JOIN dbo.FCRMVI i WITH(NOLOCK) ON
          h.FCRMVH_CODEMP = i.FCRMVI_CODEMP AND
          h.FCRMVH_MODFOR = i.FCRMVI_MODFOR AND
          h.FCRMVH_CODFOR = i.FCRMVI_CODFOR AND
          h.FCRMVH_NROFOR = i.FCRMVI_NROFOR
      LEFT JOIN dbo.VTMCLH c WITH(NOLOCK) ON
          h.FCRMVH_NROCTA = c.VTMCLH_NROCTA AND
          h.FCRMVH_NROSUB = c.VTMCLH_NROSUB
          
      LEFT JOIN dbo.STTDEH d WITH(NOLOCK) ON
          i.FCRMVI_DEPOSI = d.STTDEH_DEPOSI
      LEFT JOIN dbo.STTDEI s WITH(NOLOCK) ON
          i.FCRMVI_DEPOSI = s.STTDEI_DEPOSI AND
          i.FCRMVI_SECTOR = s.STTDEI_SECTOR
      LEFT JOIN dbo.STMPDH art WITH(NOLOCK) ON
          art.STMPDH_TIPPRO = 'GI    ' AND
          TRY_CAST(LTRIM(art.STMPDH_ARTCOD) AS INT) = TRY_CAST(LTRIM(i.FCRMVI_ARTCOD) AS INT)
      WHERE h.FCRMVH_CODFOR = 'FA0019'
        AND i.FCRMVI_TIPPRO = 'PRODTE'
        AND i.FCRMVI_CANTID > 0
        ${dateFilter}
    `;

    const dataQuery = `
      SELECT
          h.FCRMVH_CODEMP  AS CodigoEmpresa,
          h.FCRMVH_MODFOR  AS ModuloFormulario,
          h.FCRMVH_CODFOR  AS CodigoFormulario,
          h.FCRMVH_NROFOR  AS NumeroFormulario,
          h.FCRMVH_SUCURS  AS Sucursal,
          h.FCRMVH_FCHMOV  AS FechaMovimiento,
          h.FCRMVH_NROCTA  AS NumeroCuenta,
          h.FCRMVH_NROSUB  AS NumeroSubcuenta,
          c.VTMCLH_NOMBRE  AS NombreCliente,
          i.FCRMVI_DEPOSI  AS CodigoDeposito,
          d.STTDEH_DESCRP  AS NombreDeposito,
          i.FCRMVI_SECTOR  AS CodigoSector,
          s.STTDEI_DESCRP  AS NombreSector,
          h.FCRMVH_FECALT  AS FechaAlta,
          h.FCRMVH_ULTOPR  AS UltimoProceso,
          h.FCRMVH_USERID  AS NombreUsuario,
          RTRIM(i.FCRMVI_ARTCOD)  AS CodigoProducto,
          COALESCE(art.STMPDH_DESCRP, 'Producto ' + RTRIM(i.FCRMVI_ARTCOD)) AS NombreProducto,
          i.FCRMVI_NROITM  AS NumeroItem,
          i.FCRMVI_CANTID  AS Cantidad,
          i.FCRMVI_PRECIO  AS Precio,
          CAST(
              CASE i.FCRMVI_TOTLIN
                  WHEN 0 THEN i.FCRMVI_CANTID * i.FCRMVI_PRECIO
                  ELSE i.FCRMVI_TOTLIN
              END
          AS DECIMAL(18,2)) AS TotalLinea,
          i.FCRMVI_PRESEC  AS PrecioSecundario,
          h.FCRMVH_CAMSEC  AS CambioSecundario,
          i.FCRMVI_TEXTOS  AS ObservacionesItem
      ${baseFrom}
      ORDER BY h.FCRMVH_FECALT DESC, i.FCRMVI_NROITM ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

    const countQuery = `SELECT COUNT(*) AS total ${baseFrom}`;

    const db = await getPool();
    const req1 = db.request().input('offset', sql.Int, offset).input('limit', sql.Int, limit);
    if (startDate) req1.input('startDate', sql.Date, new Date(startDate));
    if (endDate)   req1.input('endDate',   sql.Date, new Date(endDate));

    const req2 = db.request();
    if (startDate) req2.input('startDate', sql.Date, new Date(startDate));
    if (endDate)   req2.input('endDate',   sql.Date, new Date(endDate));

    const [dataRes, countRes] = await Promise.all([
      req1.query(dataQuery),
      req2.query(countQuery).catch(() => ({ recordset: [{ total: 0 }] })),
    ]);

    res.json({
      status: 'exito',
      data:   dataRes.recordset,
      pagination: { page, limit, count: countRes.recordset[0]?.total ?? 0 },
    });

  } catch (err) {
    console.error('❌ Query error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

/* ============================================================
   Agrega todos los registros en resúmenes completos para el chatbot
============================================================ */
function agregarDatosParaChat(rows) {
  const agg = (map, key, linea, cant) => {
    if (!map[key]) map[key] = { totalARS: 0, cantidad: 0 };
    map[key].totalARS  += linea || 0;
    map[key].cantidad  += cant  || 0;
  };

  const porCliente  = {};
  const porProducto = {};
  const porFecha    = {};
  const porDeposito = {};
  const porSector   = {};
  const porUsuario  = {};
  const facturas    = new Set();
  let   totalGeneral = 0;

  for (const r of rows) {
    const linea = parseFloat(r.TotalLinea) || 0;
    const cant  = parseFloat(r.Cantidad)   || 0;
    totalGeneral += linea;
    if (r.NumeroFormulario) facturas.add(r.NumeroFormulario);
    agg(porCliente,  r.NombreCliente  || 'Sin cliente',  linea, cant);
    agg(porProducto, r.NombreProducto || 'Sin producto', linea, cant);
    agg(porDeposito, r.NombreDeposito || 'Sin depósito', linea, cant);
    agg(porSector,   r.NombreSector   || 'Sin sector',   linea, cant);
    agg(porUsuario,  r.NombreUsuario  || 'Sin usuario',  linea, cant);
    const fecha = r.FechaMovimiento ? String(r.FechaMovimiento).slice(0, 10) : 'Sin fecha';
    agg(porFecha, fecha, linea, cant);
  }

  const ordenar = obj => Object.entries(obj)
    .map(([k, v]) => ({ nombre: k, totalARS: Math.round(v.totalARS), cantidad: v.cantidad }))
    .sort((a, b) => b.totalARS - a.totalARS);

  return {
    resumenGeneral: {
      totalVentasARS:    Math.round(totalGeneral),
      cantidadRegistros: rows.length,
      cantidadFacturas:  facturas.size,
      cantidadClientes:  Object.keys(porCliente).length,
      cantidadProductos: Object.keys(porProducto).length,
    },
    porCliente:  ordenar(porCliente),
    porProducto: ordenar(porProducto),
    porFecha:    Object.entries(porFecha)
                   .map(([fecha, v]) => ({ fecha, totalARS: Math.round(v.totalARS), cantidad: v.cantidad }))
                   .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    porDeposito: ordenar(porDeposito),
    porSector:   ordenar(porSector),
    porUsuario:  ordenar(porUsuario),
  };
}

/* ============================================================
   POST /human-query — Chat IA sobre ventas
   Flujo: pregunta → TODOS los datos del endpoint → análisis Claude
============================================================ */
app.post('/human-query', async (req, res) => {
  const { human_query, from: startDate, to: endDate } = req.body;
  if (!human_query || !startDate || !endDate) {
    return res.status(400).json({ answer: 'Faltan parámetros: human_query, from, to.' });
  }

  try {
    // 1. Obtener datos del endpoint REST externo
    let apiData;
    try {
      apiData = await fetchVentas(startDate, endDate);
    } catch (fetchErr) {
      console.error('❌ API fetch error:', fetchErr.message);
      return res.json({ answer: 'No se pudo obtener datos del servidor de ventas. Verificá la conexión e intentá de nuevo.' });
    }

    if (apiData.status !== 'exito' || !Array.isArray(apiData.data)) {
      return res.json({ answer: 'El servidor de datos no devolvió resultados válidos para el período indicado.' });
    }

    const rows = apiData.data;
    if (rows.length === 0) {
      return res.json({ answer: `No se encontraron ventas entre el **${startDate}** y el **${endDate}**.` });
    }

    // 2. Pre-agregar TODOS los registros (sin límite) para no perder datos
    const datos = agregarDatosParaChat(rows);

    // Calcular métricas del período para darle contexto temporal completo a Claude
    const msPerDay    = 1000 * 60 * 60 * 24;
    const diasPeriodo = Math.round((new Date(endDate) - new Date(startDate)) / msPerDay) + 1;
    const promedioARS = diasPeriodo > 0 ? Math.round(datos.resumenGeneral.totalVentasARS / diasPeriodo) : 0;

    const datosFinal = {
      periodo: {
        desde:          startDate,
        hasta:          endDate,
        diasTotales:    diasPeriodo,
        promedioVentaDiariaARS: promedioARS,
      },
      ...datos,
    };

    // 3. Analizar con Claude usando los datos completos agregados
    const answerMsg = await anthropic.messages.create({
      model:      'claude-3-haiku-20240307',
      max_tokens: 1200,
      system: `Sos un analista de ventas senior de Oliver Cooks, empresa productora de aceite de oliva extra virgen premium en La Celina, Mendoza, Argentina. Respondés preguntas del equipo comercial y directivo analizando datos reales de ventas extraídos del sistema de gestión interno (ERP). Tus respuestas son leídas por el equipo para tomar decisiones de negocio.

MONEDA — REGLA ABSOLUTA:
Todos los valores monetarios están en PESOS ARGENTINOS (ARS). Nunca menciones dólares. Los campos Precio, TotalLinea y PrecioSecundario son todos en pesos argentinos. El campo CambioSecundario es un tipo de cambio interno del ERP y no significa que los precios estén en otra moneda.

QUÉ SIGNIFICAN LOS DATOS QUE RECIBÍS:
Recibís un JSON con el resumen COMPLETO y pre-calculado de TODAS las ventas del período seleccionado. No es una muestra: son todos los registros del rango de fechas elegido.

- periodo.desde / periodo.hasta: rango de fechas exacto que el usuario seleccionó en la aplicación
- periodo.diasTotales: cantidad de días que abarca el período (incluye ambos extremos)
- periodo.promedioVentaDiariaARS: promedio de ventas por día en pesos argentinos durante el período
- resumenGeneral.totalVentasARS: suma total de todas las ventas del período en pesos argentinos
- resumenGeneral.cantidadRegistros: total de líneas de venta (una factura puede tener varias líneas/productos)
- resumenGeneral.cantidadFacturas: cantidad de facturas únicas emitidas en el período
- resumenGeneral.cantidadClientes: cantidad de clientes distintos que compraron en el período
- resumenGeneral.cantidadProductos: cantidad de productos distintos vendidos en el período
- porCliente: lista completa de clientes con sus ventas totales en ARS y unidades, ordenados de mayor a menor
- porProducto: lista completa de productos con ventas totales en ARS y unidades, ordenados de mayor a menor
- porFecha: ventas día a día en ARS y unidades, ordenado cronológicamente dentro del período elegido
- porDeposito: ventas por depósito/almacén desde donde se despacharon los productos
- porSector: ventas por sector dentro de cada depósito
- porUsuario: ventas registradas por cada usuario/vendedor del sistema en el período

REGLAS DE RESPUESTA:
- Siempre contextualizá la respuesta dentro del período seleccionado (mencionar las fechas cuando sea relevante).
- Respondé en español, directo al punto, sin saludar ni repetir la pregunta.
- Usá **negritas** para cifras, nombres de clientes, productos y datos clave.
- Listas con guiones cuando hay múltiples resultados; incluí todos los relevantes sin cortar arbitrariamente.
- Valores monetarios siempre con $ y separador de miles con punto (ej: $1.250.000).
- Si calculás porcentajes, mostralos con un decimal (ej: 34,5%).
- Cuando sea útil, usá el promedio diario del período para dar contexto de ritmo de ventas.
- Respuestas completas: si preguntan por todos los clientes, listá todos. Si preguntan por el top 5, listá exactamente 5.
- Incluí una conclusión breve cuando el análisis lo amerite.
- Si los datos no permiten responder la pregunta, indicalo claramente sin inventar nada.`,
      messages: [{
        role: 'user',
        content: `Pregunta: ${human_query}

Datos completos de ventas:
${JSON.stringify(datosFinal, null, 0)}`,
      }],
    });

    res.json({ answer: answerMsg.content[0].text.trim() });

  } catch (err) {
    console.error('❌ human-query error:', err.message);
    res.status(500).json({ answer: 'Error interno. Intentá de nuevo.' });
  }
});

/* ============================================================
   POST /ai-insight — Análisis IA con Claude
============================================================ */
app.post('/ai-insight', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Falta el campo prompt' });

  try {
    const SYSTEM = `Eres un analista de ventas senior especializado en la industria del aceite de oliva extra virgen premium. Trabajás para Oliver Cooks, empresa ubicada en La Celina, Mendoza, Argentina. Tu análisis es leído directamente por el equipo directivo y comercial para tomar decisiones de negocio.

Tu tarea es analizar los datos de un gráfico de ventas de forma exhaustiva, profesional y constructiva. El análisis debe ser largo, completo y verdaderamente útil.

ESTRUCTURA OBLIGATORIA — respondé ÚNICAMENTE con este JSON válido, sin markdown, sin texto fuera del JSON:
{
  "resumen": "Párrafo de 3 a 5 oraciones explicando qué muestra el gráfico en su conjunto, cuál es el comportamiento general, qué llama la atención a primera vista y cuál es el contexto de estos datos para el negocio.",
  "items": [
    {"label": "nombre del ítem", "detalle": "Análisis completo de ese ítem: cifras exactas, comparación con otros, tendencia, participación porcentual si aplica, y cualquier anomalía o punto destacable. Mínimo 2 oraciones por ítem."}
  ],
  "tendencia": "Párrafo de 2 a 3 oraciones describiendo la tendencia general del período: si crece, cae, es estable, qué ciclos o patrones se observan, qué factores podrían explicarlo.",
  "sugerencias": [
    "Sugerencia concreta y accionable 1 basada en los datos",
    "Sugerencia concreta y accionable 2",
    "Sugerencia concreta y accionable 3"
  ]
}

REGLAS:
- Analizá TODOS los ítems del gráfico, no omitás ninguno.
- Usá los números exactos que te dan. Calculá porcentajes, diferencias y proporciones cuando sea útil.
- Las sugerencias deben ser específicas para Oliver Cooks: referí productos reales, clientes reales o patrones reales de los datos.
- Lenguaje formal, profesional, sin tecnicismos innecesarios. Sin saludos ni despedidas.
- El análisis debe ser lo suficientemente completo como para que alguien que no vio el gráfico entienda exactamente qué está pasando.`;

    const msg = await anthropic.messages.create({
      model:      'claude-3-haiku-20240307',
      max_tokens: 1800,
      system:     SYSTEM,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0]?.text ?? '';
    res.json({ text });
  } catch (err) {
    console.error('❌ AI insight error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   GET /health
============================================================ */
app.get('/health', async (req, res) => {
  try {
    res.json({ status: 'ok', time: new Date() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

/* ============================================================
   POST /chat-query — Consultor IA con contexto pre-procesado
============================================================ */
app.post('/chat-query', async (req, res) => {
  const { question, context, period } = req.body;
  if (!question || !context) return res.status(400).json({ error: 'Faltan parámetros' });
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-3-haiku-20240307',
      max_tokens: 1000,
      system: `Sos el consultor de ventas de Oliver Cooks, empresa productora de aceite de oliva extra virgen premium en La Celina, Mendoza, Argentina. Respondés preguntas del equipo comercial sobre datos reales de ventas de forma clara, precisa y profesional.

MONEDA — REGLA ABSOLUTA:
Todos los valores monetarios son en PESOS ARGENTINOS (ARS). Nunca menciones dólares ni otras monedas. Si ves campos como Precio, TotalLinea o PrecioSecundario, son todos en pesos argentinos.

QUÉ SIGNIFICAN LOS DATOS:
Los datos que recibís son totales pre-calculados sobre la totalidad de las ventas del período, agrupados por distintas dimensiones como cliente, producto, fecha, depósito, sector y usuario/vendedor. Son datos reales del sistema de gestión de Oliver Cooks, no muestras parciales.

REGLAS DE RESPUESTA:
- Respondé en español directo, sin saludar ni repetir la pregunta
- Usá **negritas** para cifras, clientes, productos y datos clave
- Listas con guiones cuando hay múltiples resultados; incluí todos los relevantes sin cortar arbitrariamente
- Valores monetarios con $ y separador de miles con punto (ej: $1.250.000)
- Porcentajes con un decimal (ej: 34,5%)
- Conclusión breve si aporta valor
- Si los datos no alcanzan para responder, indicalo claramente sin inventar`,
      messages: [{ role: 'user', content: `Período: ${period}\nPregunta: ${question}\n\nDatos de ventas:\n${context}` }],
    });
    res.json({ answer: msg.content[0].text.trim() });
  } catch (err) {
    console.error('❌ chat-query:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   POST /rfm-analysis — Segmentación de clientes con Claude
============================================================ */
app.post('/rfm-analysis', async (req, res) => {
  const { segments } = req.body;
  if (!segments) return res.status(400).json({ error: 'Falta segments' });
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-3-haiku-20240307',
      max_tokens: 1000,
      system: `Sos analista de ventas senior de Oliver Cooks (aceite de oliva extra virgen, Mendoza, Argentina). Analizás segmentación RFM de clientes y generás estrategias accionables para cada segmento.
Respondé ÚNICAMENTE con JSON válido sin markdown:
{"resumen":"Diagnóstico de 2-3 oraciones sobre la salud general de la cartera","acciones":[{"segmento":"nombre","clientes":N,"accion":"Acción concreta y específica para Oliver Cooks"}],"alerta":"Urgencia si existe (ej: muchos clientes en riesgo), sino string vacío","oportunidad":"Mayor oportunidad de crecimiento detectada en la cartera"}`,
      messages: [{ role: 'user', content: `Segmentación RFM Oliver Cooks:\n${JSON.stringify(segments, null, 2)}` }],
    });
    res.json({ text: msg.content[0]?.text ?? '' });
  } catch (err) {
    console.error('❌ RFM:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   POST /anomaly-detection — Detección de anomalías con Claude
============================================================ */
app.post('/anomaly-detection', async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'Falta data' });
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-3-haiku-20240307',
      max_tokens: 700,
      system: `Sos analista de ventas de Oliver Cooks. Detectás anomalías en datos de ventas diarias y explicás qué pudo haberlas causado.
Respondé ÚNICAMENTE con JSON válido sin markdown:
{"anomalias":[{"tipo":"pico|caida|patron","descripcion":"Descripción breve y clara","severidad":"alta|media|baja","sugerencia":"Qué hacer al respecto"}],"hay_alertas":true}
Si no hay anomalías significativas: {"anomalias":[],"hay_alertas":false}`,
      messages: [{ role: 'user', content: `Datos para análisis de anomalías:\n${JSON.stringify(data, null, 2)}` }],
    });
    res.json({ text: msg.content[0]?.text ?? '' });
  } catch (err) {
    console.error('❌ Anomaly:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   POST /drill-down — Análisis profundo de un punto de datos
============================================================ */
app.post('/drill-down', async (req, res) => {
  const { tipo, valor, contexto } = req.body;
  if (!tipo || !valor) return res.status(400).json({ error: 'Faltan parámetros' });
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-3-haiku-20240307',
      max_tokens: 900,
      system: `Sos analista senior de Oliver Cooks (aceite de oliva extra virgen, Mendoza, Argentina). Cuando el usuario hace click en un punto de un gráfico, analizás en detalle qué ocurrió en ese momento específico y por qué, basándote en los datos del contexto. Respondé en español, directo y estructurado. Usá **negritas** para cifras y nombres clave. Máximo 8 líneas claras. Sin saludos ni despedidas.`,
      messages: [{ role: 'user', content: `Tipo de análisis: ${tipo}\nValor/período: ${valor}\nContexto: ${JSON.stringify(contexto)}` }],
    });
    res.json({ text: msg.content[0]?.text ?? '' });
  } catch (err) {
    console.error('❌ DrillDown:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   START
============================================================ */
app.listen(PORT, () => {
  console.log(`\n🍳  Oliver Cooks Backend → puerto ${PORT}`);
});
