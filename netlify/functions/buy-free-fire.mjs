import crypto from 'node:crypto';
import { json, options, readBody, supabaseAdmin, mailer } from './_shared.mjs';

const API_BASE = 'https://panel.recargasamerica.com/api/v1';

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function readApiResponse(response) {
  return response.json().catch(() => ({}));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

async function sendTelegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text })
  });
  if (!response.ok) throw new Error('Telegram no aceptó la alerta.');
}

async function sendInvoice(transaction) {
  if (!transaction.email) return;
  await mailer().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: transaction.email,
    subject: `Factura de recarga · ${transaction.id_transaccion}`,
    text: `Recarga completada. Producto: ${transaction.product_name}. ID: ${transaction.service_user_id}. Monto: ${transaction.base_amount} NCoins. Transacción: ${transaction.id_transaccion}.`,
    html: `<div style="font-family:Arial,sans-serif;color:#17233f;padding:28px"><h2>Factura de recarga</h2><p>Tu compra fue procesada correctamente.</p><p><strong>Producto:</strong> ${escapeHtml(transaction.product_name)}</p><p><strong>ID de cuenta:</strong> ${escapeHtml(transaction.service_user_id)}</p><p><strong>Monto:</strong> ${escapeHtml(transaction.base_amount)} NCoins</p><p><strong>Transacción:</strong> ${escapeHtml(transaction.id_transaccion)}</p><p><strong>Estado:</strong> Completada</p></div>`
  });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  try {
    const authorization = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { error: 'Debes iniciar sesión para realizar la compra.' });

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) return json(401, { error: 'La sesión no es válida. Inicia sesión nuevamente.' });

    const { serviceUserId, packageName, productId, packageId } = readBody(event);
    const redemptionId = String(serviceUserId || '').trim();
    console.info('[buy-free-fire] request received', { userId: authData.user.id, hasEmail: Boolean(authData.user.email), hasRedemptionId: Boolean(redemptionId), productId, packageId });
    if (!redemptionId || !packageName || !productId || !packageId) return json(400, { error: 'Falta el ID de cuenta, el paquete o el producto.' });
    if (!process.env.RECARGAS_AMERICA_API_TOKEN) return json(500, { error: 'Falta configurar RECARGAS_AMERICA_API_TOKEN en Netlify.' });

    const { data: packageRow, error: packageError } = await supabaseAdmin.from('paquetes').select('id,nombre_paquete,ncoins').eq('id', packageId).maybeSingle();
    if (packageError) throw packageError;
    if (!packageRow || packageRow.nombre_paquete !== packageName) return json(400, { error: 'El paquete seleccionado ya no es válido.' });
    const ncoinsCost = Number(packageRow.ncoins);
    if (!Number.isFinite(ncoinsCost) || ncoinsCost <= 0) return json(422, { error: 'El paquete no tiene un precio válido.' });

    const apiHeaders = { Authorization: `Bearer ${process.env.RECARGAS_AMERICA_API_TOKEN}`, Accept: 'application/json' };
    const catalogResponse = await fetch(`${API_BASE}/products/pins`, { headers: apiHeaders });
    const catalog = await readApiResponse(catalogResponse);
    if (!catalogResponse.ok || !catalog.success) return json(502, { error: catalog.error || 'No se pudo consultar el catálogo de recargas.' });

    const product = (catalog.data || []).find(item => String(item.id) === String(productId));
    if (!product || product.type !== 'recharge' || !normalize(product.name || product.sku).includes('free fire')) {
      return json(422, { error: 'El paquete Free Fire seleccionado ya no está disponible.' });
    }

    const validationResponse = await fetch(`${API_BASE}/pins/validate`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: product.id, service_user_id: redemptionId })
    });
    const validation = await readApiResponse(validationResponse);
    console.info('[buy-free-fire] account validation', { status: validationResponse.status, ok: validationResponse.ok, valid: validation.data?.status === true });
    if (!validationResponse.ok || !validation.success) return json(502, { error: validation.error || 'No se pudo validar la cuenta antes de comprar.' });
    if (validation.data?.status !== true) return json(422, { error: 'La cuenta ya no pudo ser validada. Revisa el ID e inténtalo otra vez.' });

    const walletResponse = await fetch(`${API_BASE}/wallet`, { headers: apiHeaders });
    const wallet = await readApiResponse(walletResponse);
    const providerBalance = Number(wallet.data?.balance);
    const providerPrice = Number(product.price || 0);
    console.info('[buy-free-fire] provider wallet checked', { status: walletResponse.status, ok: walletResponse.ok, balanceAvailable: Number.isFinite(providerBalance), lowBalance: Number.isFinite(providerBalance) && providerBalance < 5 });
    if (!walletResponse.ok || !wallet.success || !Number.isFinite(providerBalance)) return json(503, { error: 'No se pudo comprobar la disponibilidad. Inténtalo en unos minutos.' });
    if (providerBalance < 5 || providerBalance < providerPrice) {
      try { await sendTelegram(`⚠️ ALERTA DE SALDO\nSaldo Recargas América insuficiente o bajo: $${providerBalance.toFixed(2)}\nProducto: ${product.name}\nCliente: ${authData.user.email || authData.user.id}`); } catch (error) { console.error('[buy-free-fire] low balance Telegram failed', { message: error.message }); }
      return json(503, { error: 'Sin stock disponible en este momento. Inténtalo en unos minutos.' });
    }

    const { data: balanceRow, error: balanceError } = await supabaseAdmin.from('saldos').select('saldo_ncoins').eq('user_id', authData.user.id).maybeSingle();
    if (balanceError) throw balanceError;
    if (Number(balanceRow?.saldo_ncoins || 0) < ncoinsCost) return json(402, { error: 'Saldo insuficiente. Recarga tu wallet primero, por favor.' });

    const { data: reservedBalance, error: reserveError } = await supabaseAdmin.from('saldos').update({ saldo_ncoins: Number(balanceRow.saldo_ncoins) - ncoinsCost }).eq('user_id', authData.user.id).gte('saldo_ncoins', ncoinsCost).select('saldo_ncoins').maybeSingle();
    if (reserveError) throw reserveError;
    if (!reservedBalance) return json(402, { error: 'Saldo insuficiente. Recarga tu wallet primero, por favor.' });

    const localTransactionId = `RA-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const transactionRecord = { id_transaccion: localTransactionId, finalPrice: ncoinsCost, base_amount: ncoinsCost, currency: 'NCoins', paymentMethod: 'Recarga directa', receipt_url: '', status: 'procesando', google_id: authData.user.id, email: authData.user.email, game: 'Free Fire', product_name: packageName, service_user_id: redemptionId, provider_status: 'VALIDATED', amount_charged: providerPrice };
    const { data: transaction, error: transactionError } = await supabaseAdmin.from('transactions').insert(transactionRecord).select('*').single();
    if (transactionError) {
      await supabaseAdmin.from('saldos').update({ saldo_ncoins: Number(balanceRow.saldo_ncoins) }).eq('user_id', authData.user.id);
      throw transactionError;
    }

    const purchaseResponse = await fetch(`${API_BASE}/buy/pins`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ product_id: product.id, redemption_id: redemptionId })
    });
    const purchase = await readApiResponse(purchaseResponse);
    console.info('[buy-free-fire] provider purchase response', { status: purchaseResponse.status, ok: purchaseResponse.ok, success: purchase.success, code: purchase.code || null });
    if (!purchaseResponse.ok || !purchase.success) {
      const status = purchaseResponse.status === 409 ? 409 : purchaseResponse.status >= 400 && purchaseResponse.status < 500 ? purchaseResponse.status : 502;
      await supabaseAdmin.from('saldos').update({ saldo_ncoins: Number(balanceRow.saldo_ncoins) }).eq('user_id', authData.user.id);
      await supabaseAdmin.from('transactions').update({ status: 'rechazado', provider_status: purchase.code || 'PURCHASE_FAILED', completed_at: new Date().toISOString(), completed_by: 'recargas-america' }).eq('id', transaction.id);
      if (status === 422 || status === 502) {
        try { await sendTelegram(`⚠️ RECARGA RECHAZADA\nProducto: ${product.name}\nID: ${redemptionId}\nMotivo: ${purchase.error || 'Proveedor rechazó la operación.'}`); } catch (error) { console.error('[buy-free-fire] rejected purchase Telegram failed', { message: error.message }); }
      }
      return json(status, { error: status === 422 || status === 502 ? 'Sin stock disponible en este momento. Inténtalo en unos minutos.' : purchase.error || 'La compra ya fue procesada anteriormente.' });
    }

    const providerTransactionId = purchase.data?.transaction_id || null;
    const providerOrderId = purchase.data?.order_id || purchase.data?.reference || null;
    const providerStatus = purchase.data?.status || 'COMPLETED';
    const { error: updateError } = await supabaseAdmin.from('transactions').update({ status: 'completado', completed_at: new Date().toISOString(), completed_by: 'recargas-america', provider_transaction_id: providerTransactionId, provider_order_id: providerOrderId, provider_status: providerStatus, amount_charged: Number(purchase.data?.amount_charged || providerPrice), details: purchase.data || {} }).eq('id', transaction.id);
    if (updateError) throw updateError;
    const completedTransaction = { ...transaction, status: 'completado', provider_transaction_id: providerTransactionId, provider_order_id: providerOrderId, provider_status: providerStatus, amount_charged: Number(purchase.data?.amount_charged || providerPrice) };
    console.info('[buy-free-fire] purchase completed', { localTransactionId, providerTransactionId, providerOrderId, userId: authData.user.id });
    try { await sendInvoice(completedTransaction); } catch (error) { console.error('[buy-free-fire] invoice failed', { message: error.message }); }
    try { await sendTelegram(`✅ RECARGA COMPLETADA\nProducto: ${product.name}\nID: ${redemptionId}\nCliente: ${authData.user.email || authData.user.id}\nTransacción: ${localTransactionId}`); } catch (error) { console.error('[buy-free-fire] Telegram failed', { message: error.message }); }
    return json(200, { ok: true, transaction: { ...purchase.data, local_transaction_id: localTransactionId }, accountName: validation.data?.account_name || null, productName: product.name, userId: authData.user.id });
  } catch (error) {
    console.error('[buy-free-fire]', { name: error?.name, code: error?.code, message: error?.message });
    return json(500, { error: error?.message || 'No se pudo completar la recarga Free Fire.' });
  }
}
