// netlify/functions/buy-pins.js
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

exports.handler = async function(event, context) {
    console.log("--- INICIO DE FUNCIÓN buy-pins ---");
    
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ message: "Method Not Allowed" }) };
    }

    // 1. Configuración de Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor." }) 
        };
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Obtener y verificar el token de sesión
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log("❌ ERROR 401: Falta el token Bearer.");
        return { 
            statusCode: 401, 
            body: JSON.stringify({ message: "No autorizado. Falta el token de sesión." }) 
        };
    }

    const sessionToken = authHeader.substring(7);

    // 3. Obtener el cuerpo de la solicitud
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ message: "Formato de cuerpo inválido." }) };
    }

    const { productId, quantity = 1, redemptionId } = body;

    // Validaciones
    if (!productId) {
        return { statusCode: 400, body: JSON.stringify({ message: "Falta product_id." }) };
    }

    if (quantity < 1 || quantity > 10) {
        return { statusCode: 400, body: JSON.stringify({ message: "La cantidad debe ser entre 1 y 10." }) };
    }

    if (redemptionId && redemptionId.length < 3) {
        return { statusCode: 400, body: JSON.stringify({ message: "redemption_id inválido." }) };
    }

    try {
        // 4. Verificar usuario autenticado
        const { data: userData, error: authError } = await supabase
            .from('usuarios')
            .select('google_id, nombre, email, saldos!left(saldo_usd)')
            .eq('session_token', sessionToken)
            .maybeSingle();

        if (authError || !userData) {
            console.error("❌ ERROR 401: Token de sesión inválido.", authError);
            return { 
                statusCode: 401, 
                body: JSON.stringify({ message: "Sesión inválida. Por favor, inicia sesión de nuevo." }) 
            };
        }

        const googleId = userData.google_id;
        const userEmail = userData.email;
        const userName = userData.nombre;

        if (!googleId) {
            return { 
                statusCode: 500, 
                body: JSON.stringify({ message: "Error interno: ID de usuario no disponible." }) 
            };
        }

        // 5. Obtener el precio del producto desde Supabase
        const { data: productData, error: productError } = await supabase
            .from('products')
            .select('id, name, price_usd, provider_product_id')
            .eq('id', productId)
            .maybeSingle();

        if (productError || !productData) {
            console.error("Error al obtener producto:", productError);
            return { 
                statusCode: 404, 
                body: JSON.stringify({ message: "Producto no encontrado." }) 
            };
        }

        const productPrice = parseFloat(productData.price_usd);
        const totalCost = productPrice * quantity;
        const providerProductId = productData.provider_product_id || productId;

        // 6. Verificar saldo suficiente
        const currentBalance = parseFloat(userData.saldos?.saldo_usd || 0);
        console.log(`Saldo actual: $${currentBalance}, Costo total: $${totalCost}`);

        if (currentBalance < totalCost) {
            return { 
                statusCode: 403, 
                body: JSON.stringify({ 
                    message: "Saldo insuficiente.", 
                    balance: currentBalance,
                    required: totalCost
                }) 
            };
        }

        // 7. Configurar la API de RecargasAmérica
        const API_URL = 'https://panel.recargasamerica.com/api/v1/buy/pins';
        const API_TOKEN = process.env.RECARGAS_AMERICA_API_TOKEN;

        if (!API_TOKEN) {
            console.error("❌ Falta RECARGAS_AMERICA_API_TOKEN en variables de entorno.");
            return { 
                statusCode: 500, 
                body: JSON.stringify({ message: "Error de configuración del proveedor." }) 
            };
        }

        // 8. Preparar el payload para la API
        const payload = {
            product_id: parseInt(providerProductId),
            quantity: quantity
        };

        // Si se proporciona redemptionId, es una recarga (recharge)
        if (redemptionId) {
            payload.redemption_id = redemptionId;
            payload.type = 'recharge';
        } else {
            payload.type = 'pin';
        }

        console.log(`📤 Enviando solicitud a RecargasAmérica:`, payload);

        // 9. Hacer la solicitud a la API del proveedor
        const response = await axios.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 segundos timeout
        });

        console.log(`✅ Respuesta de RecargasAmérica:`, response.data);

        // 10. Si la API respondió con éxito, descontar el saldo
        if (response.data && response.data.status === 'success') {
            // Descontar saldo
            const newBalance = currentBalance - totalCost;
            
            const { error: updateError } = await supabase
                .from('saldos')
                .update({ saldo_usd: newBalance.toFixed(2) })
                .eq('user_id', googleId);

            if (updateError) {
                console.error("Error al actualizar saldo:", updateError);
                // No devolvemos error porque la compra ya se realizó, pero registramos
            }

            // Registrar transacción
            const transactionData = {
                user_id: googleId,
                monto: -totalCost,
                tipo: 'compra_pin',
                descripcion: `Compra de ${quantity} PIN(s) - ${productData.name}`,
                metadatos: {
                    product_id: productId,
                    quantity: quantity,
                    provider_response: response.data,
                    redemption_id: redemptionId || null
                }
            };

            await supabase
                .from('transacciones')
                .insert(transactionData);

            // Devolver la respuesta exitosa
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    success: true,
                    message: "Compra realizada con éxito.",
                    pins: response.data.pins || response.data.data || [],
                    quantity: quantity,
                    product: productData.name,
                    new_balance: newBalance.toFixed(2),
                    provider_response: response.data
                })
            };

        } else {
            // La API del proveedor devolvió un erroraaaa
            console.error("❌ Error en RecargasAmérica:", response.data);
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: response.data.message || "Error al procesar la compra con el proveedor.",
                    provider_response: response.data
                })
            };
        }

    } catch (error) {
        console.error("❌ Error FATAL en buy-pins:", error.message);
        
        if (error.response) {
            console.error("Detalles del error:", error.response.data);
            return {
                statusCode: error.response.status || 500,
                body: JSON.stringify({
                    message: error.response.data.message || "Error del proveedor.",
                    provider_error: error.response.data
                })
            };
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ 
                message: "Error interno del servidor.", 
                error: error.message 
            })
        };
    }
};