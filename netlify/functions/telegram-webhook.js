const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const nodemailer = require('nodemailer'); 

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        console.log("Method Not Allowed: Expected POST.");
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno y Cliente Supabase ---
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    // 🔑 VARIABLES DE CORREO
    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = process.env.SMTP_PORT;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;

    // 🚨 VERIFICACIÓN DE TODAS LAS VARIABLES ESENCIALES
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TELEGRAM_BOT_TOKEN || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
        console.error("FATAL ERROR: Faltan variables de entorno esenciales (DB, Telegram o SMTP).");
        return { statusCode: 500, body: "Error de configuración. Verifique SMTP y Supabase." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = JSON.parse(event.body);

    // ----------------------------------------------------------------------
    // 🔑 PASO 1: OBTENER LA TASA DE CAMBIO DINÁMICA
    // ----------------------------------------------------------------------
    let EXCHANGE_RATE = 1.0; 
    
    try {
        const { data: configData, error: configError } = await supabase
            .from('configuracion_sitio')
            .select('tasa_dolar')
            .eq('id', 1) 
            .maybeSingle();

        if (configError) {
            console.warn(`WARN DB: Fallo al obtener tasa de dólar. Usando tasa por defecto (1.0). Mensaje: ${configError.message}`);
        } else if (configData && configData.tasa_dolar > 0) {
            EXCHANGE_RATE = configData.tasa_dolar;
            console.log(`LOG: Tasa de dólar obtenida de DB: ${EXCHANGE_RATE}`);
        }
    } catch (e) {
        console.error("ERROR CRITICO al obtener configuración de DB:", e.message);
    }


    // ----------------------------------------------------------------------
    // 💡 LÓGICA CLAVE: Manejo de la consulta de Callback
    // ----------------------------------------------------------------------
    if (body.callback_query) {
        const callbackId = body.callback_query.id; // ID para quitar el parpadeo
        const callbackData = body.callback_query.data;
        const chatId = body.callback_query.message.chat.id;
        const messageId = body.callback_query.message.message_id;
        const originalText = body.callback_query.message.text;
        const transactionPrefix = 'mark_done_';
        
        // ✅ PASO CRÍTICO: Responder a Telegram inmediatamente para que el botón deje de parpadear
        await answerCallbackQuery(TELEGRAM_BOT_TOKEN, callbackId, "Procesando solicitud...");

        if (callbackData.startsWith(transactionPrefix)) {
            const transactionId = callbackData.replace(transactionPrefix, '');
            const NEW_STATUS = 'REALIZADA'; 
            
            console.log(`LOG: >>> INICIO PROCESO DE MARCADO. Transacción ID: ${transactionId} <<<`);
            
            let emailCliente = null; 

            try {
                // 2. BUSCAR LA TRANSACCIÓN
                console.log(`LOG: Buscando datos de transacción ${transactionId} en 'transactions'.`);
                const { data: transactionData, error: fetchError } = await supabase
                    .from('transactions')
                    .select('status, google_id, "finalPrice", currency, game, "cartDetails", email') 
                    .eq('id_transaccion', transactionId)
                    .maybeSingle();

                if (fetchError || !transactionData) {
                    console.error(`ERROR DB: Fallo al buscar la transacción ${transactionId}.`, fetchError ? fetchError.message : 'No encontrada');
                    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `❌ <b>Error:</b> No se encontró la transacción ${transactionId}.`, messageId);
                    return { statusCode: 200, body: "Processed" };
                }

                const { 
                    status: currentStatus, 
                    google_id, 
                    "finalPrice": finalPrice, 
                    currency,
                    game,
                    "cartDetails": productDetails,
                    email: transactionEmail 
                } = transactionData;
                
                emailCliente = transactionEmail; 

                console.log(`LOG: Transacción encontrada. Google ID: ${google_id}. Email en transac.: ${emailCliente || 'Nulo'}. Estado: ${currentStatus}.`);
                
                // 2.1. BÚSQUEDA SECUNDARIA SI EMAIL ES NULO
                if (!emailCliente && google_id) {
                    console.warn(`WARN: Email en transacción es nulo. Intentando buscar en tabla 'usuarios' usando google_id: ${google_id}.`);
                    const { data: userData, error: userError } = await supabase
                        .from('usuarios')
                        .select('email')
                        .eq('google_id', google_id)
                        .maybeSingle();

                    if (userError) {
                        console.error(`ERROR DB: Fallo al buscar el email del usuario ${google_id}. Mensaje: ${userError.message}`);
                    } else if (userData && userData.email) {
                        emailCliente = userData.email;
                        console.log(`LOG: ✅ Email de cliente encontrado (vía usuarios): ${emailCliente}`);
                    }
                }
                
                const IS_WALLET_RECHARGE = game === 'Recarga de Saldo';
                const amountInTransactionCurrency = parseFloat(finalPrice);
                let amountToInject = amountInTransactionCurrency;
                let injectionMessage = ""; 
                let updateDBSuccess = true; 

                // 3. LÓGICA DE INYECCIÓN
                if (currentStatus === NEW_STATUS) {
                    injectionMessage = "\n\n⚠️ <b>NOTA:</b> La transacción ya estaba en estado 'REALIZADA'. El saldo no fue inyectado de nuevo.";
                } else {
                    if (IS_WALLET_RECHARGE) { 
                        if (currency === 'VES' || currency === 'BS') { 
                            if (EXCHANGE_RATE > 0) {
                                amountToInject = amountInTransactionCurrency / EXCHANGE_RATE;
                                console.log(`LOG: Moneda VES detectada. Conversión: $${amountToInject.toFixed(2)} USD.`);
                            } else {
                                throw new Error("ERROR FATAL: Tasa de cambio no válida.");
                            }
                        } 

                        if (!google_id || isNaN(amountToInject) || amountToInject <= 0) {
                            injectionMessage = `\n\n❌ <b>ERROR DE INYECCIÓN DE SALDO:</b> Datos incompletos.`;
                            updateDBSuccess = false;
                        } else {
                            // 4. INYECTAR SALDO (RPC)
                            try {
                                const { error: balanceUpdateError } = await supabase
                                    .rpc('incrementar_saldo', { 
                                        p_user_id: google_id, 
                                        p_monto: amountToInject.toFixed(2)
                                    }); 
                                    
                                if (balanceUpdateError) {
                                    injectionMessage = `\n\n❌ <b>ERROR CRÍTICO AL INYECTAR SALDO:</b> ${balanceUpdateError.message}`;
                                    updateDBSuccess = false; 
                                    throw new Error("Fallo en la inyección de saldo.");
                                }
                                
                                injectionMessage = `\n\n💰 <b>INYECCIÓN DE SALDO EXITOSA:</b> Se inyectaron <b>$${amountToInject.toFixed(2)} USD</b>.`;
                            } catch (e) {
                                updateDBSuccess = false;
                                throw new Error(`Falló la inyección atómica (RPC).`); 
                            }
                        }
                    } else {
                        injectionMessage = `\n\n🛒 <b>PRODUCTO ENTREGADO ✅: No se requería inyección de saldo.</b>`;
                    }
                } 

                // 5. ACTUALIZACIÓN DEL ESTADO
                if (currentStatus !== NEW_STATUS && updateDBSuccess) {
                    const { error: updateError } = await supabase
                        .from('transactions')
                        .update({ status: NEW_STATUS })
                        .eq('id_transaccion', transactionId)
                        .in('status', ['pendiente', 'CONFIRMADO']); 
                    
                    if (updateError) {
                        injectionMessage += `\n\n⚠️ <b>ADVERTENCIA:</b> Fallo al actualizar estado: ${updateError.message}`;
                        updateDBSuccess = false; 
                    }
                }
                
                // 5.5. 📧 ENVÍO DE CORREO
                if (currentStatus !== NEW_STATUS && updateDBSuccess) {
                    if (emailCliente) {
                        const invoiceSubject = `✅ ¡Pedido Entregado! Factura #${transactionId} - ${game} | GamingKings`;
                        const productDetailHtml = `
                            <p style="font-size: 1.1em; color: #007bff; font-weight: bold;">Le confirmamos que todos los productos de su pedido han sido procesados y entregados con éxito.</p>
                            <p>Puede verificar el estado de su cuenta o billetera.</p>`;
                        
                        const invoiceBody = `
                            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                                <h2 style="color: #28a745;">✅ Transacción REALIZADA y Confirmada - GamingKings</h2>
                                <p>Su pedido <b>${transactionId}</b> ha sido procesado con éxito.</p>
                                <hr/>
                                ${productDetailHtml}
                                <hr/>
                                <h3 style="color: #007bff;">Resumen de la Factura:</h3>
                                <ul style="list-style: none; padding: 0;">
                                    <li><b>ID Transacción:</b> ${transactionId}</li>
                                    <li><b>Monto Pagado:</b> ${parseFloat(finalPrice).toFixed(2)} ${currency}</li>
                                    <li><b>Inyectado:</b> ${IS_WALLET_RECHARGE ? `$${amountToInject.toFixed(2)} USD` : 'N/A'}</li>
                                </ul>
                                <p>Gracias por preferir a GamingKings.</p>
                            </div>`;

                        const emailSent = await sendInvoiceEmail(transactionId, emailCliente, invoiceSubject, invoiceBody);
                        injectionMessage += emailSent ? `\n\n📧 <b>CORREO ENVIADO:</b> Factura enviada a <code>${emailCliente}</code>.` : `\n\n⚠️ <b>ERROR DE CORREO:</b> No se pudo enviar factura.`;
                    }
                }
                
                const finalStatusText = (currentStatus === NEW_STATUS || updateDBSuccess) ? NEW_STATUS : 'ERROR CRÍTICO';
                const finalStatusEmoji = (currentStatus === NEW_STATUS || updateDBSuccess) ? '✅' : '❌';

                // 6. EDICIÓN DEL MENSAJE DE TELEGRAM
                const statusMarker = `\n\n------------------------------------------------\n` +
                                     `${finalStatusEmoji} <b>ESTADO FINAL: ${finalStatusText}</b>\n` +
                                     `<i>Marcada por operador a las: ${new Date().toLocaleTimeString('es-VE')}</i> \n` +
                                     `------------------------------------------------` +
                                     injectionMessage; 

                await editTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, messageId, originalText + statusMarker, {});
                
            } catch (e) {
                console.error("ERROR FATAL en handler:", e.message);
                await editTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, messageId, `❌ <b>ERROR CRÍTICO</b><br/>Fallo: ${e.message}`, {});
            }
        }
    } 
    
    return { statusCode: 200, body: "Webhook processed" };
};

// ----------------------------------------------------------------------
// --- FUNCIONES AUXILIARES ---
// ----------------------------------------------------------------------

// ✅ NUEVA: Función para detener el parpadeo de los botones en Telegram
async function answerCallbackQuery(token, callbackQueryId, text = "") {
    const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
    try {
        await axios.post(url, {
            callback_query_id: callbackQueryId,
            text: text,
            show_alert: false
        });
    } catch (error) {
        console.error("ERROR TELEGRAM: answerCallbackQuery fallo", error.message);
    }
}

async function sendInvoiceEmail(transactionId, userEmail, emailSubject, emailBody) {
    const port = parseInt(process.env.SMTP_PORT, 10); 
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const mailOptions = { from: process.env.SMTP_USER, to: userEmail, subject: emailSubject, html: emailBody };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (e) {
        console.error(`ERROR EMAIL: ${e.message}`);
        return false;
    }
}

async function editTelegramMessage(token, chatId, messageId, text, replyMarkup) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/editMessageText`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'HTML', 
            reply_markup: replyMarkup
        });
    } catch (error) {
        console.error("ERROR TELEGRAM:", error.message);
    }
}

async function sendTelegramAlert(token, chatId, text, replyToMessageId = null) {
    const telegramApiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML', 
            reply_to_message_id: replyToMessageId 
        });
    } catch (error) {
        console.error("ERROR TELEGRAM ALERT:", error.message);
    }
}