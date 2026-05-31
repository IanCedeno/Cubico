/**
 * tracking.js — Netlify Function: proxy CORS para consultar el estado de paquetes en PTY Freight.
 *
 * POR QUÉ EXISTE:
 *   La API de PTY Freight (ptyfreight.com) no sirve cabeceras CORS que los navegadores acepten.
 *   Esta función actúa como intermediario: el frontend llama a /.netlify/functions/tracking,
 *   el servidor hace el fetch a PTY Freight y devuelve el resultado con las cabeceras CORS correctas.
 *
 * PARÁMETROS DE CONSULTA (query string):
 *   tracking — número de tracking a consultar (requerido; se sanitiza con /[^a-zA-Z0-9\-_]/)
 *   type     — "air" (por defecto) o "ocean"; determina qué endpoint de PTY Freight se usa
 *
 * RESPUESTA EXITOSA (200):
 *   { source: 'ptyfreight', type, tracking_number, data: <respuesta original de PTY Freight> }
 *
 * ERRORES:
 *   400 — tracking no proporcionado
 *   502 — error de red al conectar con PTY Freight
 *   <status PTY Freight> — si PTY Freight devuelve un código de error, se reenvía tal cual
 */
const ALLOWED_ORIGINS = (process.env.CUBICO_ALLOWED_ORIGINS || 'cubico.com.pa,netlify.app,localhost')
  .split(',').map(o => o.trim()).filter(Boolean);

exports.handler = async function(event) {
  const origin = event.headers['origin'] || '';
  const isAllowed = !origin || ALLOWED_ORIGINS.some(o => origin.includes(o));

  const headers = {
    ...(isAllowed ? { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Headers': 'Content-Type' } : {}),
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (event.httpMethod === 'OPTIONS') {
    return isAllowed
      ? { statusCode: 204, headers, body: '' }
      : { statusCode: 403, body: '' };
  }

  if (!isAllowed) {
    return { statusCode: 403, headers, body: JSON.stringify({ status: 'error', message: 'Forbidden' }) };
  }

  const params = event.queryStringParameters || {};
  const rawTracking = (params.tracking || '').trim();
  const type = (params.type || 'air').trim().toLowerCase();

  const tracking = rawTracking.replace(/[^a-zA-Z0-9\-_]/g, '');
  if (!tracking) {
    return { statusCode: 400, headers, body: JSON.stringify({ status: 'error', message: 'Tracking requerido.' }) };
  }

  const endpoint = type === 'ocean'
    ? `https://ptyfreight.com/api/ocean-tracking/${encodeURIComponent(tracking)}`
    : `https://ptyfreight.com/api/tracking/${encodeURIComponent(tracking)}`;

  try {
    const response = await fetch(endpoint, { headers: { 'Accept': 'application/json' } });
    const text = await response.text();

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ status: 'error', message: 'No pudimos consultar el tracking en este momento.' }) };
    }

    let data;
    try { data = JSON.parse(text); }
    catch (e) { data = { status: 'error', message: 'Respuesta inválida del proveedor externo.' }; }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ source: 'ptyfreight', type, tracking_number: tracking, data })
    };
  } catch (error) {
    return { statusCode: 502, headers, body: JSON.stringify({ status: 'error', message: 'Error conectando con el proveedor externo.' }) };
  }
};
