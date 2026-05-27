/**
 * send-lead.js — Netlify Function: procesa el formulario de contacto de la landing page.
 *
 * SE LLAMA DESDE:
 *   assets/portal.js / index.html → formulario "Contáctanos" de la página principal.
 *   El frontend hace fetch POST a /.netlify/functions/send-lead con los datos del formulario.
 *
 * EMAILS QUE ENVÍA:
 *   1. Al admin   — notificación con todos los datos del lead (nombre, correo, teléfono,
 *                   zona, modalidad, mensaje). reply_to apunta al correo del cliente para
 *                   que el admin pueda responder directamente.
 *   2. Al cliente — confirmación de que su solicitud fue recibida.
 *
 * VARIABLES DE ENTORNO REQUERIDAS (Netlify → Site settings → Environment variables):
 *   RESEND_API_KEY        — clave de la API de Resend (obligatoria)
 *   CUBICO_FROM_EMAIL     — remitente (default: "CÚBICO <noreply@cubico.com.pa>")
 *   CUBICO_ADMIN_EMAIL    — destinatario interno (default: "info@cubico.com.pa")
 *
 * CUERPO DE LA PETICIÓN (JSON, POST):
 *   nombre / name               — nombre completo (requerido)
 *   email                       — correo del contacto (requerido)
 *   telefono / phone            — teléfono (opcional)
 *   zona / address              — zona o dirección en Panamá (opcional)
 *   modalidad / delivery_preference — preferencia de entrega (opcional)
 *   mensaje / message           — mensaje adicional (opcional, máx. 2000 chars)
 *
 * RESPUESTA:
 *   200 { ok: true }  — emails enviados correctamente
 *   400 { error }     — validación fallida
 *   500 { error }     — falta RESEND_API_KEY
 *   502 { error }     — error al llamar a la API de Resend
 */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]
  ));
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.CUBICO_FROM_EMAIL || 'CÚBICO <noreply@cubico.com.pa>';
  const ADMIN_EMAIL = process.env.CUBICO_ADMIN_EMAIL || 'info@cubico.com.pa';

  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta RESEND_API_KEY en Netlify.' }) };
  }

  let data = {};
  try { data = JSON.parse(event.body || '{}'); } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido.' }) };
  }

  const name = String(data.nombre || data.name || '').trim();
  const email = String(data.email || '').trim();
  const phone = String(data.telefono || data.phone || '').trim();
  const zone = String(data.zona || data.address || '').trim();
  const modality = String(data.modalidad || data.delivery_preference || '').trim();
  const message = String(data.mensaje || data.message || '').trim();

  if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta el nombre.' }) };
  if (name.length > 120) return { statusCode: 400, body: JSON.stringify({ error: 'Nombre demasiado largo.' }) };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { statusCode: 400, body: JSON.stringify({ error: 'Correo inválido.' }) };
  if (email.length > 200) return { statusCode: 400, body: JSON.stringify({ error: 'Correo demasiado largo.' }) };
  if (phone.length > 30) return { statusCode: 400, body: JSON.stringify({ error: 'Teléfono inválido.' }) };
  if (message.length > 2000) return { statusCode: 400, body: JSON.stringify({ error: 'Mensaje demasiado largo.' }) };

  async function sendEmail(payload) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.error || 'No se pudo enviar el correo.');
    return result;
  }

  const eName = escapeHtml(name);
  const eEmail = escapeHtml(email);
  const ePhone = escapeHtml(phone);
  const eZone = escapeHtml(zone);
  const eModality = escapeHtml(modality);
  const eMessage = escapeHtml(message);

  const adminHtml = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111">
    <h2>Nuevo contacto desde CÚBICO</h2>
    <p><strong>Nombre:</strong> ${eName}</p>
    <p><strong>Correo:</strong> ${eEmail}</p>
    <p><strong>Teléfono:</strong> ${ePhone || '—'}</p>
    <p><strong>Zona:</strong> ${eZone || '—'}</p>
    <p><strong>Modalidad:</strong> ${eModality || '—'}</p>
    <p><strong>Mensaje:</strong> ${eMessage || '—'}</p>
  </div>`;

  const clientHtml = `<div style="font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;padding:24px;color:#111">
    <div style="max-width:620px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e6e6e6">
      <div style="background:#050607;color:#fff;padding:26px 30px">
        <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#c9a35b;margin-bottom:10px">CÚBICO</div>
        <h1 style="margin:0;font-size:26px;line-height:1.15">Recibimos tu solicitud.</h1>
      </div>
      <div style="padding:26px 30px">
        <p style="font-size:16px;margin:0 0 14px">Hola ${eName},</p>
        <p style="font-size:15px;line-height:1.65;margin:0 0 18px">Gracias por contactar a CÚBICO. Recibimos tus datos y nuestro equipo te contactará para ayudarte con tu casillero, carga o consulta.</p>
        <p style="font-size:14px;line-height:1.6;color:#555;margin:0">CÚBICO · Logística · Carga · Soluciones</p>
      </div>
    </div>
  </div>`;

  try {
    await sendEmail({
      from: FROM_EMAIL,
      to: [ADMIN_EMAIL],
      reply_to: email,
      subject: `Nuevo contacto CÚBICO · ${eName}`,
      html: adminHtml,
      text: `Nuevo contacto CÚBICO\nNombre: ${name}\nCorreo: ${email}\nTeléfono: ${phone || '—'}\nZona: ${zone || '—'}\nModalidad: ${modality || '—'}\nMensaje: ${message || '—'}`
    });
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }

  // Confirmación al cliente: fire-and-forget.
  // Con onboarding@resend.dev solo se puede enviar al correo del dueño de la cuenta.
  // Cuando se configure un dominio propio en Resend, este correo llegará al cliente también.
  sendEmail({
    from: FROM_EMAIL,
    to: [email],
    subject: 'Recibimos tu solicitud · CÚBICO',
    html: clientHtml,
    text: `Hola ${name}, recibimos tu solicitud en CÚBICO. Nuestro equipo te contactará pronto.`
  }).catch(() => {});

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
