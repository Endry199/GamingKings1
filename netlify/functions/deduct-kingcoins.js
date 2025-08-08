// netlify/functions/deduct-kingcoins.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const { email, finalPrice } = JSON.parse(event.body);

        if (!email || !finalPrice) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: "Faltan parámetros requeridos (email o finalPrice)." })
            };
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // 1. Obtener el saldo del usuario
        const { data: walletData, error: walletError } = await supabase
            .from('user_wallets')
            .select('balance')
            .eq('email', email)
            .single();

        if (walletError || !walletData) {
            console.error("Error al buscar la billetera del usuario:", walletError || "No se encontró la billetera.");
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "No se encontró una billetera KGC asociada a tu cuenta." })
            };
        }

        const currentBalance = parseFloat(walletData.balance);
        const price = parseFloat(finalPrice);

        // 2. Verificar saldo suficiente
        if (currentBalance < price) {
            console.error(`Error: Saldo insuficiente. Saldo actual: ${currentBalance}, Precio: ${price}`);
            return {
                statusCode: 400,
                body: JSON.stringify({ message: `Saldo insuficiente para completar la compra.` })
            };
        }

        // 3. Restar el saldo
        const newBalance = currentBalance - price;
        const { error: updateError } = await supabase
            .from('user_wallets')
            .update({ balance: newBalance })
            .eq('email', email);

        if (updateError) {
            console.error("Error al actualizar el saldo de la billetera:", updateError);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "Error interno al procesar el pago." })
            };
        }

        console.log(`Saldo KGC deducido exitosamente. Nuevo saldo para ${email}: ${newBalance}`);

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