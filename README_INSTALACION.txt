CÚBICO - Landing Netlify con fotos locales

IMPORTANTE:
Este paquete ya incluye las imágenes dentro de /assets/img/.
No depende de links externos.

INSTALACIÓN EN NETLIFY:
1. Descomprime este ZIP.
2. En Netlify, entra al sitio actual de CÚBICO.
3. Ve a Deploys.
4. Arrastra la CARPETA COMPLETA o todos los archivos visibles:
   - index.html
   - gracias.html
   - assets/
   - netlify.toml
   - _redirects
5. Espera que Netlify termine el deploy.
6. Abre el preview.

SI NO SE VEN LAS FOTOS:
- Asegúrate de haber subido la carpeta assets completa.
- Dentro de assets debe existir la carpeta img.
- No subas solo index.html.

DATOS QUE PUEDES CAMBIAR:
- WhatsApp actual: +507 6070-5727
- Email actual: info@cubico.com.pa

Formulario:
El formulario usa Netlify Forms. Cuando esté publicado, los leads aparecen en Netlify > Forms.

CONFIGURACIÓN RESEND EN NETLIFY:
Ya se agregó la función /.netlify/functions/send-welcome para enviar correo de bienvenida después del registro.

Variables necesarias en Netlify > Project configuration > Environment variables:
- RESEND_API_KEY = tu llave de Resend. Debe quedar marcada como secret.
- CUBICO_FROM_EMAIL = CÚBICO <noreply@cubico.com.pa>
- CUBICO_ADMIN_EMAIL = correo donde quieres recibir aviso de nuevo registro. Ejemplo: info@cubico.com.pa

Después de agregar o cambiar variables en Netlify, debes hacer un nuevo deploy para que las funciones tomen los valores.
