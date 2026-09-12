import { supabaseAdmin, json, headers, mailer } from './_shared.mjs';

const emailHtml = (approved, transaction) => `<div style="margin:0;background:#070b1a;padding:38px 18px;font-family:Arial,sans-serif;color:#f6f8ff"><div style="max-width:520px;margin:auto;background:#101a35;border:1px solid #304d82;border-radius:18px;padding:36px"><div style="font-size:12px;font-weight:bold;letter-spacing:3px;color:#2be3ff">NIUNX PLAY</div><h1 style="font-size:28px;margin:24px 0 10px;color:#fff">${approved ? 'Tu recarga fue aprobada' : 'Tu recarga necesita atención'}</h1><p style="color:#a6b8da;line-height:1.6">${approved ? 'Los NCoins ya fueron añadidos a tu wallet.' : 'No pudimos aprobar esta recarga. Revisa los datos y vuelve a intentarlo.'}</p><div style="margin:25px 0;padding:18px;border-radius:12px;background:#0a142d;color:#2be3ff"><strong>${transaction.base_amount || transaction.finalPrice} NCoins</strong><br><span style="color:#a6b8da">Transacción ${transaction.id_transaccion}</span></div><p style="color:#637698;font-size:11px">© 2026 Niunx Play</p></div></div>`;

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };
  let stage = 'request';
  try {
    const update = JSON.parse(event.body || '{}');
    const callback = update.callback_query;
    console.info('[telegram-webhook] update received', { hasCallback: Boolean(callback?.data), action: callback?.data?.split(':')[0] || null });
    if (!callback?.data) return json(200, { ok: true });
    stage = 'load_transaction';
    const [action, transactionId] = callback.data.split(':');
    const approved = action === 'approve';
    const { data: transaction, error } = await supabaseAdmin.from('transactions').select('*').eq('id', transactionId).single();
    if (error) throw error;
    if (transaction.status !== 'pendiente') {
      await answerTelegram(callback.id, 'Esta transacción ya fue procesada.');
      return json(200, { ok: true });
    }
    const status = approved ? 'aprobado' : 'rechazado';
    stage = 'update_transaction';
    const { error: updateError } = await supabaseAdmin.from('transactions').update({ status, completed_at: new Date().toISOString(), completed_by: 'telegram' }).eq('id', transactionId).eq('status', 'pendiente');
    if (updateError) throw updateError;
    if (approved && transaction.google_id) {
      const amount = Number(transaction.base_amount || transaction.finalPrice || 0);
      const { data: balance } = await supabaseAdmin.from('saldos').select('saldo_ncoins').eq('user_id', transaction.google_id).maybeSingle();
      const current = Number(balance?.saldo_ncoins || 0);
      await supabaseAdmin.from('saldos').upsert({ user_id: transaction.google_id, saldo_ncoins: current + amount, ultima_recarga: new Date().toISOString() });
    }
    if (transaction.email) { stage = 'status_email'; await mailer().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: transaction.email, subject: approved ? 'Tu recarga ya está disponible · Niunx Play' : 'Actualización de tu recarga · Niunx Play', text: approved ? 'Tu recarga fue aprobada.' : 'Tu recarga fue rechazada.', html: emailHtml(approved, transaction) }); }
    await answerTelegram(callback.id, approved ? 'Pago aprobado y saldo actualizado.' : 'Pago rechazado.');
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: callback.message.chat.id, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } }) });
    return json(200, { ok: true });
  } catch (error) { console.error('[telegram-webhook]', { stage, name: error?.name, code: error?.code, message: error?.message }); return json(500, { error: `Webhook falló (${stage}). ${error?.message || 'Error interno.'}` }); }
}

async function answerTelegram(callbackId, text) { await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: callbackId, text }) }); }
//aaaaaa