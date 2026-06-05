/**
 * admin-delete-user.js — Netlify Function: elimina un usuario de auth.users.
 *
 * Requiere la clave de servicio (SUPABASE_SERVICE_ROLE_KEY) para poder
 * eliminar usuarios de auth.users. El perfil y paquetes se eliminan en
 * cascada automáticamente por las FK definidas en la BD.
 *
 * VARIABLES DE ENTORNO REQUERIDAS:
 *   SUPABASE_URL              — URL del proyecto Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — Clave de servicio (Settings → API → service_role)
 *
 * BODY (JSON, POST):
 *   userId  — UUID del usuario a eliminar
 *   token   — JWT de sesión del admin que hace la petición
 */

const { createClient } = require('@supabase/supabase-js');

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

  const supa = createClient(supaUrl, serviceKey);

  // Verificar que el token pertenece a un admin
  const { data: { user }, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Token inválido' }) };
  }
  const { data: adminProfile } = await supa
    .from('profiles').select('role').eq('id', user.id).single();
  if (adminProfile?.role !== 'admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Solo administradores pueden eliminar usuarios' }) };
  }

  // No permitir que el admin se elimine a sí mismo
  if (userId === user.id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No puedes eliminar tu propia cuenta' }) };
  }

  const { error: deleteErr } = await supa.auth.admin.deleteUser(userId);
  if (deleteErr) {
    return { statusCode: 500, body: JSON.stringify({ error: deleteErr.message }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ ok: true })
  };
};
