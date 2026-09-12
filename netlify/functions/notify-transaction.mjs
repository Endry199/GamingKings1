import { supabaseAdmin, json, options, readBody } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  try {
    const { transactionId } = readBody(event);
    const { data: transaction, error } = await supabaseAdmin.from('transactions').select('*').eq('id', transactionId).single();
    if (error) throw error;
    const message = [`🧾 *Nueva recarga Niunx Play*`, ``, `*Transacción:* ${transaction.id_transaccion}`, `*Cliente:* ${transaction.email || 'No indicado'}`, `*Monto:* ${transaction.base_amount || transaction.finalPrice} NCoins`, `*Moneda:* ${transaction.currency || 'Por definir'}`, `*Método:* ${transaction.paymentMethod || 'Por definir'}`, ``, `*Comprobante:* ${transaction.receipt_url || 'No disponible'}`].join('\n');
    const telegramResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Aceptar pago', callback_data: `approve:${transaction.id}` }, { text: '❌ Rechazar pago', callback_data: `reject:${transaction.id}` }]] } }) });
    if (!telegramResponse.ok) throw new Error('Telegram no aceptó la notificación.');
    return json(200, { ok: true });
  } catch (error) { return json(500, { error: error.message }); }
}
