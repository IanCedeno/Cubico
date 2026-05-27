/**
 * config.js — Netlify Function: expone las credenciales públicas de Supabase al frontend.
 *
 * POR QUÉ EXISTE:
 *   Las claves de Supabase son "anon keys" (públicas), pero no deben estar en el HTML
 *   estático porque Netlify escanea el bundle en busca de secretos y puede rechazar el deploy.
 *   En lugar de exponerlas en el código fuente, se guardan como variables de entorno en Netlify
 *   y se sirven en tiempo de ejecución desde esta función.
 *
 * SEGURIDAD:
 *   Solo responde a orígenes permitidos (CUBICO_ALLOWED_ORIGINS). Peticiones de orígenes
 *   desconocidos reciben 403. Peticiones sin cabecera Origin (same-origin) siempre pasan.
 *   Cache-Control: no-store evita que CDNs guarden las claves.
 *
 * VARIABLES DE ENTORNO REQUERIDAS (configurar en Netlify → Site settings → Environment variables):
 *   SUPABASE_URL          — URL de tu proyecto Supabase (ej. https://xxxx.supabase.co)
 *   SUPABASE_ANON_KEY     — Clave pública anon de Supabase
 *   CUBICO_ALLOWED_ORIGINS — Lista separada por comas de dominios permitidos
 *                            (default: "cubico.com.pa,netlify.app,localhost")
 *
 * RESPUESTA:
 *   200 { SUPABASE_URL, SUPABASE_ANON_KEY }
 *   403 { error: 'Forbidden' }        — origen no permitido
 */

const ALLOWED_ORIGINS = (process.env.CUBICO_ALLOWED_ORIGINS || 'cubico.com.pa,netlify.app,localhost')
  .split(',').map(o => o.trim()).filter(Boolean);

/**
 * Verifica que el origen de la petición esté en la lista blanca.
 * Los navegadores omiten la cabecera Origin en peticiones same-origin, por lo que
 * la ausencia de Origin se trata como petición legítima.
 *
 * @param {object} headers — cabeceras HTTP de la petición (event.headers)
 * @returns {boolean}
 */
function isAllowedOrigin(headers) {
  const origin = headers['origin'] || headers['referer'] || '';
  if (!origin) return true; // same-origin browser request omits Origin
  return ALLOWED_ORIGINS.some(allowed => origin.includes(allowed));
}

exports.handler = async function (event) {
  if (!isAllowedOrigin(event.headers)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({
      SUPABASE_URL: process.env.SUPABASE_URL || '',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || ''
    })
  };
};
