/**
 * tracking.js — Lógica del formulario de tracking público (página /tracking).
 *
 * FLUJO:
 *   1. El usuario ingresa un número de tracking y selecciona el tipo (aéreo u oceánico).
 *   2. Al enviar, se hace fetch a /.netlify/functions/tracking (proxy CORS hacia PTY Freight).
 *   3. La respuesta se normaliza con normalizePackages() y se renderiza con renderPackage().
 *
 * FUNCIONES:
 *   formatDate(value)              — formatea una fecha ISO a español panameño (es-PA)
 *   escapeHTML(value)              — escapa caracteres HTML para prevenir XSS en el render
 *   normalizePackages(payload, type) — extrae el array de paquetes de la respuesta de PTY Freight
 *                                       (campo "packages" para aéreo, "oceanPackages" para marítimo)
 *   renderPackage(pkg, index)      — devuelve el HTML de una tarjeta de paquete individual
 *
 * DEPENDENCIAS:
 *   netlify/functions/tracking.js — función proxy que hace el fetch real a PTY Freight
 *
 * NOTA:
 *   STATE_LABELS mapea los códigos numéricos de estado de PTY Freight a etiquetas legibles.
 *   La lista puede necesitar actualización cuando PTY Freight confirme su catálogo completo.
 */

const form = document.getElementById('tracking-form');
const result = document.getElementById('tracking-result');
const button = document.getElementById('tracking-button');

const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function getCached(tracking, type) {
  try {
    const raw = sessionStorage.getItem(`tr_${type}_${tracking}`);
    if (!raw) return null;
    const { ts, payload } = JSON.parse(raw);
    if (Date.now() - ts < CACHE_TTL) return payload;
    sessionStorage.removeItem(`tr_${type}_${tracking}`);
  } catch {}
  return null;
}

function setCache(tracking, type, payload) {
  try {
    sessionStorage.setItem(`tr_${type}_${tracking}`, JSON.stringify({ ts: Date.now(), payload }));
  } catch {}
}

// Ajustable cuando tengamos confirmada la lista completa exacta de PTY Freight.
const STATE_LABELS = {
  0: 'Recibido en Miami',
  1: 'En proceso / próximo estado',
  2: 'En tránsito',
  3: 'Disponible / actualizado',
  4: 'Entregado / cerrado'
};

function formatDate(value) {
  if (!value) return 'No disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PA', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[char]));
}

function normalizePackages(payload, type) {
  const data = payload?.data || {};
  const list = type === 'ocean' ? (data.oceanPackages || []) : (data.packages || []);
  return Array.isArray(list) ? list : [];
}

function renderPackage(pkg, index) {
  const state = pkg.state;
  const stateLabel = STATE_LABELS[state] || `Estado ${state}`;
  return `
    <article class="package-result">
      <div class="package-topline">
        <span>Paquete ${index + 1}</span>
        <strong>${escapeHTML(stateLabel)}</strong>
      </div>
      <div class="package-data">
        <div><small>Warehouse</small><b>${escapeHTML(pkg.warehouse_number || 'No disponible')}</b></div>
        <div><small>Fecha de admisión</small><b>${escapeHTML(formatDate(pkg.date_of_admission))}</b></div>
        <div><small>Procesado</small><b>${pkg.is_processed ? 'Sí' : 'No'}</b></div>
        <div><small>ID externo</small><b>${escapeHTML(pkg.id || 'N/D')}</b></div>
      </div>
    </article>`;
}

function renderPayload(payload, tracking, type) {
  const packages = normalizePackages(payload, type);
  const externalStatus = payload?.data?.status || 'ok';

  if (!packages.length) {
    result.className = 'tracking-result empty';
    result.innerHTML = `
      <span class="result-kicker">Sin resultados</span>
      <h3>No encontramos información para este tracking.</h3>
      <p>Verifica el número ingresado o intenta consultar en el otro tipo de carga.</p>`;
    return;
  }

  result.className = 'tracking-result success';
  result.innerHTML = `
    <span class="result-kicker">Resultado encontrado</span>
    <h3>${escapeHTML(tracking.toUpperCase())}</h3>
    <p class="result-subtitle">Tipo de consulta: ${type === 'ocean' ? 'Flete marítimo' : 'Flete aéreo'} · Estado externo: ${escapeHTML(externalStatus)}</p>
    <div class="package-list">${packages.map(renderPackage).join('')}</div>
    <p class="result-disclaimer">Esta información viene de un proveedor externo y no modifica el estado interno de tu cuenta CÚBICO.</p>`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tracking = document.getElementById('tracking-number').value.trim();
  const type = document.getElementById('tracking-type').value;

  if (!tracking) return;

  const cached = getCached(tracking, type);
  if (cached) {
    renderPayload(cached, tracking, type);
    return;
  }

  button.disabled = true;
  button.textContent = 'Buscando...';
  result.className = 'tracking-result loading';
  result.innerHTML = '<span class="result-kicker">Consultando</span><p>Estamos buscando tu tracking. Dame dos segundos, sin drama de aduana.</p>';

  try {
    const response = await fetch(`/.netlify/functions/tracking?type=${encodeURIComponent(type)}&tracking=${encodeURIComponent(tracking)}`);
    const payload = await response.json();

    if (!response.ok || payload.status === 'error') {
      throw new Error(payload.message || 'No pudimos consultar el tracking.');
    }

    setCache(tracking, type, payload);
    renderPayload(payload, tracking, type);
  } catch (error) {
    result.className = 'tracking-result error';
    result.innerHTML = `
      <span class="result-kicker">Error de consulta</span>
      <h3>No pudimos obtener el tracking.</h3>
      <p>${escapeHTML(error.message || 'Intenta nuevamente más tarde.')}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = 'Buscar paquete';
  }
});
