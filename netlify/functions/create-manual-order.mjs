import crypto from 'node:crypto';
import { json, options, readBody, supabaseAdmin, mailer } from './_shared.mjs';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function normalizeVenezuelaPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('58')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^4\d{9}$/.test(digits)) return null;
  return `58${digits}`;
}

async function sendTelegram(transaction, product, destination, isWhatsApp) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) throw new Error('Faltan las variables de Telegram.');
  const destinationLabel = isWhatsApp ? `WhatsApp: ${destination}` : `ID: ${destination}`;
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: `🛒 NUEVO PEDIDO MANUAL\n\nProducto: ${product.nombre}\nPaquete: ${transaction.product_name}\n${destinationLabel}\nCliente: ${transaction.email || transaction.google_id}\nMonto: ${transaction.base_amount} NCoins\nTransacción: ${transaction.id_transaccion}`,
      reply_markup: { inline_keyboard: [
        ...(isWhatsApp ? [[{ text: '💬 Abrir WhatsApp', url: `https://wa.me/${destination}` }]] : []),
        [{ text: '✅ Marcar completada', callback_data: `manual_complete:${transaction.id}` }, { text: '❌ Rechazar y reintegrar', callback_data: `manual_reject:${transaction.id}` }]
      ] }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.description || 'Telegram no aceptó el pedido.');
}

async function sendPendingEmail(transaction, product, destination, isWhatsApp) {
  if (!transaction.email) return;
  const destinationLabel = isWhatsApp ? 'WhatsApp' : 'ID de cuenta';
  await mailer().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: transaction.email,
    subject: `Pedido recibido · ${transaction.id_transaccion}`,
    text: `Recibimos tu pedido de ${product.nombre}, paquete ${transaction.product_name}. ${destinationLabel}: ${destination}. Tu pedido está pendiente de completar.`,
    html: `<div style="font-family:Arial,sans-serif;color:#17233f;padding:28px"><h2>Pedido recibido</h2><p>Tu pedido está pendiente de completar.</p><p><strong>Producto:</strong> ${escapeHtml(product.nombre)}</p><p><strong>Paquete:</strong> ${escapeHtml(transaction.product_name)}</p><p><strong>${destinationLabel}:</strong> ${escapeHtml(destination)}</p><p><strong>Monto:</strong> ${escapeHtml(transaction.base_amount)} NCoins</p><p>Te enviaremos un correo cuando el pedido sea completado o rechazado.</p><small>Transacción ${escapeHtml(transaction.id_transaccion)}</small></div>`
  });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  let reservedBalance = null;
  try {
    const authorization = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { error: 'Debes iniciar sesión para realizar el pedido.' });
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) return json(401, { error: 'La sesión no es válida. Inicia sesión nuevamente.' });

    const { productId, packageId, packageName, destination } = readBody(event);
    if (!productId || !packageId || !packageName || !destination) return json(400, { error: 'Selecciona un paquete y completa el dato solicitado.' });
    const { data: product, error: productError } = await supabaseAdmin.from('productos').select('id,nombre,require_id,activo').eq('id', productId).eq('activo', true).maybeSingle();
    if (productError) throw productError;
    if (!product || /free\s*fire/i.test(`${product.nombre || ''}`)) return json(400, { error: 'Este producto usa el flujo automático.' });
    const { data: packageRow, error: packageError } = await supabaseAdmin.from('paquetes').select('id,nombre_paquete,ncoins').eq('id', packageId).maybeSingle();
    if (packageError) throw packageError;
    if (!packageRow || packageRow.nombre_paquete !== packageName) return json(400, { error: 'El paquete seleccionado ya no es válido.' });
    const ncoinsCost = Number(packageRow.ncoins);
    if (!Number.isFinite(ncoinsCost) || ncoinsCost <= 0) return json(422, { error: 'El paquete no tiene un precio válido.' });

    const isWhatsApp = !product.require_id;
    const normalizedDestination = isWhatsApp ? normalizeVenezuelaPhone(destination) : String(destination).trim();
    if (!normalizedDestination) return json(400, { error: 'Escribe un número de WhatsApp venezolano válido.' });
    if (!isWhatsApp && normalizedDestination.length < 3) return json(400, { error: 'Escribe una ID de cuenta válida.' });

    const { data: balanceRow, error: balanceError } = await supabaseAdmin.from('saldos').select('saldo_ncoins').eq('user_id', authData.user.id).maybeSingle();
    if (balanceError) throw balanceError;
    const currentBalance = Number(balanceRow?.saldo_ncoins || 0);
    if (!Number.isFinite(currentBalance) || currentBalance < ncoinsCost) return json(402, { error: 'Saldo insuficiente. Recarga tu wallet primero, por favor.' });
    const { data: updatedBalance, error: reserveError } = await supabaseAdmin.from('saldos').update({ saldo_ncoins: currentBalance - ncoinsCost }).eq('user_id', authData.user.id).gte('saldo_ncoins', ncoinsCost).select('saldo_ncoins').maybeSingle();
    if (reserveError) throw reserveError;
    if (!updatedBalance) return json(402, { error: 'Saldo insuficiente. Recarga tu wallet primero, por favor.' });
    reservedBalance = currentBalance;

    const localTransactionId = `NX-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const transactionRecord = { id_transaccion: localTransactionId, finalPrice: ncoinsCost, base_amount: ncoinsCost, currency: 'NCoins', paymentMethod: 'Pedido manual', receipt_url: '', status: 'pendiente', google_id: authData.user.id, email: authData.user.email, game: product.nombre, product_name: packageName, service_user_id: normalizedDestination, provider_status: isWhatsApp ? 'WHATSAPP_PENDING' : 'ACCOUNT_ID_PENDING' };
    const { data: transaction, error: transactionError } = await supabaseAdmin.from('transactions').insert(transactionRecord).select('*').single();
    if (transactionError) {
      await supabaseAdmin.from('saldos').update({ saldo_ncoins: currentBalance }).eq('user_id', authData.user.id);
      throw transactionError;
    }
    try {
      await sendTelegram(transaction, product, normalizedDestination, isWhatsApp);
      await sendPendingEmail(transaction, product, normalizedDestination, isWhatsApp);
    } catch (notificationError) {
      await supabaseAdmin.from('saldos').update({ saldo_ncoins: currentBalance }).eq('user_id', authData.user.id);
      await supabaseAdmin.from('transactions').update({ status: 'rechazado', provider_status: 'NOTIFICATION_FAILED', completed_at: new Date().toISOString(), completed_by: 'system' }).eq('id', transaction.id);
      throw notificationError;
    }
    console.info('[create-manual-order] pending order created', { transactionId: transaction.id, localTransactionId, productId, isWhatsApp, userId: authData.user.id });
    return json(200, { ok: true, transaction: { local_transaction_id: localTransactionId } });
  } catch (error) {
    console.error('[create-manual-order]', { name: error?.name, code: error?.code, message: error?.message });
    return json(500, { error: error?.message || 'No se pudo crear el pedido.' });
  }
}
