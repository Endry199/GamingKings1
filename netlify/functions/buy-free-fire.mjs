import crypto from 'node:crypto';
import { json, options, readBody, supabaseAdmin } from './_shared.mjs';

const API_BASE = 'https://panel.recargasamerica.com/api/v1';

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function readApiResponse(response) {
  return response.json().catch(() => ({}));
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  try {
    const authorization = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { error: 'Debes iniciar sesión para realizar la compra.' });

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) return json(401, { error: 'La sesión no es válida. Inicia sesión nuevamente.' });

    const { serviceUserId, packageName, productId } = readBody(event);
    const redemptionId = String(serviceUserId || '').trim();
    if (!redemptionId || !packageName || !productId) return json(400, { error: 'Falta el ID de cuenta, el paquete o el producto.' });
    if (!process.env.RECARGAS_AMERICA_API_TOKEN) return json(500, { error: 'Falta configurar RECARGAS_AMERICA_API_TOKEN en Netlify.' });

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
    if (!validationResponse.ok || !validation.success) return json(502, { error: validation.error || 'No se pudo validar la cuenta antes de comprar.' });
    if (validation.data?.status !== true) return json(422, { error: 'La cuenta ya no pudo ser validada. Revisa el ID e inténtalo otra vez.' });

    const purchaseResponse = await fetch(`${API_BASE}/buy/pins`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ product_id: product.id, redemption_id: redemptionId })
    });
    const purchase = await readApiResponse(purchaseResponse);
    if (!purchaseResponse.ok || !purchase.success) {
      const status = purchaseResponse.status === 409 ? 409 : purchaseResponse.status >= 400 && purchaseResponse.status < 500 ? purchaseResponse.status : 502;
      return json(status, { error: purchase.error || 'Recargas América no pudo procesar la recarga.' });
    }

    return json(200, { ok: true, transaction: purchase.data || null, accountName: validation.data?.account_name || null, productName: product.name, userId: authData.user.id });
  } catch (error) {
    console.error('[buy-free-fire]', { name: error?.name, code: error?.code, message: error?.message });
    return json(500, { error: error?.message || 'No se pudo completar la recarga Free Fire.' });
  }
}
