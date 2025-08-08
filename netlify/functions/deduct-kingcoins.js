// netlify/functions/deduct-kingcoins.js
const { Formidable } = require('formidable');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error("Faltan variables de entorno requeridas para Supabase.");
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error de configuración del servidor: Faltan credenciales de Supabase." })
        };
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    let fieldsData;

    try {
        if (event.headers['content-type'] && event.headers['content-type'].includes('multipart/form-data')) {
            const form = new Formidable({ multiples: true });
            const bodyBuffer = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '');
            const reqStream = new Readable();
            reqStream.push(bodyBuffer);
            reqStream.push(null);
            reqStream.headers = event.headers;
            reqStream.method = event.httpMethod;

            const { fields } = await new Promise((resolve, reject) => {
                form.parse(reqStream, (err, fields) => {
                    if (err) {
                        console.error('Formidable parse error:', err);
                        return reject(err);
                    }
                    resolve({ fields });
                });
            });
            fieldsData = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));

        } else if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
            fieldsData = JSON.parse(event.body);
        } else {
            const { parse } = require('querystring');
            fieldsData = parse(event.body);
        }
    } catch (parseError) {
        console.error("Error al procesar los datos de la solicitud:", parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: `Error al procesar los datos: ${parseError.message || 'Unknown error'}.` })
        };
    }
    
    const { email, finalPrice } = fieldsData;

    if (!email || !finalPrice) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Faltan parámetros requeridos (email o finalPrice)." })
        };
    }
    
    try {
        const { data: userData, error: userError } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', email)
            .single();

        if (userError || !userData) {
            console.error("Error al buscar el usuario:", userError || "No se encontró el usuario.");
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "No se encontró un usuario con ese correo electrónico." })
            };
        }
        
        const userId = userData.id;

        const { data: walletData, error: walletError } = await supabase
            .from('user_wallets')
            .select('balance')
            .eq('user_id', userId)
            .single();

        if (walletError || !walletData) {
            console.error("Error al buscar la billetera:", walletError || "No se encontró la billetera.");
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "No se encontró una billetera KGC asociada a tu cuenta." })
            };
        }

        const currentBalance = parseFloat(walletData.balance);
        const price = parseFloat(finalPrice);

        if (isNaN(currentBalance) || isNaN(price)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "El saldo o el precio no son números válidos." })
            };
        }

        if (currentBalance < price) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: `Saldo insuficiente para completar la compra.` })
            };
        }

        const newBalance = currentBalance - price;
        const { error: updateError } = await supabase
            .from('user_wallets')
            .update({ balance: newBalance })
            .eq('user_id', userId);

        if (updateError) {
            console.error("Error al actualizar el saldo:", updateError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "Error interno al procesar el pago." })
            };
        }

        // ✅ AÑADIDO: Log para éxito en la deducción de KingCoins
        console.log(`SUCCESS: Deducción de KGC exitosa. Usuario: ${email}, Monto: ${price}, Nuevo Saldo: ${newBalance}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Pago con KingCoins procesado exitosamente.", newBalance: newBalance })
        };

    } catch (error) {
        console.error("Error inesperado en la función deduct-kingcoins:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor.", error: error.message })
        };
    }
};