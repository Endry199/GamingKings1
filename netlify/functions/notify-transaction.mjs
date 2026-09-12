import { supabaseAdmin, json, options, readBody, mailer } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  let stage = 'request';
  try {
    const { transactionId } = readBody(event);
    console.info('[notify-transaction] request received', { transactionId, hasBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN), botTokenLength: process.env.TELEGRAM_BOT_TOKEN?.length || 0, hasChatId: Boolean(process.env.TELEGRAM_CHAT_ID), chatIdLength: process.env.TELEGRAM_CHAT_ID?.length || 0 });
    if (!transactionId) return json(400, { error: 'Falta transactionId.' });
    stage = 'load_transaction';
    const { data: transaction, error } = await supabaseAdmin.from('transactions').select('*').eq('id', transactionId).single();
    if (error) throw error;
    console.info('[notify-transaction] transaction loaded', { transactionId: transaction.id, emailDomain: transaction.email?.split('@')[1] || null, currency: transaction.currency, paymentMethod: transaction.paymentMethod });
    const message = [`🧾 *Nueva recarga Niunx Play*`, ``, `*Transacción:* ${transaction.id_transaccion}`, `*Cliente:* ${transaction.email || 'No indicado'}`, `*Monto:* ${transaction.base_amount || transaction.finalPrice} NCoins`, `*Moneda:* ${transaction.currency || 'Por definir'}`, `*Método:* ${transaction.paymentMethod || 'Por definir'}`, ``, `*Comprobante:* ${transaction.receipt_url || 'No disponible'}`].join('\n');
    stage = 'telegram';
    const telegramResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Aceptar pago', callback_data: `approve:${transaction.id}` }, { text: '❌ Rechazar pago', callback_data: `reject:${transaction.id}` }]] } }) });
    const telegramBody = await telegramResponse.json().catch(() => ({}));
    console.info('[notify-transaction] Telegram response', { status: telegramResponse.status, ok: telegramResponse.ok, description: telegramBody.description || null });
    if (!telegramResponse.ok) throw new Error(`Telegram: ${telegramBody.description || 'no aceptó la notificación.'}`);
    if (transaction.email) {
      stage = 'customer_email';
      await mailer().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: transaction.email, subject: 'Comprobante recibido · Niunx Play', text: `Recibimos tu comprobante de ${transaction.base_amount || transaction.finalPrice} NCoins. Tu recarga está en revisión.`, html: `<div style="font-family:Arial,sans-serif;color:#17233f;padding:28px"><h2>Comprobante recibido</h2><p>Recibimos tu comprobante de <strong>${transaction.base_amount || transaction.finalPrice} NCoins</strong>.</p><p>Tu recarga está en revisión. Te avisaremos cuando sea aprobada o rechazada.</p><small>Transacción ${transaction.id_transaccion}</small></div>` });
      console.info('[notify-transaction] customer email sent', { emailDomain: transaction.email.split('@')[1] || null });
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error('[notify-transaction]', { stage, name: error?.name, code: error?.code, message: error?.message });
    return json(500, { error: `No se pudo notificar (${stage}). ${error?.message || 'Error interno.'}` });
  }
}
