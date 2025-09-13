// netlify/functions/get-invoice.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error("Faltan variables de entorno requeridas para get-invoice.");
        return { statusCode: 500, body: "Error de configuración del servidor." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    try {
        const transactionId = event.queryStringParameters.id;

        if (!transactionId) {
            return {
                statusCode: 400,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
                body: "Falta el ID de la transacción."
            };
        }

        const { data: transaction, error } = await supabase
            .from('transactions')
            .select('invoice_text_content')
            .eq('id_transaccion', transactionId)
            .single();

        if (error || !transaction || !transaction.invoice_text_content) {
            console.error("Error al obtener la factura de Supabase:", error ? error.message : "Factura no encontrada o vacía.");
            return {
                statusCode: 404,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
                body: "Factura no encontrada o no disponible."
            };
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: transaction.invoice_text_content
        };

    } catch (error) {
        console.error("Error en la función get-invoice:", error.message);
        return {
            statusCode: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: `Error interno del servidor: ${error.message}`
        };
    }
};