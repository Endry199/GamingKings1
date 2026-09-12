# Niunx Play Web

Sitio web estático para Netlify con Supabase y Netlify Functions.

## Antes de desplegar

1. Ejecuta `supabase_web_setup.sql` en el SQL Editor de Supabase.
2. Cambia `saldos.saldo_usd` a `saldos.saldo_ncoins` si todavía no lo hiciste.
3. Crea un bucket público llamado `payment-proofs` o deja que lo cree el SQL.
4. En Supabase Auth activa Google y configura el dominio de Netlify en Redirect URLs.
5. Instala Node.js 20 o superior para desarrollo local. Este equipo no tenía `npm` disponible durante la creación.

## Variables privadas de Netlify

Configúralas en Site configuration > Environment variables. Nunca las pongas en `app.js`.

```text
SUPABASE_URL=https://oznmqczxpywvdmefermv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_actual
SITE_URL=https://tu-sitio.netlify.app
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-correo
SMTP_PASS=tu-app-password-de-gmail
SMTP_FROM=Niunx Play <tu-correo>
TELEGRAM_BOT_TOKEN=tu-token-del-bot
TELEGRAM_CHAT_ID=tu-chat-id
RECARGAS_AMERICA_API_TOKEN=tu-clave-privada-de-recargas-america
```

Usa una **App Password de Gmail**, no la contraseña normal. La `service_role` y la clave de Recargas América solo viven en Netlify Functions.

## Telegram

Después del primer deploy, registra el webhook:

```text
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tu-sitio.netlify.app/.netlify/functions/telegram-webhook
```

## Desarrollo

Instala dependencias y ejecuta:

```bash
npm install
npx netlify dev
```

## Nota sobre seguridad

El frontend usa la clave `anon`, que no es secreta. RLS limita los registros a cada usuario. Las Functions usan `service_role` únicamente en el servidor para crear usuarios, verificar OTP, enviar correos y procesar botones de Telegram.
