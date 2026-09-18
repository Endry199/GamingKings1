import { json, options, readBody } from './_shared.mjs';

const API_BASE = 'https://panel.recargasamerica.com/api/v1';

function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Detecta el campo correcto según el nombre del producto (catálogo unificado)
function detectFieldName(productName) {
    return /tarjeta|pase|booyah|semanal|mensual|b[aá]sica/i.test(productName || '') ? 'player_id' : 'manual_id';
}

// 🆕 Extrae el número principal de un texto (para hacer match por cantidad de diamantes)
function extractMainNumber(text) {
    const matches = String(text || '').match(/\d{3,}/g) || [];
    return matches.map(n => parseInt(n, 10)).sort((a, b) => b - a)[0] || null;
}

// 🆕 Detecta el tipo de paquete por palabras clave
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
    const wanted = normalize(packageName);
    console.log('[findProduct] ============ INICIO BÚSQUEDA ============');
    console.log('[findProduct] packageName original:', packageName);
    console.log('[findProduct] packageName normalizado:', wanted);

    // Filtrar SOLO productos Free Fire tipo recharge
    const freeFire = products.filter(product => {
        const name = normalize(product.name || product.sku);
        return name.includes('free fire') && product.type === 'recharge';
    });

    console.log('[findProduct] Total productos en catálogo:', products.length);
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
    }

    // Estrategia 2: Buscar por tipo (tarjeta/pase/diamantes)
    const wantedType = detectPackageType(packageName);
    console.log('[findProduct] Estrategia 2 - Tipo detectado:', wantedType);

    if (wantedType !== 'unknown' && wantedType !== 'diamantes') {
        const matches = freeFire.filter(product => detectPackageType(product.name) === wantedType);
        console.log('[findProduct] Productos del mismo tipo encontrados:', matches.length);
        matches.forEach(p => console.log(`[findProduct]   - ${p.name}`));

        // Si es "Tarjeta Semanal Básica", hay que distinguir de "Tarjeta Semanal"
        if (wantedType === 'semanal' && wanted.includes('basica')) {
            const basica = matches.find(p => normalize(p.name).includes('basica'));
            if (basica) {
                console.log('[findProduct] ✅ Match por semanal básica:', basica.name);
                return basica;
            }
            console.log('[findProduct] No se encontró variante básica');
        } else if (wantedType === 'semanal') {
            const normal = matches.find(p => !normalize(p.name).includes('basica'));
            if (normal) {
                console.log('[findProduct] ✅ Match por semanal normal:', normal.name);
                return normal;
            }
            console.log('[findProduct] No se encontró variante normal');
        } else if (matches.length === 1) {
            console.log('[findProduct] ✅ Match único por tipo:', matches[0].name);
            return matches[0];
        } else if (matches.length > 1) {
            console.log('[findProduct] ⚠️ Múltiples matches de tipo, usando el primero:', matches[0].name);
            return matches[0];
        }
    }

    // Estrategia 3 (fallback): Búsqueda por tokens como antes
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
}

export async function handler(event) {
    console.log('[validate-free-fire] ============ NUEVA PETICIÓN ============');
    console.log('[validate-free-fire] HTTP Method:', event.httpMethod);

    if (event.httpMethod === 'OPTIONS') return options();

    try {
        // 1. Leer body
        const { serviceUserId, packageName } = readBody(event);
        console.log('[validate-free-fire] Body recibido:', { serviceUserId, packageName });

        if (!serviceUserId || !packageName) {
            console.error('[validate-free-fire] ❌ Faltan campos: serviceUserId o packageName');
            return json(400, { error: 'Falta el ID de cuenta o el paquete.' });
        }

        // 2. Verificar variable de entorno
        const hasToken = Boolean(process.env.RECARGAS_AMERICA_API_TOKEN);
        console.log('[validate-free-fire] RECARGAS_AMERICA_API_TOKEN presente:', hasToken);
        console.log('[validate-free-fire] Token length:', process.env.RECARGAS_AMERICA_API_TOKEN?.length || 0);
        console.log('[validate-free-fire] Token prefix:', process.env.RECARGAS_AMERICA_API_TOKEN?.substring(0, 10) || 'N/A');
        console.log('[validate-free-fire] Es sandbox:', String(process.env.RECARGAS_AMERICA_API_TOKEN || '').startsWith('ra_test_'));

        if (!hasToken) {
            console.error('[validate-free-fire] ❌ Falta RECARGAS_AMERICA_API_TOKEN');
            return json(500, { error: 'Falta configurar RECARGAS_AMERICA_API_TOKEN en Netlify.' });
        }

        // 3. Consultar catálogo unificado
        console.log('[validate-free-fire] Consultando /products/catalog...');
        const catalogUrl = `${API_BASE}/products/catalog`;
        const catalogResponse = await fetch(catalogUrl, {
            headers: {
                Authorization: `Bearer ${process.env.RECARGAS_AMERICA_API_TOKEN}`,
                Accept: 'application/json'
            }
        });
        console.log('[validate-free-fire] Catálogo HTTP status:', catalogResponse.status, catalogResponse.statusText);

        const catalog = await catalogResponse.json().catch((e) => {
            console.error('[validate-free-fire] Error parseando JSON del catálogo:', e.message);
            return {};
        });

        console.log('[validate-free-fire] Catálogo success:', catalog.success);
        console.log('[validate-free-fire] Catálogo error (si hay):', catalog.error || 'ninguno');
        console.log('[validate-free-fire] Catálogo data length:', (catalog.data || []).length);
        console.log('[validate-free-fire] Catálogo data preview (primeros 3):',
            JSON.stringify((catalog.data || []).slice(0, 3), null, 2)
        );

        if (!catalogResponse.ok || !catalog.success) {
            console.error('[validate-free-fire] ❌ Error del catálogo:', catalog.error);
            return json(502, { error: catalog.error || 'No se pudo consultar el catálogo de recargas.' });
        }

        // 4. Buscar el producto
        console.log('[validate-free-fire] Buscando producto para:', packageName);
        const product = findProduct(catalog.data || [], packageName);

        if (!product) {
            console.error('[validate-free-fire] ❌ No se encontró producto para:', packageName);
            console.error('[validate-free-fire] Productos disponibles:', (catalog.data || []).map(p => `[${p.id}] ${p.name} (${p.type})`).join(' | '));
            return json(422, { error: 'No se encontró el paquete Free Fire en el catálogo de Recargas América.' });
        }

        console.log('[validate-free-fire] ✅ Producto encontrado:', {
            id: product.id,
            name: product.name,
            sku: product.sku,
            type: product.type,
            price: product.price,
            required_fields: product.required_fields
        });

        // 5. Validar el ID del jugador
        console.log('[validate-free-fire] Consultando /catalog/validate...');
        const validateUrl = `${API_BASE}/catalog/validate`;
        const validateBody = {
            product_id: product.id,
            service_user_id: String(serviceUserId).trim()
        };
        console.log('[validate-free-fire] Body a enviar:', JSON.stringify(validateBody));

        const validationResponse = await fetch(validateUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RECARGAS_AMERICA_API_TOKEN}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(validateBody)
        });
        console.log('[validate-free-fire] Validación HTTP status:', validationResponse.status, validationResponse.statusText);

        const validation = await validationResponse.json().catch((e) => {
            console.error('[validate-free-fire] Error parseando JSON de la validación:', e.message);
            return {};
        });
        console.log('[validate-free-fire] Validación respuesta completa:', JSON.stringify(validation, null, 2));

        if (!validationResponse.ok || !validation.success) {
            console.error('[validate-free-fire] ❌ Error en la validación:', validation.error);
            return json(502, { error: validation.error || 'No se pudo validar la cuenta.' });
        }

        // 6. Verificar si el proveedor soporta precheck
        if (validation.data?.supported === false) {
            console.log('[validate-free-fire] ⚠️ Proveedor NO soporta precheck (supported: false)');
            return json(200, {
                ok: true,
                valid: true,
                accountName: null,
                productId: product.id,
                productName: product.name,
                noPrecheck: true
            });
        }

        // 7. Devolver resultado
        const valid = validation.data?.status === true;
        const accountName = validation.data?.account_name || null;
        console.log('[validate-free-fire] ✅ Resultado final:', { valid, accountName });

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