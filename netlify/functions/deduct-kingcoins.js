// netlify/functions/deduct-kingcoins.js
const { Formidable } = require('formidable');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    let fieldsData;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    try {
        const form = new Formidable({ multiples: true });
        
        // Decodificar el cuerpo del evento si está codificado en Base64
        const bodyBuffer = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '');

        // Crear un stream a partir del buffer para que Formidable pueda procesarlo
        const reqStream = new Readable();
        reqStream.push(bodyBuffer);
        reqStream.push(null);
        reqStream.headers = event.headers;
        reqStream.method = event.httpMethod;

        const { fields } = await new Promise((resolve, reject) => {
            form.parse(reqStream, (err, fields) => {
                if (err) return reject(err);
                resolve({ fields });
            });
        });
        
        // Formatear los campos de formidable a un objeto simple
        fieldsData = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));

    } catch (parseError) {
        console.error("Error al procesar los datos de la solicitud:", parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: `Error al procesar los datos: ${parseError.message}` })
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
        const { data: walletData, error: walletError } = await supabase
            .from('user_wallets')
            .select('balance')
            .eq('email', email)
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
            .eq('email', email);

        if (updateError) {
            console.error("Error al actualizar el saldo:", updateError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "Error interno al procesar el pago." })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Pago con KingCoins procesado exitosamente.", newBalance: newBalance })
        };

    } catch (error) {
        console.error("Error en la función deduct-kingcoins:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor.", error: error.message })
        };
    }
};