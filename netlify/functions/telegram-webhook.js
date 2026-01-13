const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const nodemailer = require('nodemailer');

exports.handler = async (event, context) => {
    // 📢 LOG 0: Entrada de la petición
    console.log("--- INICIO DE WEBHOOK TELEGRAM ---");

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno ---
    const {
        SUPABASE_URL,
        SUPABASE_SERVICE_KEY,
        TELEGRAM_BOT_TOKEN,
        SMTP_HOST,
        SMTP_PORT,
        SMTP_USER,
        SMTP_PASS
    } = process.env;

    // 🚨 LOG 1: Verificación de Variables
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TELEGRAM_BOT_TOKEN) {
        console.error("❌ FATAL: Faltan variables de entorno esenciales.");
        return { statusCode: 500, body: "Configuración incompleta." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        console.error("❌ ERROR: El body no es un JSON válido");
        return { statusCode: 400, body: "Invalid JSON" };
    }

    // ----------------------------------------------------------------------
    // 🔑 OBTENER TASA DE CAMBIO
    // ----------------------------------------------------------------------
    let EXCHANGE_RATE = 1.0;
    try {
        const { data: configData } = await supabase
            .from('configuracion_sitio')
            .select('tasa_dolar')
            .eq('id', 1)
            .maybeSingle();

        if (configData?.tasa_dolar > 0) {
            EXCHANGE_RATE = configData.tasa_dolar;
            console.log(`✅ Tasa obtenida: ${EXCHANGE_RATE}`);
        }
    } catch (e) {
        console.error("⚠️ No se pudo obtener la tasa, usando 1.0");
    }

    // ----------------------------------------------------------------------
    // 💡 PROCESAR CALLBACK DE TELEGRAM
    // ----------------------------------------------------------------------
    if (body.callback_query) {
        const callbackData = body.callback_query.data;
        const chatId = body.callback_query.message.chat.id;
        const messageId = body.callback_query.message.message_id;
        const originalText = body.callback_query.message.text || "";
        
        if (callbackData.startsWith('mark_done_')) {
            const transactionId = callbackData.replace('mark_done_', '').trim();
            console.log(`🚀 Procesando Transacción: ${transactionId}`);

            try {
                // 1. Buscar Transacción
                const { data: transactionData, error: fetchError } = await supabase
                    .from('transactions')
                    .select('status, google_id, finalPrice, currency, game, cartDetails, email')
                    .eq('id_transaccion', transactionId)
                    .maybeSingle();

                if (fetchError || !transactionData) {
                    throw new Error(`No existe la transacción ${transactionId} en la base de datos.`);
                }

                const { status, google_id, finalPrice, currency, game, email: transactionEmail } = transactionData;
                
                if (status === 'REALIZADA') {
                    console.log("ℹ️ La transacción ya estaba REALIZADA.");
                    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `⚠️ La transacción ${transactionId} ya fue procesada anteriormente.`, messageId);
                    return { statusCode: 200, body: "Already processed" };
                }

                let emailCliente = transactionEmail;
                let injectionMessage = "";
                let updateDBSuccess = true;
                let amountToInject = parseFloat(finalPrice);

                // 2. Lógica de Inyección de Saldo (Wallet)
                if (game === 'Recarga de Saldo') {
                    if (currency === 'VES' || currency === 'BS') {
                        amountToInject = amountToInject / EXCHANGE_RATE;
                        console.log(`💱 Conversión: ${finalPrice} VES -> ${amountToInject.toFixed(2)} USD`);
                    }

                    if (google_id && amountToInject > 0) {
                        const { error: rpcError } = await supabase.rpc('incrementar_saldo', {
                            p_user_id: google_id,
                            p_monto: amountToInject.toFixed(2)
                        });

                        if (rpcError) {
                            updateDBSuccess = false;
                            injectionMessage = `\n\n❌ <b>ERROR SALDO:</b> ${rpcError.message}`;
                        } else {
                            injectionMessage = `\n\n💰 <b>SALDO INYECTADO:</b> $${amountToInject.toFixed(2)} USD`;
                        }
                    } else {
                        updateDBSuccess = false;
                        injectionMessage = `\n\n❌ <b>ERROR:</b> Datos insuficientes para inyectar saldo.`;
                    }
                } else {
                    injectionMessage = `\n\n🛒 <b>PRODUCTO:</b> Entrega manual/digital confirmada.`;
                }

                // 3. Actualizar Estado en Supabase
                if (updateDBSuccess) {
                    const { error: updateError } = await supabase
                        .from('transactions')
                        .update({ status: 'REALIZADA' })
                        .eq('id_transaccion', transactionId);

                    if (updateError) throw new Error("Error al actualizar estado en DB: " + updateError.message);
                }

                // 4. Enviar Email de Factura
                if (updateDBSuccess && emailCliente) {
                    const subject = `✅ ¡Pedido Entregado! Factura #${transactionId} | GamingKings`;
                    const html = `
                        <div style="font-family: sans-serif;">
                            <h2 style="color: #28a745;">¡Hola! Tu pedido ha sido procesado exitosamente.</h2>
                            <p><b>ID Transacción:</b> ${transactionId}</p>
                            <p><b>Producto:</b> ${game}</p>
                            <p><b>Total:</b> ${finalPrice} ${currency}</p>
                            <hr>
                            <p>Gracias por confiar en <b>GamingKings</b>.</p>
                        </div>
                    `;
                    const sent = await sendInvoiceEmail(transactionId, emailCliente, subject, html);
                    injectionMessage += sent ? `\n📧 <b>EMAIL ENVIADO</b>` : `\n⚠️ <b>FALLO EMAIL</b>`;
                }

                // 5. Editar mensaje de Telegram
                const finalMarker = `\n\n✅ <b>ESTADO FINAL: REALIZADA</b>\n` +
                                   `<i>Por: Operador el ${new Date().toLocaleString('es-VE')}</i>` +
                                   injectionMessage;

                await editTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, messageId, originalText + finalMarker);
                console.log(`✅ Fin del proceso para ${transactionId}`);

            } catch (err) {
                console.error("❌ ERROR EN PROCESO:", err.message);
                await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `❌ <b>ERROR:</b> ${err.message}`, messageId);
            }
        }
    }

    return { statusCode: 200, body: "Processed" };
};

// --- FUNCIONES AUXILIARES ---

async function sendInvoiceEmail(id, to, subject, html) {
    const port = parseInt(process.env.SMTP_PORT, 10);
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        tls: { rejectUnauthorized: false }
    });

    try {
        await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, html });
        return true;
    } catch (e) {
        console.error("SMTP Error:", e.message);
        return false;
    }
}

async function editTelegramMessage(token, chatId, messageId, text) {
    try {
        await axios.post(`https://api.telegram.org/bot${token}/editMessageText`, {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (e) { console.error("Telegram Edit Error:", e.message); }
}

async function sendTelegramAlert(token, chatId, text, replyId) {
    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            reply_to_message_id: replyId
        });
    } catch (e) { console.error("Telegram Alert Error:", e.message); }
}