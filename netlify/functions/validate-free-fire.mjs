import { json, options, readBody } from './_shared.mjs';

const API_BASE = 'https://panel.recargasamerica.com/api/v1';

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function findProduct(products, packageName) {
  const wanted = normalize(packageName);
  const freeFire = products.filter(product => normalize(product.name || product.sku).includes('free fire') && product.type === 'recharge');
  if (freeFire.length === 1) return freeFire[0];
  const wantedTokens = wanted.split(' ').filter(token => token.length > 2 && !['diamantes', 'diamond', 'free', 'fire'].includes(token));
  return freeFire.find(product => {
    const candidate = normalize(`${product.name} ${product.sku}`);
    return wantedTokens.some(token => candidate.includes(token));
  }) || null;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  try {
    const { serviceUserId, packageName } = readBody(event);
    if (!serviceUserId || !packageName) return json(400, { error: 'Falta el ID de cuenta o el paquete.' });
    if (!process.env.RECARGAS_AMERICA_API_TOKEN) return json(500, { error: 'Falta configurar RECARGAS_AMERICA_API_TOKEN en Netlify.' });

    const catalogResponse = await fetch(`${API_BASE}/products/pins`, { headers: { Authorization: `Bearer ${process.env.RECARGAS_AMERICA_API_TOKEN}`, Accept: 'application/json' } });
    const catalog = await catalogResponse.json().catch(() => ({}));
    if (!catalogResponse.ok || !catalog.success) return json(502, { error: catalog.error || 'No se pudo consultar el catálogo de recargas.' });
    const product = findProduct(catalog.data || [], packageName);
    if (!product) return json(422, { error: 'No se encontró el paquete Free Fire en el catálogo de Recargas América.' });

    const validationResponse = await fetch(`${API_BASE}/pins/validate`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.RECARGAS_AMERICA_API_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ product_id: product.id, service_user_id: String(serviceUserId).trim() }) });
    const validation = await validationResponse.json().catch(() => ({}));
    if (!validationResponse.ok || !validation.success) return json(502, { error: validation.error || 'No se pudo validar la cuenta.' });

    const valid = validation.data?.status === true;
    return json(200, { ok: true, valid, accountName: validation.data?.account_name || null, productId: product.id, productName: product.name });
  } catch (error) {
    console.error('[validate-free-fire]', { name: error?.name, code: error?.code, message: error?.message });
    return json(500, { error: error?.message || 'No se pudo validar la cuenta Free Fire.' });
  }
}
