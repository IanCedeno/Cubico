/**
 * admin-delete-user.js — Netlify Function: elimina un usuario de auth.users.
 *
 * Usa la REST API de Supabase directamente (sin SDK) para evitar
 * dependencias de npm. Requiere SUPABASE_SERVICE_ROLE_KEY.
 *
 * VARIABLES DE ENTORNO REQUERIDAS:
 *   SUPABASE_URL              — URL del proyecto Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — Clave de servicio (Settings → API → service_role)
 *
 * BODY (JSON, POST):
 *   userId  — UUID del usuario a eliminar
 *   token   — JWT de sesión del admin que hace la petición
 */

const ALLOWED_ORIGINS = (process.env.CUBICO_ALLOWED_ORIGINS || 'cubico.com.pa,netlify.app,localhost')
  .split(',').map(o => o.trim()).filter(Boolean);

function isAllowedOrigin(headers) {
  const origin = headers['origin'] || headers['referer'] || '';
  if (!origin) return true;
  return ALLOWED_ORIGINS.some(allowed => origin.includes(allowed));
}

exports.handler = async function (event) {
  if (!isAllowedOrigin(event.headers)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let userId, token;
  try {
    ({ userId, token } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  if (!userId || !token) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan userId o token' }) };
  }

  const supaUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Configuración de servidor incompleta' }) };
  }

  // 1. Verificar que el token pertenece a un usuario válido
  const userRes = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: serviceKey }
  });
  if (!userRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Token inválido' }) };
  }
  const { id: requesterId } = await userRes.json();

  // 2. Verificar que ese usuario es admin consultando profiles
  const profileRes = await fetch(
    `${supaUrl}/rest/v1/profiles?id=eq.${requesterId}&select=role&limit=1`,
    { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
  );
  const profiles = await profileRes.json();
  if (!Array.isArray(profiles) || profiles[0]?.role !== 'admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Solo administradores pueden eliminar usuarios' }) };
  }

  // 3. No permitir auto-eliminación
  if (userId === requesterId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No puedes eliminar tu propia cuenta' }) };
  }

  // 4. Eliminar usuario de auth.users (cascada a profiles y packages)
  const deleteRes = await fetch(`${supaUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey }
  });

  if (!deleteRes.ok) {
    const err = await deleteRes.json().catch(() => ({}));
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Error al eliminar usuario' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ ok: true })
  };
};
