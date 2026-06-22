// netlify/functions/buy-pins.js
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// 🔧 Configuración de modo simulación
const SIMULATION_MODE = process.env.SIMULATION_MODE === 'true';

exports.handler = async function(event, context) {
    console.log("--- INICIO DE FUNCIÓN buy-pins ---");
    console.log(`🔧 Modo simulación: ${SIMULATION_MODE ? 'ACTIVADO' : 'DESACTIVADO'}`);
    
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

    const { productId, quantity = 1, price, productName } = body;

    console.log("📥 Datos recibidos:", { productId, quantity, price, productName });

    // Validaciones
    if (!productId) {
        return { statusCode: 400, body: JSON.stringify({ message: "Falta product_id." }) };
    }

    if (quantity < 1 || quantity > 10) {
        return { statusCode: 400, body: JSON.stringify({ message: "La cantidad debe ser entre 1 y 10." }) };
    }

    const unitPrice = parseFloat(price) || 0;
    const totalCost = unitPrice * quantity;

    if (totalCost <= 0) {
        return { statusCode: 400, body: JSON.stringify({ message: "Precio inválido." }) };
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

        // 🟢 MODO SIMULACIÓN
        if (SIMULATION_MODE) {
            console.log("🟢 MODO SIMULACIÓN: Generando PINs falsos...");
            
            const fakePins = [];
            for (let i = 0; i < quantity; i++) {
                const pinCode = `FF-SIM-${String(Math.floor(100000 + Math.random() * 900000))}`;
                fakePins.push({ code: pinCode, status: 'active' });
            }
            
            const newBalance = currentBalance - totalCost;
            
            await supabase
                .from('saldos')
                .update({ saldo_usd: newBalance.toFixed(2) })
                .eq('user_id', googleId);

            await supabase
                .from('transacciones')
                .insert({
                    user_id: googleId,
                    monto: -totalCost,
                    tipo: 'compra_pin_simulacion',
                    descripcion: `[SIMULACIÓN] Compra de ${quantity} PIN(s) - ${productName || 'Free Fire'}`,
                    metadatos: {
                        product_id: productId,
                        quantity: quantity,
                        pins: fakePins
                    }
                });

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    success: true,
                    message: "🔧 [MODO SIMULACIÓN] Compra realizada con éxito.",
                    pins: fakePins,
                    quantity: quantity,
                    product: productName || 'Free Fire',
                    new_balance: newBalance.toFixed(2),
                    simulation: true
                })
            };
        }

        // 6. Configurar la API de RecargasAmérica
        const API_URL = 'https://panel.recargasamerica.com/api/v1/buy/pins';
        const API_TOKEN = process.env.RECARGAS_AMERICA_API_TOKEN;

        if (!API_TOKEN) {
            console.error("❌ Falta RECARGAS_AMERICA_API_TOKEN");
            return { 
                statusCode: 500, 
                body: JSON.stringify({ message: "Error de configuración del proveedor." }) 
            };
        }

        const payload = {
            product_id: parseInt(productId),
            quantity: quantity,
            type: 'pin'
        };

        console.log(`📤 Enviando solicitud a RecargasAmérica:`, JSON.stringify(payload, null, 2));

        // 7. Hacer la solicitud con timeout más largo (60 segundos)
        let response;
        try {
            response = await axios.post(API_URL, payload, {
                headers: {
                    'Authorization': `Bearer ${API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000, // Aumentado a 60 segundos
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
        } catch (axiosError) {
            console.error("❌ Error de Axios:");
            console.error("Status:", axiosError.response?.status);
            console.error("Data:", axiosError.response?.data);
            console.error("Message:", axiosError.message);
            
            // Timeout
            if (axiosError.code === 'ECONNABORTED') {
                return {
                    statusCode: 504,
                    body: JSON.stringify({
                        success: false,
                        message: "El proveedor está tardando demasiado en responder. Por favor, intenta de nuevo."
                    })
                };
            }
            
            // Error de saldo insuficiente en el proveedor
            if (axiosError.response?.data?.error === 'Saldo insuficiente.') {
                return {
                    statusCode: 402,
                    body: JSON.stringify({
                        success: false,
                        message: "El proveedor no tiene saldo suficiente. Por favor, contacta con soporte.",
                        provider_error: axiosError.response?.data
                    })
                };
            }
            
            return {
                statusCode: axiosError.response?.status || 500,
                body: JSON.stringify({
                    success: false,
                    message: "Error al comunicarse con el proveedor.",
                    provider_error: axiosError.response?.data || axiosError.message
                })
            };
        }

        console.log(`✅ Respuesta de RecargasAmérica (Status ${response.status}):`);
        console.log(JSON.stringify(response.data, null, 2));

        const responseData = response.data;
        
        if (responseData && (responseData.status === 'success' || responseData.success === true)) {
            const newBalance = currentBalance - totalCost;
            
            await supabase
                .from('saldos')
                .update({ saldo_usd: newBalance.toFixed(2) })
                .eq('user_id', googleId);

            await supabase
                .from('transacciones')
                .insert({
                    user_id: googleId,
                    monto: -totalCost,
                    tipo: 'compra_pin',
                    descripcion: `Compra de ${quantity} PIN(s) - ${productName || 'Free Fire'}`,
                    metadatos: {
                        product_id: productId,
                        quantity: quantity,
                        provider_response: responseData
                    }
                });

            // Extraer los PINs
            let pins = [];
            if (responseData.pins) {
                pins = responseData.pins;
            } else if (responseData.data && Array.isArray(responseData.data)) {
                pins = responseData.data;
            } else if (responseData.result && Array.isArray(responseData.result)) {
                pins = responseData.result;
            }

            if (pins.length === 0 && responseData.pin) {
                pins = [{ code: responseData.pin }];
            }

            console.log(`🎮 PINs extraídos: ${pins.length}`);

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    success: true,
                    message: "Compra realizada con éxito.",
                    pins: pins,
                    quantity: quantity,
                    product: productName || 'Free Fire',
                    new_balance: newBalance.toFixed(2),
                    provider_response: responseData
                })
            };

        } else {
            const errorMessage = responseData?.message || responseData?.error || "Error al procesar la compra.";
            console.error("❌ Error en RecargasAmérica:", errorMessage);
            
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: errorMessage,
                    provider_response: responseData
                })
            };
        }

    } catch (error) {
        console.error("❌ Error FATAL:", error.message);
        console.error("Stack:", error.stack);
        
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                message: "Error interno del servidor.", 
                error: error.message 
            })
        };
    }
};