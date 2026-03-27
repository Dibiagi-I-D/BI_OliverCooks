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
   POST /human-query — Chat IA sobre ventas
   Flujo: pregunta → datos del endpoint REST → análisis Claude
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

    // 2. Analizar los datos con Claude
    const answerMsg = await anthropic.messages.create({
      model:      'claude-3-5-haiku-20241022',
      max_tokens: 900,
      system: `Sos un analista de ventas senior de Oliver Cooks (aceite de oliva extra virgen, Mendoza, Argentina).
Recibís registros de ventas del sistema y respondés preguntas del equipo comercial de forma clara, estructurada y formal.

Campos disponibles en cada registro:
FechaMovimiento, NombreCliente, NombreProducto, CodigoProducto,
Cantidad, Precio, TotalLinea (monto en ARS),
NombreDeposito, NombreSector, Sucursal, NombreUsuario.

REGLAS:
- Respondé en español, directo, sin saludar ni repetir la pregunta.
- Usá **negritas** para cifras y datos clave.
- Listas con guiones (- item) cuando hay múltiples resultados; máximo 8 ítems, luego resumí.
- Valores monetarios con $ y separador de miles (ej: $1.250.000).
- Incluí una conclusión breve si el análisis lo amerita.
- Si los datos no permiten responder, indicalo claramente.`,
      messages: [{
        role: 'user',
        content: `Período: ${startDate} al ${endDate}. Total de registros: ${rows.length}.
Pregunta: ${human_query}

Datos de ventas:
${JSON.stringify(rows.slice(0, 800), null, 0)}`,
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
    const SYSTEM = `Eres un analista de ventas senior de Oliver Cooks, empresa mendocina de aceite de oliva extra virgen de alta gama.
Tu tarea es interpretar datos de ventas y entregar conclusiones claras, estructuradas y formales para el equipo comercial.

REGLAS ESTRICTAS:
- Respondé ÚNICAMENTE con un objeto JSON válido, sin markdown, sin texto adicional.
- Formato exacto: {"observacion":"...","accion":"..."}
- "observacion": una oración clara que explique qué revelan los datos (tendencia, pico, caída, concentración, etc.).
- "accion": una oración concreta con qué hacer o qué tener en cuenta a partir de esos datos.
- Lenguaje formal, directo, sin tecnicismos, sin saludos.`;

    const msg = await anthropic.messages.create({
      model:      'claude-3-5-haiku-20241022',
      max_tokens: 300,
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
    await (await getPool()).request().query('SELECT 1');
    res.json({ status: 'ok', server: DB_CONFIG.server, database: DB_CONFIG.database, time: new Date() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

/* ============================================================
   START
============================================================ */
app.listen(PORT, () => {
  console.log(`\n🍳  Oliver Cooks Backend → puerto ${PORT}`);
});
