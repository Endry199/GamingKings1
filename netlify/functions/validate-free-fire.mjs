import { json, options, readBody } from './_shared.mjs';

const API_BASE = 'https://panel.recargasamerica.com/api/v1';

function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Detecta el campo correcto según el nombre del producto (catálogo unificado)
function detectFieldName(productName) {
    return /tarjeta|pase|booyah|semanal|mensual|b[aá]sica/i.test(productName || '') ? 'player_id' : 'manual_id';
}

// 🆕 FIX: Elimina puntos y comas ANTES de extraer números
// "5.600" → 5600  |  "1.060" → 1060  |  "2.180" → 2180
function extractMainNumber(text) {
    const cleaned = String(text || '').replace(/[.,]/g, '');
    const matches = cleaned.match(/\d{3,}/g) || [];
    return matches.map(n => parseInt(n, 10)).sort((a, b) => b - a)[0] || null;
}

// Detecta el tipo de paquete por palabras clave
function detectPackageType(text) {
    const lower = normalize(text);
    if (/b[aá]sica/.test(lower)) return 'basica';
    if (/semanal/.test(lower)) return 'semanal';
    if (/mensual/.test(lower)) return 'mensual';
    if (/booyah/.test(lower)) return 'booyah';
    if (/pase/.test(lower)) return 'pase';
    if (/diamante/.test(lower)) return 'diamantes';
    return 'unknown';
}

function findProduct(products, packageName) {
    try {
        console.log('[findProduct] ============ INICIO BÚSQUEDA ============');
        console.log('[findProduct] packageName original:', packageName);
        console.log('[findProduct] products es array:', Array.isArray(products));
        console.log('[findProduct] products length:', Array.isArray(products) ? products.length : 'N/A');

        const wanted = normalize(packageName);
        console.log('[findProduct] packageName normalizado:', wanted);

        // Filtrar SOLO productos Free Fire tipo recharge
        const freeFire = (products || []).filter(product => {
            try {
                const name = normalize(product?.name || product?.sku || '');
                return name.includes('free fire') && product?.type === 'recharge';
            } catch (e) {
                console.error('[findProduct] Error filtrando producto:', e.message);
                return false;
            }
        });

        console.log('[findProduct] Productos Free Fire type=recharge encontrados:', freeFire.length);
        freeFire.forEach((p, i) => console.log(`[findProduct]   [${i}] id=${p.id} | name="${p.name}" | sku="${p.sku}"`));

        if (freeFire.length === 0) {
            console.log('[findProduct] ❌ No hay productos Free Fire recharge en el catálogo');
            return null;
        }
        if (freeFire.length === 1) {
            console.log('[findProduct] ✅ Único producto Free Fire, devolviendo:', freeFire[0].name);
            return freeFire[0];
        }

        // Estrategia 1: Buscar por número grande (100, 310, 5600, etc.)
        const wantedNumber = extractMainNumber(packageName);
        console.log('[findProduct] Estrategia 1 - Número principal detectado:', wantedNumber);

        if (wantedNumber) {
            const match = freeFire.find(product => {
                const productNumber = extractMainNumber(product.name);
                return productNumber === wantedNumber;
            });
            if (match) {
                console.log('[findProduct] ✅ Match por número:', match.name);
                return match;
            }
            console.log('[findProduct] Estrategia 1 sin match');

            // 🆕 Debug: mostrar qué números extrajo de cada producto
            freeFire.forEach(p => {
                console.log(`[findProduct]   DEBUG "${p.name}" → número extraído: ${extractMainNumber(p.name)}`);
            });
        }

        // Estrategia 2: Buscar por tipo (tarjeta/pase/booyah/semanal/mensual)
        const wantedType = detectPackageType(packageName);
        console.log('[findProduct] Estrategia 2 - Tipo detectado:', wantedType);

        if (wantedType !== 'unknown') {
            const matches = freeFire.filter(product => detectPackageType(product.name) === wantedType);
            console.log('[findProduct] Productos del mismo tipo encontrados:', matches.length);
            matches.forEach(p => console.log(`[findProduct]   - ${p.name}`));

            if (wantedType === 'semanal' && wanted.includes('basica')) {
                const basica = matches.find(p => normalize(p.name).includes('basica'));
                if (basica) {
                    console.log('[findProduct] ✅ Match por semanal básica:', basica.name);
                    return basica;
                }
            } else if (wantedType === 'semanal') {
                const normal = matches.find(p => !normalize(p.name).includes('basica'));
                if (normal) {
                    console.log('[findProduct] ✅ Match por semanal normal:', normal.name);
                    return normal;
                }
            } else if (matches.length === 1) {
                console.log('[findProduct] ✅ Match único por tipo:', matches[0].name);
                return matches[0];
            } else if (matches.length > 1) {
                console.log('[findProduct] ⚠️ Múltiples matches de tipo, usando el primero:', matches[0].name);
                return matches[0];
            }
        }

        // Estrategia 3 (fallback): Búsqueda por tokens
        const wantedTokens = wanted.split(' ').filter(token => token.length > 2 && !['diamantes', 'diamond', 'free', 'fire', 'recarga'].includes(token));
        console.log('[findProduct] Estrategia 3 - Tokens de búsqueda:', wantedTokens);

        const tokenMatch = freeFire.find(product => {
            const candidate = normalize(`${product.name} ${product.sku}`);
            return wantedTokens.some(token => candidate.includes(token));
        });

        if (tokenMatch) {
            console.log('[findProduct] ✅ Match por tokens:', tokenMatch.name);
            return tokenMatch;
        }

        console.log('[findProduct] ❌ NO SE ENCONTRÓ MATCH');
        return null;

    } catch (error) {
        console.error('[findProduct] ❌ ERROR FATAL:', {
            name: error?.name,
            message: error?.message,
            stack: error?.stack
        });
        return null;
    }
}

export async function handler(event) {
    console.log('[validate-free-fire] ============ NUEVA PETICIÓN ============');
    console.log('[validate-free-fire] HTTP Method:', event.httpMethod);

    if (event.httpMethod === 'OPTIONS') return options();

    try {
        const { serviceUserId, packageName } = readBody(event);
        console.log('[validate-free-fire] Body recibido:', { serviceUserId, packageName });

        if (!serviceUserId || !packageName) {
            console.error('[validate-free-fire] ❌ Faltan campos');
            return json(400, { error: 'Falta el ID de cuenta o el paquete.' });
        }

        const hasToken = Boolean(process.env.RECARGAS_AMERICA_API_TOKEN);
        console.log('[validate-free-fire] RECARGAS_AMERICA_API_TOKEN presente:', hasToken);

        if (!hasToken) {
            console.error('[validate-free-fire] ❌ Falta RECARGAS_AMERICA_API_TOKEN');
            return json(500, { error: 'Falta configurar RECARGAS_AMERICA_API_TOKEN en Netlify.' });
        }

        // Consultar catálogo unificado
        console.log('[validate-free-fire] Consultando /products/catalog...');
        const catalogResponse = await fetch(`${API_BASE}/products/catalog`, {
            headers: {
                Authorization: `Bearer ${process.env.RECARGAS_AMERICA_API_TOKEN}`,
                Accept: 'application/json'
            }
        });
        const catalog = await catalogResponse.json().catch(() => ({}));

        console.log('[validate-free-fire] Catálogo HTTP status:', catalogResponse.status);
        console.log('[validate-free-fire] Catálogo success:', catalog.success);
        console.log('[validate-free-fire] Catálogo data length:', (catalog.data || []).length);

        if (!catalogResponse.ok || !catalog.success) {
            console.error('[validate-free-fire] ❌ Error del catálogo:', catalog.error);
            return json(502, { error: catalog.error || 'No se pudo consultar el catálogo de recargas.' });
        }

        // Buscar el producto
        console.log('[validate-free-fire] Buscando producto para:', packageName);
        const product = findProduct(catalog.data || [], packageName);

        if (!product) {
            console.error('[validate-free-fire] ❌ No se encontró producto para:', packageName);
            return json(422, { error: 'No se encontró el paquete Free Fire en el catálogo de Recargas América.' });
        }

        console.log('[validate-free-fire] ✅ Producto encontrado:', {
            id: product.id,
            name: product.name,
            sku: product.sku,
            type: product.type,
            required_fields: product.required_fields
        });

        // Validar el ID del jugador
        console.log('[validate-free-fire] Consultando /catalog/validate...');
        const validateBody = {
            product_id: product.id,
            service_user_id: String(serviceUserId).trim()
        };
        console.log('[validate-free-fire] Body:', JSON.stringify(validateBody));

        const validationResponse = await fetch(`${API_BASE}/catalog/validate`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RECARGAS_AMERICA_API_TOKEN}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(validateBody)
        });
        const validation = await validationResponse.json().catch(() => ({}));
        console.log('[validate-free-fire] Validación HTTP status:', validationResponse.status);
        console.log('[validate-free-fire] Validación respuesta:', JSON.stringify(validation, null, 2));

        if (!validationResponse.ok || !validation.success) {
            console.error('[validate-free-fire] ❌ Error en la validación:', validation.error);
            return json(502, { error: validation.error || 'No se pudo validar la cuenta.' });
        }

        if (validation.data?.supported === false) {
            console.log('[validate-free-fire] ⚠️ Proveedor NO soporta precheck');
            return json(200, {
                ok: true,
                valid: true,
                accountName: null,
                productId: product.id,
                productName: product.name,
                noPrecheck: true
            });
        }

        const valid = validation.data?.status === true;
        const accountName = validation.data?.account_name || null;
        console.log('[validate-free-fire] ✅ Resultado:', { valid, accountName });

        return json(200, {
            ok: true,
            valid,
            accountName,
            productId: product.id,
            productName: product.name
        });

    } catch (error) {
        console.error('[validate-free-fire] ❌ ERROR FATAL:', {
            name: error?.name,
            code: error?.code,
            message: error?.message,
            stack: error?.stack
        });
        return json(500, { error: error?.message || 'No se pudo validar la cuenta Free Fire.' });
    }
}