/**
 * supabase-config.js — Carga las credenciales de Supabase en tiempo de ejecución.
 *
 * POR QUÉ NO VAN EN EL HTML:
 *   Netlify escanea el bundle estático en busca de secretos y puede rechazar el deploy
 *   si encuentra claves hardcodeadas. Este archivo hace un fetch a la función serverless
 *   /netlify/functions/config, que devuelve las claves desde variables de entorno del servidor.
 *
 * CÓMO SE USA:
 *   Este script se carga antes de portal.js. Expone la promesa window.CUBICO_CONFIG_READY.
 *   portal.js llama a `await window.CUBICO_CONFIG_READY` en bootCubicoPortal() para garantizar
 *   que las credenciales estén disponibles antes de inicializar el cliente de Supabase.
 *
 * VARIABLES GLOBALES QUE ESTABLECE:
 *   window.CUBICO_SUPABASE_URL  — URL del proyecto Supabase
 *   window.CUBICO_SUPABASE_KEY  — Clave anon pública de Supabase
 *
 * Si la función config falla (red, 403, etc.), ambas variables quedan como string vacío
 * y portal.js mostrará un error de configuración al intentar crear el cliente.
 */
window.CUBICO_CONFIG_READY = (async () => {
  try {
    const res = await fetch('/.netlify/functions/config', { cache: 'no-store' });
    if (!res.ok) throw new Error('Config no disponible');
    const cfg = await res.json();
    window.CUBICO_SUPABASE_URL = cfg.SUPABASE_URL || '';
    window.CUBICO_SUPABASE_KEY = cfg.SUPABASE_ANON_KEY || '';
  } catch (err) {
    console.warn('CÚBICO config pendiente:', err);
    window.CUBICO_SUPABASE_URL = '';
    window.CUBICO_SUPABASE_KEY = '';
  }
})();
