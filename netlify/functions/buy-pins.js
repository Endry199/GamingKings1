// netlify/functions/buy-pins.js
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// 🔧 Configuración de modo simulación
const SIMULATION_MODE = process.env.SIMULATION_MODE === 'true';

// 📧 Función para enviar correo con los PINs
async function sendPinsEmail(sessionToken, pins, quantity, packageName, totalCost, transactionId) {
    try {
        // Obtener la URL base (para llamadas internas)
        const baseUrl = process.env.URL || 'http://localhost:8888';
        
        const response = await fetch(`${baseUrl}/.netlify/functions/send-pins-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sessionToken}`
            },
            body: JSON.stringify({
                pins: pins,
                quantity: quantity,
                packageName: packageName,
                totalCost: totalCost,
                transactionId: transactionId
            })
        });

        const data = await response.json();
        console.log(`📧 Respuesta de send-pins-email:`, data);
        return { success: response.ok, ...data };
    } catch (error) {
        console.error("❌ Error al llamar a send-pins-email:", error.message);
        return { success: false, error: error.message };
    }
}

// 🔍 Función para extraer PINs de cualquier formato de respuesta
function extractPinsFromResponse(responseData) {
    if (!responseData) return [];
    
    console.log("🔍 Extrayendo PINs de:", JSON.stringify(responseData, null, 2));
    
    // 1. Verificar si hay pins en data.api_data.pins (formato de RecargasAmérica)
    if (responseData.data?.api_data?.pins && Array.isArray(responseData.data.api_data.pins)) {
        console.log("✅ PINs encontrados en data.api_data.pins");
        return responseData.data.api_data.pins;
    }
    
    // 2. Verificar si hay pins en data.pins
    if (responseData.data?.pins && Array.isArray(responseData.data.pins)) {
        console.log("✅ PINs encontrados en data.pins");
        return responseData.data.pins;
    }
    
    // 3. Verificar si hay pins directamente en responseData.pins
    if (responseData.pins && Array.isArray(responseData.pins)) {
        console.log("✅ PINs encontrados en responseData.pins");
        return responseData.pins;
    }
    
    // 4. Verificar si hay pins en api_data.pins
    if (responseData.api_data?.pins && Array.isArray(responseData.api_data.pins)) {
        console.log("✅ PINs encontrados en api_data.pins");
        return responseData.api_data.pins;
    }
    
    // 5. Verificar si responseData.data es un array de PINs
    if (responseData.data && Array.isArray(responseData.data) && responseData.data.length > 0) {
        console.log("✅ PINs encontrados en responseData.data (array)");
        return responseData.data;
    }
    
    // 6. Verificar si responseData.result es un array
    if (responseData.result && Array.isArray(responseData.result)) {
        console.log("✅ PINs encontrados en responseData.result");
        return responseData.result;
    }
    
    // 7. Si es un solo PIN
    if (responseData.pin) {
        console.log("✅ PIN único encontrado en responseData.pin");
        return [responseData.pin];
    }
    
    if (responseData.data?.pin) {
        console.log("✅ PIN único encontrado en responseData.data.pin");
        return [responseData.data.pin];
    }
    
    console.warn("⚠️ No se encontraron PINs en la respuesta");
    return [];
}

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
        const userEmail = userData.email;
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

        // Generar ID de transacción
        const transactionId = `GAMING-${Date.now()}`;

        // 🟢 MODO SIMULACIÓN
        if (SIMULATION_MODE) {
            console.log("🟢 MODO SIMULACIÓN: Generando PINs falsos...");
            
            const fakePins = [];
            for (let i = 0; i < quantity; i++) {
                const pinCode = `FF-SIM-${String(Math.floor(100000 + Math.random() * 900000))}-${String(Math.floor(100000 + Math.random() * 900000))}`;
                fakePins.push(pinCode);
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
                        pins: fakePins,
                        transaction_id: transactionId
                    }
                });

            // 📧 Enviar correo con los PINs
            console.log(`📧 Enviando correo de simulación a ${userEmail}...`);
            const emailResult = await sendPinsEmail(sessionToken, fakePins, quantity, productName, totalCost, transactionId);
            console.log(`📧 Resultado del envío de correo:`, emailResult);

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    success: true,
                    message: "🔧 [MODO SIMULACIÓN] Compra realizada con éxito. Los PINs han sido enviados a tu correo.",
                    pins: fakePins,
                    quantity: quantity,
                    product: productName || 'Free Fire',
                    new_balance: newBalance.toFixed(2),
                    transaction_id: transactionId,
                    simulation: true,
                    email_sent: emailResult.success || false
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

        // 7. Hacer la solicitud a la API
        let response;
        try {
            response = await axios.post(API_URL, payload, {
                headers: {
                    'Authorization': `Bearer ${API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
        } catch (axiosError) {
            console.error("❌ Error de Axios:");
            console.error("Status:", axiosError.response?.status);
            console.error("Data:", axiosError.response?.data);
            
            if (axiosError.code === 'ECONNABORTED') {
                return {
                    statusCode: 504,
                    body: JSON.stringify({
                        success: false,
                        message: "El proveedor está tardando demasiado en responder. Por favor, intenta de nuevo."
                    })
                };
            }
            
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
        
        // Verificar si la respuesta fue exitosa
        const isSuccess = responseData && (responseData.status === 'success' || responseData.success === true);
        
        if (isSuccess) {
            // 🎯 Extraer los PINs usando la función mejorada
            const pins = extractPinsFromResponse(responseData);
            console.log(`🎮 PINs extraídos: ${pins.length}`, pins);

            // Descontar saldo
            const newBalance = currentBalance - totalCost;
            
            await supabase
                .from('saldos')
                .update({ saldo_usd: newBalance.toFixed(2) })
                .eq('user_id', googleId);

            // Registrar transacción
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
                        provider_response: responseData,
                        transaction_id: transactionId,
                        pins: pins
                    }
                });

            // 📧 Enviar correo con los PINs
            console.log(`📧 Enviando correo a ${userEmail} con ${pins.length} PINs...`);
            let emailResult = { success: false };
            
            if (pins.length > 0) {
                emailResult = await sendPinsEmail(sessionToken, pins, quantity, productName, totalCost, transactionId);
                console.log(`📧 Resultado del envío de correo:`, emailResult);
            } else {
                console.warn("⚠️ No hay PINs para enviar por correo.");
            }

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    success: true,
                    message: "Compra realizada con éxito. Los PINs han sido enviados a tu correo.",
                    pins: pins,
                    quantity: quantity,
                    product: productName || 'Free Fire',
                    new_balance: newBalance.toFixed(2),
                    transaction_id: transactionId,
                    provider_response: responseData,
                    email_sent: emailResult.success || false
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