/**
 * send-welcome.js — Netlify Function: envía el correo de bienvenida tras el registro.
 *
 * SE LLAMA DESDE:
 *   assets/portal.js → initAuthPage() → formulario de registro (fire-and-forget,
 *   no bloquea la redirección al portal del cliente).
 *
 * EMAILS QUE ENVÍA:
 *   1. Al cliente  — confirma la creación del casillero, muestra su código CBC y la
 *                    dirección en Miami con el formato correcto de nombre.
 *   2. Al admin    — resumen con todos los datos del nuevo registro (nombre, correo,
 *                    teléfono, código, dirección, preferencia de entrega).
 *
 * VARIABLES DE ENTORNO REQUERIDAS (Netlify → Site settings → Environment variables):
 *   RESEND_API_KEY        — clave de la API de Resend (obligatoria)
 *   CUBICO_FROM_EMAIL     — remitente (default: "CÚBICO <noreply@cubico.com.pa>")
 *   CUBICO_ADMIN_EMAIL    — destinatario del resumen interno (default: "info@cubico.com.pa")
 *
 * CUERPO DE LA PETICIÓN (JSON, POST):
 *   email               — correo del cliente (requerido)
 *   first_name          — nombre
 *   last_name           — apellido
 *   cbc_code            — código CBC asignado (ej. "CBC-IanCedeno")
 *   phone               — teléfono
 *   address             — zona o dirección en Panamá
 *   delivery_preference — modalidad preferida de entrega
 *
 * RESPUESTA:
 *   200 { ok: true, id }  — emails enviados correctamente
 *   400 { error }         — validación fallida
 *   500 { error }         — falta RESEND_API_KEY
 *   502 { error }         — error al llamar a la API de Resend
 */

const rateMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > 60_000) { rateMap.set(ip, { count: 1, start: now }); return false; }
  if (entry.count >= 3) return true;
  entry.count++;
  rateMap.set(ip, entry);
  return false;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]
  ));
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Demasiadas solicitudes. Intenta más tarde.' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.CUBICO_FROM_EMAIL || 'CÚBICO <noreply@cubico.com.pa>';
  const ADMIN_EMAIL = process.env.CUBICO_ADMIN_EMAIL || 'info@cubico.com.pa';

  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta RESEND_API_KEY en Netlify.' }) };
  }

  let data = {};
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido.' }) };
  }

  const email = String(data.email || '').trim();
  const firstName = String(data.first_name || '').trim();
  const lastName = String(data.last_name || '').trim();
  const cbcCode = String(data.cbc_code || '').trim();
  const phone = String(data.phone || '').trim();
  const address = String(data.address || '').trim();
  const deliveryPreference = String(data.delivery_preference || '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Correo inválido.' }) };
  }
  if (email.length > 200) return { statusCode: 400, body: JSON.stringify({ error: 'Correo demasiado largo.' }) };
  if (firstName.length + lastName.length > 120) return { statusCode: 400, body: JSON.stringify({ error: 'Nombre demasiado largo.' }) };
  if (cbcCode && !/^CBC\d+-[A-Za-z0-9]{1,30}$/.test(cbcCode)) return { statusCode: 400, body: JSON.stringify({ error: 'Código CBC inválido.' }) };

  const fullName = `${firstName} ${lastName}`.trim() || 'Cliente CÚBICO';
  const miamiNameLine = cbcCode ? `${fullName} ${cbcCode}` : fullName;

  const eFullName = escapeHtml(fullName);
  const eCbcCode = escapeHtml(cbcCode);
  const eMiamiLine = escapeHtml(miamiNameLine);

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;padding:24px;color:#111;">
    <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e6e6e6;">
      <div style="background:#050607;color:#ffffff;padding:28px 30px;">
        <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#c9a35b;margin-bottom:10px;">CÚBICO</div>
        <h1 style="margin:0;font-size:28px;line-height:1.15;">Tu casillero fue creado.</h1>
        <p style="margin:12px 0 0;color:#d8d8d8;font-size:15px;">Bienvenido a una forma más clara, elegante y ordenada de mover tus compras.</p>
      </div>
      <div style="padding:28px 30px;">
        <p style="font-size:16px;margin:0 0 18px;">Hola ${eFullName},</p>
        <p style="font-size:15px;line-height:1.65;margin:0 0 18px;">Recibimos tu registro en CÚBICO. Desde ahora puedes utilizar tu dirección en USA para tus compras y dar seguimiento a tus paquetes desde tu cuenta.</p>
        <div style="background:#f7f3ea;border:1px solid #ead9b3;border-radius:14px;padding:18px;margin:22px 0;">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#98743b;margin-bottom:8px;">Código CÚBICO</div>
          <div style="font-size:30px;font-weight:800;letter-spacing:1px;color:#111;">${eCbcCode || 'Pendiente de asignación'}</div>
        </div>
        <h2 style="font-size:18px;margin:22px 0 10px;">Cómo debes colocar tu nombre en tus compras</h2>
        <div style="font-size:16px;font-weight:700;background:#111;color:#fff;border-radius:12px;padding:14px 16px;margin-bottom:18px;">${eMiamiLine}</div>
        <p style="font-size:14px;line-height:1.6;color:#555;margin:0 0 18px;">Cuando tu paquete llegue a Miami, será procesado por nuestro equipo y luego aparecerá en tu cuenta CÚBICO según el flujo operativo.</p>
        <h2 style="font-size:18px;margin:22px 0 10px;">Horario de bodega en Miami</h2>
        <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">Lunes a viernes, de 9:00 a.m. a 5:00 p.m.</p>
        <p style="font-size:15px;line-height:1.6;margin:0;">Si necesitas apoyo, responde este correo o contáctanos desde la web.</p>
      </div>
      <div style="padding:18px 30px;background:#fafafa;color:#777;font-size:12px;line-height:1.5;">
        CÚBICO · Logística · Carga · Soluciones<br>
        Este correo fue generado automáticamente por tu registro.
      </div>
    </div>
  </div>`;

  const text = `Hola ${fullName},\n\nTu casillero CÚBICO fue creado.\nCódigo CÚBICO: ${cbcCode || 'Pendiente de asignación'}\nNombre para tus compras: ${miamiNameLine}\n\nBodega Miami: lunes a viernes, 9:00 a.m. a 5:00 p.m.\n\nCÚBICO`;

  async function sendEmail(payload) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || result.error || 'No se pudo enviar el correo.');
    }
    return result;
  }

  // Notificación al admin: prioritaria, sí bloquea.
  // Con onboarding@resend.dev solo funciona si ADMIN_EMAIL es el correo del dueño de la cuenta Resend.
  try {
    if (ADMIN_EMAIL) {
      await sendEmail({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        subject: `Nuevo registro CÚBICO · ${eFullName}`,
        html: `<div style="font-family:Arial,sans-serif"><h2>Nuevo registro CÚBICO</h2><p><strong>Nombre:</strong> ${eFullName}</p><p><strong>Correo:</strong> ${escapeHtml(email)}</p><p><strong>Teléfono:</strong> ${escapeHtml(phone) || '—'}</p><p><strong>Código:</strong> ${eCbcCode || 'Pendiente'}</p><p><strong>Dirección/Zona:</strong> ${escapeHtml(address) || '—'}</p><p><strong>Preferencia:</strong> ${escapeHtml(deliveryPreference) || '—'}</p></div>`,
        text: `Nuevo registro CÚBICO\nNombre: ${fullName}\nCorreo: ${email}\nTeléfono: ${phone || '—'}\nCódigo: ${cbcCode || 'Pendiente'}\nDirección/Zona: ${address || '—'}\nPreferencia: ${deliveryPreference || '—'}`
      });
    }
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }

  // Bienvenida al cliente: fire-and-forget.
  // Con onboarding@resend.dev solo se puede enviar al correo del dueño de la cuenta.
  // Cuando se configure un dominio propio en Resend, este correo llegará al cliente también.
  sendEmail({
    from: FROM_EMAIL,
    to: [email],
    subject: cbcCode ? `Bienvenido a CÚBICO · Tu código ${cbcCode}` : 'Bienvenido a CÚBICO',
    html,
    text
  }).catch(() => {});

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
