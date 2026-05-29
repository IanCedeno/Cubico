// =============================================================
// CÚBICO — portal.js  v7
// Controlador del portal: autenticación, cliente y admin.
//
// Páginas que lo cargan (via data-page en <body>):
//   "auth"   → /entrar/
//   "client" → /cliente/
//   "admin"  → /admin/
//
// Depende de:
//   supabase-config.js  → inyecta CUBICO_SUPABASE_URL / KEY en window
//   @supabase/supabase-js (CDN) → window.supabase
// =============================================================


// ── UTILIDADES ──────────────────────────────────────────────

/** Atajo para document.querySelector */
const $ = (sel) => document.querySelector(sel);
/** Atajo para document.querySelectorAll convertido a array */
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/**
 * Crea un cliente Supabase con las credenciales cargadas por
 * supabase-config.js. Devuelve null si aún no están disponibles.
 */
function getSupabase() {
  if (!window.supabase || !window.CUBICO_SUPABASE_URL || !window.CUBICO_SUPABASE_KEY) return null;
  return window.supabase.createClient(window.CUBICO_SUPABASE_URL, window.CUBICO_SUPABASE_KEY);
}

/** Formatea un número como precio en dólares. Ej: 12.5 → "$12.50" */
function money(v) { return `$${Number(v || 0).toFixed(2)}`; }

/** Devuelve el valor recibido o "—" si es null / undefined. */
function safe(v) { return v ?? '—'; }

/** Escapa HTML para evitar XSS en mensajes de error externos (ej: Supabase). */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}

/** Formatea una fecha ISO como texto relativo o fecha corta. */
function formatDate(iso) {
  if (!iso) return '—';
  const d    = new Date(iso);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 7)  return `Hace ${diff} días`;
  return d.toLocaleDateString('es-PA', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Muestra un toast flotante en la esquina inferior derecha. */
function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add(type, 'toast-show'));
  setTimeout(() => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 280);
  }, 3000);
}

/** Devuelve la clase CSS de color para una pastilla de estado. */
function statusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('miami'))                                          return 's-miami';
  if (s.includes('tránsito') || s.includes('transito') || s.includes('camino')) return 's-transito';
  if (s.includes('entregado'))                                      return 's-entregado';
  if (s.includes('pendiente') || s.includes('pago'))               return 's-pendiente';
  return 's-panama';
}

/** Renderiza una mini barra de progreso de 4 pasos para el estado de un paquete. */
function progressBar(status) {
  const s = String(status || '').toLowerCase();
  let step = 2;
  if (s.includes('miami'))                                           step = 0;
  else if (s.includes('tránsito') || s.includes('transito') || s.includes('camino')) step = 1;
  else if (s.includes('entregado'))                                  step = 3;
  const dot  = (i) => `<div class="pkg-step-dot ${step >= i ? 'done' : ''}"></div>`;
  const line = (i) => `<div class="pkg-step-line ${step >= i ? 'done' : ''}"></div>`;
  return `<div class="pkg-progress">${dot(0)}${line(1)}${dot(1)}${line(2)}${dot(2)}${line(3)}${dot(3)}</div>`;
}

/** Copia texto al portapapeles y aplica clase visual de confirmación al botón. */
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '¡Copiado!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
  });
}

/**
 * Valida los tres formatos de cédula panameña:
 *   Regular:                1-1234-12345   (provincia-tomo-número)
 *   Nacido en el extranjero: PE-1234-12345
 *   Extranjero con cédula:  E-1234-123456
 */
const CEDULA_RE = /^(\d{1,2}-\d{1,4}-\d{1,5}|PE-\d{1,4}-\d{1,5}|E-\d{1,4}-\d{1,6})$/;


/**
 * Muestra un mensaje en el elemento dado.
 * Acepta HTML en el texto (útil para negritas y enlaces).
 * El elemento desaparece automáticamente cuando está vacío (CSS: .message:empty).
 *
 * @param {HTMLElement} el   - Elemento donde mostrar el mensaje
 * @param {string}      text - Texto o HTML del mensaje
 * @param {string}      type - 'ok' (verde) | 'bad' (rojo)
 */
function showMessage(el, text, type = 'ok') {
  if (!el) return;
  el.innerHTML = text;
  el.className = `message ${type}`;
}


// ── ESTADO DEL MÓDULO ────────────────────────────────────────
// Caché local de datos del admin, mantenida por loadAdmin().
// Se usan para resolver nombres en la tabla de paquetes y para
// el autocompletado de búsqueda, sin lanzar consultas adicionales.
let adminProfiles = [];
let adminPackages = [];


// ── PÁGINA DE AUTENTICACIÓN (/entrar/) ──────────────────────

/**
 * Inicializa /entrar/ con cuatro estados manejados por setTab():
 *
 *   'login'    → formulario de acceso con email y contraseña
 *   'register' → formulario de registro de nuevo casillero:
 *                genera código CBC, crea perfil en Supabase y
 *                dispara el correo de bienvenida via send-welcome
 *   'forgot'   → solicitud de enlace de recuperación de contraseña
 *   'reset'    → formulario de nueva contraseña; se activa automáticamente
 *                cuando Supabase detecta el token de recuperación en la URL
 *                mediante onAuthStateChange('PASSWORD_RECOVERY')
 *
 * Tras el login redirige a /admin/ o /cliente/ según el campo role del perfil.
 */
async function initAuthPage() {
  const supa = getSupabase();

  const loginForm    = $('#loginForm');
  const registerForm = $('#registerForm');
  const forgotForm   = $('#forgotForm');
  const resetForm    = $('#resetForm');
  const loginMsg     = $('#loginMsg');
  const registerMsg  = $('#registerMsg');
  const forgotMsg    = $('#forgotMsg');
  const resetMsg     = $('#resetMsg');
  const tabLogin     = $('#tabLogin');
  const tabRegister  = $('#tabRegister');

  // Activa un formulario y oculta los demás
  const mode = new URLSearchParams(location.search).get('mode');
  function setTab(which) {
    const isRegister = which === 'register';
    const isForgot   = which === 'forgot';
    const isReset    = which === 'reset';
    const isLogin    = !isRegister && !isForgot && !isReset;
    tabLogin?.classList.toggle('active', isLogin);
    tabRegister?.classList.toggle('active', isRegister);
    loginForm?.classList.toggle('hidden', !isLogin);
    registerForm?.classList.toggle('hidden', !isRegister);
    forgotForm?.classList.toggle('hidden', !isForgot);
    resetForm?.classList.toggle('hidden', !isReset);
  }
  tabLogin?.addEventListener('click',        () => setTab('login'));
  tabRegister?.addEventListener('click',     () => setTab('register'));
  $('#tabForgot')?.addEventListener('click',  () => setTab('forgot'));
  $('#backToLogin')?.addEventListener('click',() => setTab('login'));
  setTab(mode === 'registro' ? 'register' : 'login');

  // Indicador de fuerza de contraseña
  $('#regPassword')?.addEventListener('input', function () {
    const bar   = $('#pwdStrengthBar');
    const label = $('#pwdLabel');
    if (!bar || !label) return;
    const v = this.value;
    const hasLower  = /[a-z]/.test(v);
    const hasUpper  = /[A-Z]/.test(v);
    const hasNum    = /\d/.test(v);
    const hasSpec   = /[^a-zA-Z0-9]/.test(v);
    const types     = [hasLower || hasUpper, hasNum, hasSpec].filter(Boolean).length;
    let pct, color, text;
    if (v.length < 6)                           { pct = 20;  color = '#c62828'; text = 'Muy débil'; }
    else if (v.length < 8 || types === 1)       { pct = 40;  color = '#e65100'; text = 'Débil'; }
    else if (v.length < 10 || types === 2)      { pct = 65;  color = '#f9a825'; text = 'Media'; }
    else if (types === 3 && v.length >= 10)     { pct = 100; color = '#2e7d32'; text = 'Fuerte'; }
    else                                        { pct = 80;  color = '#558b2f'; text = 'Buena'; }
    bar.style.width      = `${pct}%`;
    bar.style.background = color;
    label.textContent    = text;
    label.style.color    = color;
  });

  // Nombre y apellido: bloquear entrada de dígitos en tiempo real
  ['#firstName', '#lastName'].forEach(sel => {
    $(sel)?.addEventListener('input', function() {
      const pos = this.selectionStart;
      const cleaned = this.value.replace(/[0-9]/g, '');
      if (cleaned !== this.value) {
        this.value = cleaned;
        this.setSelectionRange(pos - 1, pos - 1);
      }
    });
  });

  // Teléfono: auto-formato XXXX-XXXX, máximo 8 dígitos
  $('#phone')?.addEventListener('input', function() {
    const digits = this.value.replace(/\D/g, '').slice(0, 8);
    this.value = digits.length > 4 ? digits.slice(0, 4) + '-' + digits.slice(4) : digits;
  });

  // ── Inicio de sesión ──────────────────────────────────────
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supa) return showMessage(loginMsg, 'Falta configurar Supabase.', 'bad');
    const email    = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    showMessage(loginMsg, 'Validando acceso...');
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) return showMessage(loginMsg, escapeHtml(error.message), 'bad');
    const { data: profile } = await supa.from('profiles').select('role').eq('id', data.user.id).single();
    const role = profile?.role;
    location.href = role === 'admin' ? '/admin/' : role === 'repartidor' ? '/repartidor/' : '/cliente/';
  });

  // ── Registro de nuevo casillero ───────────────────────────
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supa) return showMessage(registerMsg, 'Falta configurar Supabase.', 'bad');
    const password  = $('#regPassword').value;
    const password2 = $('#regPassword2').value;
    if (password.length < 6)    return showMessage(registerMsg, 'La contraseña debe tener mínimo 6 caracteres.', 'bad');
    if (password !== password2) return showMessage(registerMsg, 'Las contraseñas no coinciden.', 'bad');

    const cedula = $('#cedula').value.trim().toUpperCase();
    if (!CEDULA_RE.test(cedula)) return showMessage(registerMsg,
      'Cédula inválida. Formatos aceptados: <strong>8-123-4567</strong>, <strong>PE-1234-12345</strong>, <strong>E-1234-123456</strong>.', 'bad');

    const firstName = $('#firstName').value.trim();
    const lastName  = $('#lastName').value.trim();
    const phone     = $('#phone').value.trim();
    if (!/^\d{4}-\d{4}$/.test(phone)) return showMessage(registerMsg,
      'Teléfono inválido. Formato requerido: <strong>6000-0000</strong>.', 'bad');
    const email = $('#regEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMessage(registerMsg,
      'Correo inválido. Ejemplo: <strong>nombre@correo.com</strong>.', 'bad');

    const payload   = {
      first_name:          firstName,
      last_name:           lastName,
      cedula,
      phone,
      email,
      address:             $('#address').value.trim(),
      zone:                $('#zone').value.trim(),
      delivery_preference: $('#deliveryPreference').value
    };

    showMessage(registerMsg, 'Creando casillero CÚBICO...');
    const { data, error } = await supa.auth.signUp({
      email: payload.email,
      password,
      options: { data: payload, emailRedirectTo: `${location.origin}/cliente/` }
    });
    if (error) return showMessage(registerMsg, escapeHtml(error.message), 'bad');

    // El trigger handle_new_user en Supabase crea el perfil y asigna el código CBC.
    // Esperamos un momento para que el trigger termine antes de leer el perfil.
    let profile = null;
    if (data.user) {
      await new Promise(r => setTimeout(r, 800));
      const { data: saved } = await supa.from('profiles').select('*').eq('id', data.user.id).single();
      profile = saved;
    }

    // Correo de bienvenida via send-welcome. Fire-and-forget: no bloquea el registro.
    fetch('/.netlify/functions/send-welcome', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...payload, cbc_code: profile?.cbc_code || '' })
    }).catch(() => {});

    showMessage(registerMsg, `Registro recibido. Tu código es <strong>${profile?.cbc_code || 'pendiente de asignación'}</strong>. Revisa tu correo y luego entra a tu portal.<br><br><a href="/entrar/" class="btn btn-primary" style="display:inline-flex;text-decoration:none;">Ir a entrar</a>`);
    registerForm.reset();
    if (data.session) setTimeout(() => { location.href = '/cliente/'; }, 1200);
  });

  // ── Solicitar enlace de recuperación ─────────────────────
  forgotForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supa) return showMessage(forgotMsg, 'Falta configurar Supabase.', 'bad');
    const email = $('#forgotEmail').value.trim();
    showMessage(forgotMsg, 'Enviando enlace...');
    const { error } = await supa.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/entrar/`
    });
    if (error) return showMessage(forgotMsg, escapeHtml(error.message), 'bad');
    showMessage(forgotMsg, 'Listo. Revisa tu correo y sigue el enlace para restablecer tu contraseña.');
    forgotForm.reset();
  });

  // ── Guardar nueva contraseña (llega desde el enlace del correo) ──
  resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supa) return showMessage(resetMsg, 'Falta configurar Supabase.', 'bad');
    const newPass  = $('#newPassword').value;
    const newPass2 = $('#newPassword2').value;
    if (newPass.length < 6)   return showMessage(resetMsg, 'La contraseña debe tener mínimo 6 caracteres.', 'bad');
    if (newPass !== newPass2) return showMessage(resetMsg, 'Las contraseñas no coinciden.', 'bad');
    showMessage(resetMsg, 'Guardando contraseña...');
    const { error } = await supa.auth.updateUser({ password: newPass });
    if (error) return showMessage(resetMsg, escapeHtml(error.message), 'bad');
    showMessage(resetMsg, '¡Contraseña actualizada! Redirigiendo a tu cuenta...');
    setTimeout(() => { location.href = '/cliente/'; }, 1500);
  });

  // Detecta automáticamente cuando el usuario llega desde el enlace de recuperación
  supa?.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') setTab('reset');
  });
}


// ── GUARDIA DE SESIÓN ────────────────────────────────────────

/**
 * Verifica que existe una sesión activa en Supabase y devuelve
 * { supa, session, profile } si es válida.
 *
 * Comportamiento de redireccionamiento:
 *   - Sin sesión             → redirige a /entrar/
 *   - admin=true, rol!=admin → redirige a /cliente/
 *
 * @param {boolean} admin - true para exigir role='admin'
 * @returns {object|null} { supa, session, profile } o null si redirigió
 */
async function requireSession(admin = false) {
  const supa = getSupabase();
  if (!supa) { location.href = '/entrar/'; return null; }
  const { data: { session } } = await supa.auth.getSession();
  if (!session) { location.href = '/entrar/'; return null; }
  const { data: profile } = await supa.from('profiles').select('*').eq('id', session.user.id).single();
  if (admin && profile?.role !== 'admin') { location.href = '/cliente/'; return null; }
  return { supa, session, profile };
}


// ── PORTAL DEL CLIENTE (/cliente/) ──────────────────────────

/**
 * Renderiza la tabla de paquetes asignados al cliente.
 * Columnas: tracking · descripción · estatus · tipo · saldo · pago.
 * Si no hay paquetes muestra un mensaje informativo.
 *
 * @param {Array} items - Arreglo de filas de la tabla packages en Supabase
 */
function renderClientPackages(items) {
  const tbody = $('#clientPackages');
  if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-guide">
        <strong>Aún no tienes paquetes asignados.</strong>
        Usa tu dirección en Miami para tu próxima compra y aquí verás el seguimiento.
        <br><br><a href="#direccion">Ver mi dirección en Miami →</a>
      </div>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(p =>
    `<tr>
      <td>
        <div style="font-size:13px;font-weight:600">${safe(p.tracking_number)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${formatDate(p.created_at)}</div>
      </td>
      <td>${safe(p.description)}</td>
      <td>
        <span class="status-pill ${statusClass(p.status)}">${safe(p.status)}</span>
        ${progressBar(p.status)}
      </td>
      <td>${safe(p.shipping_type)}</td>
      <td>${money(p.amount_due)}</td>
      <td>${safe(p.payment_status)}</td>
    </tr>`
  ).join('');
}

/**
 * Inicializa el portal del cliente (/cliente/).
 * Requiere sesión activa (requireSession redirige si no).
 *
 * Comportamiento:
 *   1. Verifica sesión y carga perfil desde Supabase.
 *   2. Si el perfil no tiene código CBC, genera uno de respaldo y lo guarda.
 *   3. Muestra nombre, código, dirección Miami, paquetes y formulario de edición.
 *   4. Revela el <main> al terminar (arranca con hidden en el HTML
 *      para evitar el flash de contenido sin datos).
 */
async function initClientPage() {
  const ctx = await requireSession(false); if (!ctx) return;
  const { supa } = ctx;
  let profile = ctx.profile;
  if (!profile) { location.href = '/entrar/'; return; }

  $('#clientName').textContent = `${safe(profile.first_name)} ${safe(profile.last_name)}`;

  // Datos del perfil en el dashboard
  $('#clientCode').textContent     = safe(profile.cbc_code || 'Pendiente de asignación');
  $('#clientEmail').textContent    = safe(profile.email);
  $('#clientPhone').textContent    = safe(profile.phone);
  $('#clientDelivery').textContent = safe(profile.delivery_preference);
  $('#miamiLine').textContent      = safe(profile.cbc_code || 'Pendiente de asignación');

  // Paquetes asignados al cliente (ordenados del más reciente al más antiguo)
  const { data: packages = [] } = await supa
    .from('packages')
    .select('*')
    .eq('client_id', profile.id)
    .order('created_at', { ascending: false });
  renderClientPackages(packages);

  // Formulario de edición de perfil (teléfono, zona, modalidad)
  const profileForm = $('#profileForm');
  if (profileForm) {
    const editPhone    = $('#editPhone');
    const editCedula   = $('#editCedula');
    const editAddress  = $('#editAddress');
    const editDelivery = $('#editDelivery');
    if (editPhone)   editPhone.value   = profile.phone || '';
    if (editCedula)  editCedula.value  = profile.cedula || '';
    if (editAddress) editAddress.value = profile.address || '';
    if (editDelivery && profile.delivery_preference) editDelivery.value = profile.delivery_preference;

    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cedulaVal = editCedula?.value.trim().toUpperCase() || '';
      if (cedulaVal && !CEDULA_RE.test(cedulaVal)) {
        return showMessage($('#profileMsg'),
          'Cédula inválida. Formatos: <strong>8-123-4567</strong>, <strong>PE-1234-12345</strong>, <strong>E-1234-123456</strong>.', 'bad');
      }
      const btn  = profileForm.querySelector('button[type="submit"]');
      const orig = btn?.textContent;
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
      const updatePayload = {
        phone:               editPhone.value.trim(),
        address:             editAddress.value.trim(),
        delivery_preference: editDelivery.value
      };
      if (cedulaVal) updatePayload.cedula = cedulaVal;
      const { data: updated, error } = await supa.from('profiles')
        .update(updatePayload)
        .eq('id', profile.id)
        .select('*')
        .single();
      if (btn) { btn.disabled = false; btn.textContent = orig; }
      if (error) return showMessage($('#profileMsg'), escapeHtml(error.message), 'bad');
      profile = updated;
      $('#clientPhone').textContent    = safe(profile.phone);
      $('#clientDelivery').textContent = safe(profile.delivery_preference);
      showMessage($('#profileMsg'), 'Perfil actualizado correctamente.');
      toast('Perfil guardado correctamente.');
    });
  }

  // Menú lateral: marcar enlace activo al hacer clic
  document.querySelectorAll('.side a').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.side a').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });

  // Botón: copiar código CBC
  $('#copyCbc')?.addEventListener('click', function () {
    copyToClipboard($('#clientCode').textContent.trim(), this);
  });

  // Botón: copiar dirección Miami
  $('#copyAddress')?.addEventListener('click', function () {
    const addr = `${safe(profile.cbc_code || '')}\n7854 NW 46TH ST SUITE 2\nCUBICO STE2\nDoral, FL 33195-6085`;
    copyToClipboard(addr, this);
  });

  // Revelar contenido una vez que todos los datos están listos
  document.querySelector('.portal-shell')?.removeAttribute('hidden');
  $('#logout')?.addEventListener('click', async () => { await supa.auth.signOut(); location.href = '/'; });
}


// ── PANEL ADMINISTRADOR (/admin/) ────────────────────────────

/**
 * Carga clientes y paquetes desde Supabase y actualiza todas las
 * vistas del panel admin (totales, tabla de clientes, tabla de paquetes).
 *
 * Almacena los resultados en adminProfiles y adminPackages para que
 * el autocompletado y la edición de paquetes funcionen sin nuevas consultas.
 * Construye un clientMap (uuid → perfil) para resolver el nombre del cliente
 * en cada fila de la tabla de paquetes.
 *
 * @param {object} supa - Cliente Supabase autenticado como admin
 */
async function loadAdmin(supa) {
  const { data: profiles = [] } = await supa
    .from('profiles')
    .select('id,cbc_code,first_name,last_name,cedula,email,phone,role')
    .order('created_at', { ascending: false });
  adminProfiles = profiles;
  const clientMap = Object.fromEntries(profiles.map(p => [p.id, p]));

  const { data: packages = [] } = await supa
    .from('packages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(80);
  adminPackages = packages;

  // Tarjetas de resumen
  $('#totalClients').textContent  = profiles.filter(p => p.role !== 'admin').length;
  $('#totalPackages').textContent = packages.length;
  $('#totalPending').textContent  = packages.filter(p => String(p.payment_status).toLowerCase() !== 'pagado').length;

  // Tabla de clientes registrados
  $('#clientList').innerHTML = profiles.map(p =>
    `<tr>
      <td>${safe(p.cbc_code)}</td>
      <td>${safe(p.first_name)} ${safe(p.last_name)}</td>
      <td>${safe(p.cedula)}</td>
      <td>${safe(p.email)}</td>
      <td>${safe(p.phone)}</td>
      <td>
        <select class="role-select" data-id="${p.id}"
          style="background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer">
          <option value="client"      ${p.role === 'client'      ? 'selected' : ''}>client</option>
          <option value="admin"       ${p.role === 'admin'       ? 'selected' : ''}>admin</option>
          <option value="repartidor"  ${p.role === 'repartidor'  ? 'selected' : ''}>repartidor</option>
        </select>
      </td>
    </tr>`
  ).join('') || `<tr><td colspan="6" class="empty">Sin clientes.</td></tr>`;

  // Tabla de paquetes con nombre del cliente resuelto y botones de acción
  $('#packageList').innerHTML = packages.map(p => {
    const cl = clientMap[p.client_id];
    const clientLabel = cl
      ? `${safe(cl.cbc_code)} · ${safe(cl.first_name)} ${safe(cl.last_name)}`
      : safe(p.client_id);
    return `<tr>
      <td>${safe(p.tracking_number)}</td>
      <td>${clientLabel}</td>
      <td><span class="status-pill ${statusClass(p.status)}">${safe(p.status)}</span></td>
      <td>${money(p.amount_due)}</td>
      <td>${safe(p.payment_status)}</td>
      <td style="white-space:nowrap">
        <button type="button" class="edit-pkg-btn" data-id="${p.id}"
          style="background:none;border:1px solid #555;color:#ccc;font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;margin-right:6px">
          Editar
        </button>
        <button type="button" class="del-pkg-btn" data-id="${p.id}" data-tracking="${safe(p.tracking_number)}"
          style="background:none;border:1px solid #8b2020;color:#e05555;font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer">
          Eliminar
        </button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="empty">Sin paquetes.</td></tr>`;
}

/**
 * Inicializa el panel de administración (/admin/).
 * Requiere sesión con role='admin' (requireSession redirige si no).
 *
 * El <header> y <main> arrancan con hidden en el HTML y solo se
 * revelan tras verificar la sesión, para evitar que usuarios
 * no autenticados vean la estructura del panel.
 *
 * Funcionalidades integradas:
 *   - Autocompletado de clientes (filtra por CBC, nombre o correo)
 *   - Crear paquete y asignarlo a un cliente
 *   - Editar paquete existente (pre-llena el formulario al hacer clic en Editar)
 *   - Eliminar paquete con diálogo de confirmación
 */
async function initAdminPage() {
  const ctx = await requireSession(true); if (!ctx) return;
  const { supa } = ctx;

  // Revelar UI solo después de confirmar que el usuario es admin
  document.querySelector('header[hidden]')?.removeAttribute('hidden');
  document.querySelector('main[hidden]')?.removeAttribute('hidden');
  $('#logout')?.addEventListener('click', async () => { await supa.auth.signOut(); location.href = '/'; });

  await loadAdmin(supa);

  // ── Campo saldo: solo números y un punto decimal ───────────
  $('#amountDue')?.addEventListener('input', function () {
    let v = this.value.replace(/[^0-9.]/g, '');
    const parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    if (parts[1]?.length > 2) v = parts[0] + '.' + parts[1].slice(0, 2);
    this.value = v;
  });

  // ── Auto-marcar pago como Pagado al seleccionar Entregado ──
  $('#status')?.addEventListener('change', function () {
    if (this.value === 'Entregado') {
      const pay = $('#paymentStatus');
      if (pay) pay.value = 'Pagado';
    }
  });

  // ── Cambio de rol desde la tabla de clientes ──────────────
  $('#clientes')?.addEventListener('change', async (e) => {
    const select = e.target.closest('.role-select');
    if (!select) return;
    select.disabled = true;
    const { error } = await supa.from('profiles')
      .update({ role: select.value })
      .eq('id', select.dataset.id);
    select.disabled = false;
    if (error) {
      showMessage($('#adminMsg'), escapeHtml(error.message), 'bad');
      await loadAdmin(supa);
    } else {
      toast('Rol actualizado correctamente.');
    }
  });

  // ── Autocompletado de búsqueda de clientes ────────────────
  const clientSearch      = $('#clientSearch');
  const clientSuggestions = $('#clientSuggestions');
  const clientSelected    = $('#clientSelected');

  clientSearch?.addEventListener('input', () => {
    const q = clientSearch.value.trim().toLowerCase();
    if (!q || q.length < 2) { clientSuggestions.style.display = 'none'; return; }

    // Busca en adminProfiles (caché local) para no hacer queries extra
    const matches = adminProfiles
      .filter(p =>
        (p.cbc_code || '').toLowerCase().includes(q) ||
        `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q)
      )
      .slice(0, 6);

    if (!matches.length) { clientSuggestions.style.display = 'none'; return; }

    clientSuggestions.style.display = 'block';
    clientSuggestions.innerHTML = matches.map(p =>
      `<div data-id="${p.id}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--line);font-size:14px;color:var(--ink);transition:background .1s" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''"
        ${safe(p.cbc_code)} · ${safe(p.first_name)} ${safe(p.last_name)}
      </div>`
    ).join('');

    // Al seleccionar una sugerencia, rellena el UUID oculto del formulario
    clientSuggestions.querySelectorAll('div[data-id]').forEach(div => {
      div.addEventListener('click', () => {
        const p = adminProfiles.find(x => x.id === div.dataset.id);
        if (!p) return;
        $('#clientId').value             = p.id;
        clientSearch.value               = `${safe(p.cbc_code)} · ${safe(p.first_name)} ${safe(p.last_name)}`;
        clientSelected.textContent       = p.email || '';
        clientSuggestions.style.display  = 'none';
      });
    });
  });

  // Cierra el autocompletado al hacer clic fuera de él
  document.addEventListener('click', (e) => {
    if (!clientSearch?.contains(e.target) && !clientSuggestions?.contains(e.target)) {
      if (clientSuggestions) clientSuggestions.style.display = 'none';
    }
  });

  // ── Formulario de paquetes (crear / editar) ───────────────

  // Limpia el formulario y vuelve al modo "crear"
  const resetPkgForm = () => {
    $('#editPackageId').value          = '';
    $('#packageSubmitBtn').textContent = 'Guardar paquete';
    $('#cancelEdit').style.display     = 'none';
    $('#clientSearch').value           = '';
    $('#clientSelected').textContent   = '';
  };

  // Delegación de eventos en la sección #paquetes para Editar y Eliminar
  $('#paquetes')?.addEventListener('click', async (e) => {

    // Eliminar paquete con confirmación
    const delBtn = e.target.closest('.del-pkg-btn');
    if (delBtn) {
      const tracking = delBtn.dataset.tracking || 'este paquete';
      if (!confirm(`¿Eliminar ${tracking}? Esta acción no se puede deshacer.`)) return;
      const { error } = await supa.from('packages').delete().eq('id', delBtn.dataset.id);
      if (error) return showMessage($('#adminMsg'), escapeHtml(error.message), 'bad');
      showMessage($('#adminMsg'), 'Paquete eliminado.');
      await loadAdmin(supa);
      return;
    }

    // Editar paquete: pre-llena el formulario con los datos del paquete seleccionado
    const editBtn = e.target.closest('.edit-pkg-btn');
    if (!editBtn) return;
    const pkg = adminPackages.find(p => p.id === editBtn.dataset.id);
    if (!pkg) return;
    const cl = adminProfiles.find(p => p.id === pkg.client_id);

    $('#editPackageId').value          = pkg.id;
    $('#clientId').value               = pkg.client_id;
    $('#clientSearch').value           = cl ? `${safe(cl.cbc_code)} · ${safe(cl.first_name)} ${safe(cl.last_name)}` : pkg.client_id;
    $('#clientSelected').textContent   = cl?.email || '';
    $('#trackingNumber').value         = pkg.tracking_number || '';
    $('#description').value            = pkg.description || '';
    $('#status').value                 = pkg.status || '';
    $('#shippingType').value           = pkg.shipping_type || '';
    $('#amountDue').value              = pkg.amount_due || 0;
    $('#paymentStatus').value          = pkg.payment_status || '';
    $('#packageSubmitBtn').textContent = 'Actualizar paquete';
    $('#cancelEdit').style.display     = 'inline-flex';
    document.getElementById('crear')?.scrollIntoView({ behavior: 'smooth' });
  });

  $('#cancelEdit')?.addEventListener('click', () => {
    resetPkgForm();
    $('#packageForm').reset();
    showMessage($('#adminMsg'), '');
  });

  // Crea o actualiza el paquete según si hay un editPackageId activo
  $('#packageForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const clientId = $('#clientId').value.trim();
    if (!clientId) return showMessage($('#adminMsg'), 'Selecciona un cliente de la lista.', 'bad');

    const editId  = $('#editPackageId')?.value?.trim();
    const payload = {
      client_id:       clientId,
      tracking_number: $('#trackingNumber').value.trim(),
      description:     $('#description').value.trim(),
      status:          $('#status').value,
      shipping_type:   $('#shippingType').value,
      amount_due:      Number($('#amountDue').value || 0),
      payment_status:  $('#paymentStatus').value
    };

    if (editId) {
      const { error } = await supa.from('packages').update(payload).eq('id', editId);
      if (error) return showMessage($('#adminMsg'), escapeHtml(error.message), 'bad');
      showMessage($('#adminMsg'), 'Paquete actualizado correctamente.');
    } else {
      const { error } = await supa.from('packages').insert(payload);
      if (error) return showMessage($('#adminMsg'), escapeHtml(error.message), 'bad');
      showMessage($('#adminMsg'), 'Paquete creado y asignado.');
    }

    e.target.reset();
    resetPkgForm();
    await loadAdmin(supa);
  });
}


// ── PORTAL DEL REPARTIDOR (/repartidor/) ─────────────────────

async function initRepartidorPage() {
  const ctx = await requireSession(false);
  if (!ctx) return;
  const { supa, profile } = ctx;
  if (!profile) { location.href = '/entrar/'; return; }

  if (!['repartidor', 'admin'].includes(profile?.role)) {
    location.href = '/cliente/';
    return;
  }

  const list = $('#deliveryList');

  function renderDeliveryList(packages, clientMap) {
    if (!list) return;
    if (!packages.length) {
      list.innerHTML = '<p class="pkg-empty">No hay paquetes pendientes de entrega.</p>';
      return;
    }

    list.innerHTML = packages.map(pkg => {
      const c = clientMap[pkg.client_id] || {};
      const nombre = `${c.first_name || ''} ${c.last_name || ''}`.trim() || '—';
      const zona   = c.address || c.zone || '—';
      return `
        <details class="delivery-card" data-id="${pkg.id}">
          <summary>
            <div class="pkg-main">
              <span class="pkg-tracking">${safe(pkg.tracking_number)}</span>
              <span class="pkg-client">${nombre}</span>
              <span class="pkg-phone">${safe(c.phone)}</span>
            </div>
            <span class="pkg-badge">${safe(pkg.status)}</span>
          </summary>
          <div class="pkg-detail">
            <table>
              <tr><td>Código CBC</td><td>${safe(c.cbc_code)}</td></tr>
              <tr><td>Teléfono</td><td>${safe(c.phone)}</td></tr>
              <tr><td>Zona / dirección</td><td>${safe(zona)}</td></tr>
              <tr><td>Modalidad</td><td>${safe(c.delivery_preference)}</td></tr>
              <tr><td>Descripción</td><td>${safe(pkg.description)}</td></tr>
              <tr><td>Tipo de envío</td><td>${safe(pkg.shipping_type)}</td></tr>
              <tr><td>Saldo</td><td>${money(pkg.amount_due)}</td></tr>
              <tr><td>Estado de pago</td><td>${safe(pkg.payment_status)}</td></tr>
            </table>
            <button class="btn-deliver" data-pkg="${pkg.id}">Marcar como Entregado</button>
          </div>
        </details>`;
    }).join('');

    list.querySelectorAll('.btn-deliver').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Actualizando...';
        const { error } = await supa
          .from('packages')
          .update({ status: 'Entregado', payment_status: 'Pagado' })
          .eq('id', btn.dataset.pkg);
        if (error) {
          btn.disabled = false;
          btn.textContent = 'Marcar como Entregado';
          return;
        }
        toast('Paquete marcado como entregado.');
        const card = btn.closest('.delivery-card');
        card.style.transition = 'opacity .3s';
        card.style.opacity = '0';
        setTimeout(() => {
          card.remove();
          if (!list.querySelector('.delivery-card')) {
            list.innerHTML = '<p class="pkg-empty">No hay paquetes pendientes de entrega. ¡Buen trabajo!</p>';
          }
        }, 300);
      });
    });
  }

  async function loadPackages() {
    const { data: packages = [] } = await supa
      .from('packages')
      .select('*')
      .neq('status', 'Entregado')
      .order('created_at', { ascending: false });

    if (!packages.length) {
      renderDeliveryList([], {});
      return;
    }

    const ids = [...new Set(packages.map(p => p.client_id))];
    const { data: clients = [] } = await supa
      .from('profiles')
      .select('id, first_name, last_name, phone, address, zone, cbc_code, delivery_preference')
      .in('id', ids);

    const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
    renderDeliveryList(packages, clientMap);
  }

  await loadPackages();
  document.querySelector('.portal-shell')?.removeAttribute('hidden');
  $('#logout')?.addEventListener('click', async () => { await supa.auth.signOut(); location.href = '/'; });
}


// ── ARRANQUE ─────────────────────────────────────────────────

/**
 * Punto de entrada de la aplicación.
 * Espera a que supabase-config.js resuelva CUBICO_CONFIG_READY
 * (la Promise que carga las credenciales desde /functions/config),
 * luego detecta qué página está activa mediante data-page en <body>
 * e inicializa el módulo correspondiente.
 */
(async function bootCubicoPortal() {
  if (window.CUBICO_CONFIG_READY) {
    try { await window.CUBICO_CONFIG_READY; } catch (e) { console.warn(e); }
  }
  if (document.body.dataset.page === 'auth')        initAuthPage();
  if (document.body.dataset.page === 'client')      initClientPage();
  if (document.body.dataset.page === 'admin')       initAdminPage();
  if (document.body.dataset.page === 'repartidor')  initRepartidorPage();
})();
