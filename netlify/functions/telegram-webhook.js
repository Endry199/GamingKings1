const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const nodemailer = require('nodemailer'); 

exports.handler = async (event, context) => {
    console.log("--- 🚀 INICIO DE EJECUCIÓN DEL WEBHOOK ---");

    // --- VALIDACIÓN DE MÉTODO ---
    if (event.httpMethod !== "POST") {
        console.warn(`[!] Intento de acceso con método no permitido: ${event.httpMethod}`);
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- VARIABLES DE ENTORNO ---
    const {
        SUPABASE_URL,
        SUPABASE_SERVICE_KEY,
        TELEGRAM_BOT_TOKEN,
        SMTP_HOST,
        SMTP_PORT,
        SMTP_USER,
        SMTP_PASS
    } = process.env;

    console.log("--- 🛠️ VERIFICANDO CONFIGURACIÓN DE ENTORNO ---");
    const envVars = { SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS };
    
    for (const [key, value] of Object.entries(envVars)) {
        if (!value) {
            console.error(`❌ FATAL ERROR: La variable de entorno ${key} está vacía o no definida.`);
            return { statusCode: 500, body: `Error de configuración: ${key} faltante.` };
        }
    }
    console.log("✅ Variables de entorno verificadas correctamente.");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    let body;
    try {
        body = JSON.parse(event.body);
        console.log("📦 CUERPO DEL WEBHOOK RECIBIDO:", JSON.stringify(body, null, 2));
    } catch (err) {
        console.error("❌ ERROR: No se pudo parsear el cuerpo del evento como JSON.", err.message);
        return { statusCode: 400, body: "Invalid JSON" };
    }

    // ----------------------------------------------------------------------
    // 🔑 PASO 1: OBTENER LA TASA DE CAMBIO DINÁMICA
    // ----------------------------------------------------------------------
    let EXCHANGE_RATE = 1.0; 
    console.log("--- 💵 CONSULTANDO TASA DE CAMBIO ---");
    
    try {
        const { data: configData, error: configError } = await supabase
            .from('configuracion_sitio')
            .select('tasa_dolar')
            .eq('id', 1) 
            .maybeSingle();

        if (configError) {
            console.warn(`⚠️ WARN DB: Error al consultar tasa_dolar. Usando 1.0. Detalle: ${configError.message}`);
        } else if (configData && configData.tasa_dolar > 0) {
            EXCHANGE_RATE = configData.tasa_dolar;
            console.log(`✅ Tasa de dólar obtenida: ${EXCHANGE_RATE}`);
        } else {
            console.log("ℹ️ No se encontró configuración específica, se mantiene tasa 1.0");
        }
    } catch (e) {
        console.error("❌ ERROR CRÍTICO obteniendo configuración:", e.message);
    }

    // ----------------------------------------------------------------------
    // 💡 LÓGICA CLAVE: Manejo de la consulta de Callback
    // ----------------------------------------------------------------------
    if (body.callback_query) {
        console.log("--- 🔘 DETECTADO CALLBACK_QUERY DE TELEGRAM ---");
        const callbackId = body.callback_query.id;
        const callbackData = body.callback_query.data;
        const chatId = body.callback_query.message.chat.id;
        const messageId = body.callback_query.message.message_id;
        const originalText = body.callback_query.message.text;
        const transactionPrefix = 'mark_done_';
        
        // Responder al callback inmediatamente para quitar el reloj de arena en Telegram
        console.log(`LOG: Respondiendo al callback_id: ${callbackId}`);
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackId,
            text: "Procesando actualización..."
        }).catch(err => console.warn("⚠️ No se pudo responder answerCallbackQuery:", err.message));

        if (callbackData.startsWith(transactionPrefix)) {
            const transactionId = callbackData.replace(transactionPrefix, '');
            const NEW_STATUS = 'REALIZADA'; 
            
            console.log(`\n>>> 🟢 INICIO PROCESO DE MARCADO [ID: ${transactionId}] <<<`);
            
            let emailCliente = null; 

            try {
                // 2. BUSCAR LA TRANSACCIÓN
                console.log(`LOG [${transactionId}]: Buscando registro en tabla 'transactions'...`);
                const { data: transactionData, error: fetchError } = await supabase
                    .from('transactions')
                    .select('status, google_id, "finalPrice", currency, game, "cartDetails", email') 
                    .eq('id_transaccion', transactionId)
                    .maybeSingle();

                if (fetchError) {
                    console.error(`❌ ERROR DB [${transactionId}]:`, fetchError.message);
                    throw fetchError;
                }

                if (!transactionData) {
                    console.error(`❌ ERROR: Transacción ${transactionId} no existe en la DB.`);
                    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `❌ <b>Error:</b> La transacción <code>${transactionId}</code> no existe.`, messageId);
                    return { statusCode: 200, body: "Not Found" };
                }

                const { 
                    status: currentStatus, 
                    google_id, 
                    "finalPrice": finalPrice, 
                    currency,
                    game,
                    email: transactionEmail 
                } = transactionData;
                
                emailCliente = transactionEmail; 
                console.log(`✅ Datos recuperados: Juego: ${game} | Monto: ${finalPrice} ${currency} | Usuario: ${google_id} | Status actual: ${currentStatus}`);

                // 2.1. BÚSQUEDA SECUNDARIA DE EMAIL
                if (!emailCliente && google_id) {
                    console.log(`LOG [${transactionId}]: Email vacío en transacción. Buscando en tabla 'usuarios' para google_id: ${google_id}`);
                    const { data: userData, error: userError } = await supabase
                        .from('usuarios')
                        .select('email')
                        .eq('google_id', google_id)
                        .maybeSingle();

                    if (userError) {
                        console.error(`⚠️ Error buscando email de usuario: ${userError.message}`);
                    } else if (userData?.email) {
                        emailCliente = userData.email;
                        console.log(`✅ Email recuperado de tabla usuarios: ${emailCliente}`);
                    } else {
                        console.warn(`⚠️ No se encontró email para el usuario ${google_id} en ninguna tabla.`);
                    }
                }
                
                const IS_WALLET_RECHARGE = (game === 'Recarga de Saldo' || game === 'GK USD'); 
                console.log(`LOG [${transactionId}]: ¿Es recarga de saldo?: ${IS_WALLET_RECHARGE}`);

                const amountInTransactionCurrency = parseFloat(finalPrice);
                let amountToInject = amountInTransactionCurrency;
                let injectionMessage = ""; 
                let updateDBSuccess = true; 

                // -------------------------------------------------------------
                // 3. LÓGICA DE INYECCIÓN CONDICIONAL 
                // -------------------------------------------------------------
                if (currentStatus === NEW_STATUS) {
                    console.log(`ℹ️ [${transactionId}]: La transacción ya estaba REALIZADA. Saltando inyección.`);
                    injectionMessage = "\n\n⚠️ <b>NOTA:</b> Transacción ya procesada previamente. No se duplicó el saldo.";
                } else {
                    if (IS_WALLET_RECHARGE) { 
                        console.log(`--- 💰 PROCESANDO INYECCIÓN DE SALDO ---`);
                        
                        // Conversión de moneda
                        if (currency === 'VES' || currency === 'BS') { 
                            if (EXCHANGE_RATE > 0) {
                                amountToInject = amountInTransactionCurrency / EXCHANGE_RATE;
                                console.log(`🔄 Conversión: ${amountInTransactionCurrency} ${currency} / ${EXCHANGE_RATE} = $${amountToInject.toFixed(2)} USD`);
                            } else {
                                console.error("❌ ERROR: Tasa de cambio inválida para conversión VES/BS.");
                                throw new Error("Tasa de cambio inválida.");
                            }
                        } 

                        // Validación de datos para inyección
                        if (!google_id || isNaN(amountToInject) || amountToInject <= 0) {
                            console.error(`❌ Datos insuficientes: google_id=${google_id}, amount=${amountToInject}`);
                            injectionMessage = `\n\n❌ <b>ERROR DE INYECCIÓN:</b> Datos inválidos o Google ID ausente.`;
                            updateDBSuccess = false;
                        } else {
                            console.log(`🚀 Ejecutando RPC 'incrementar_saldo' para ${google_id} con monto $${amountToInject.toFixed(2)}`);
                            
                            const { error: balanceUpdateError } = await supabase.rpc('incrementar_saldo', { 
                                p_user_id: google_id, 
                                p_monto: amountToInject.toFixed(2)
                            }); 
                                    
                            if (balanceUpdateError) {
                                console.error(`❌ Error RPC: ${balanceUpdateError.message}`);
                                injectionMessage = `\n\n❌ <b>ERROR RPC:</b> ${balanceUpdateError.message}`;
                                updateDBSuccess = false; 
                                throw new Error(`Fallo en RPC: ${balanceUpdateError.message}`);
                            }
                            
                            console.log(`✅ Saldo inyectado exitosamente en DB.`);
                            injectionMessage = `\n\n💰 <b>INYECCIÓN EXITOSA:</b> Se inyectaron <b>$${amountToInject.toFixed(2)} USD</b> a <code>${google_id}</code>.`;
                        }
                    } else {
                        console.log(`🛒 [${transactionId}]: Es un producto físico/digital. No requiere inyección automática.`);
                        injectionMessage = `\n\n🛒 <b>PRODUCTO LISTO ✅:</b> Marcado para entrega.`;
                    }
                } 

                // 5. ACTUALIZACIÓN DEL ESTADO DE LA TRANSACCIÓN
                if (currentStatus !== NEW_STATUS && updateDBSuccess) {
                    console.log(`--- 📝 ACTUALIZANDO STATUS A REALIZADA ---`);
                    const { error: updateError } = await supabase
                        .from('transactions')
                        .update({ status: NEW_STATUS })
                        .eq('id_transaccion', transactionId)
                        .in('status', ['pendiente', 'CONFIRMADO', 'PENDIENTE']); 
                    
                    if (updateError) {
                        console.error(`❌ Error al actualizar estado: ${updateError.message}`);
                        injectionMessage += `\n\n⚠️ <b>ERROR DB:</b> No se pudo cambiar el estado a REALIZADA.`;
                        updateDBSuccess = false; 
                    } else {
                        console.log(`✅ Transacción ${transactionId} actualizada a REALIZADA.`);
                    }
                }
                
                // 5.5. 📧 ENVÍO DE CORREO
                if (updateDBSuccess && emailCliente) {
                    console.log(`--- 📧 INICIANDO ENVÍO DE EMAIL ---`);
                    const invoiceSubject = `✅ ¡Pedido Entregado! #${transactionId} - GamingKings`;
                    const invoiceBody = `
                        <div style="font-family: sans-serif; border: 1px solid #ddd; padding: 20px;">
                            <h2 style="color: #28a745;">¡Hola! Tu pedido ha sido procesado</h2>
                            <p>Tu transacción <b>#${transactionId}</b> ha sido completada por un operador.</p>
                            <hr>
                            <p><b>Resumen:</b></p>
                            <ul>
                                <li>Servicio: ${game}</li>
                                <li>Monto: ${amountInTransactionCurrency.toFixed(2)} ${currency}</li>
                                ${IS_WALLET_RECHARGE ? `<li>Saldo cargado: $${amountToInject.toFixed(2)} USD</li>` : ''}
                            </ul>
                            <p>Gracias por confiar en <b>GamingKings</b>.</p>
                        </div>`;

                    const emailSent = await sendInvoiceEmail(transactionId, emailCliente, invoiceSubject, invoiceBody);
                    injectionMessage += emailSent ? `\n📧 Correo enviado a <code>${emailCliente}</code>.` : `\n⚠️ Fallo al enviar correo.`;
                }
                
                // 6. FINALIZAR EN TELEGRAM
                const finalStatusText = updateDBSuccess ? 'REALIZADA' : 'ERROR';
                const finalStatusEmoji = updateDBSuccess ? '✅' : '❌';

                console.log(`--- 📱 EDITANDO MENSAJE EN TELEGRAM ---`);
                const statusMarker = `\n\n------------------------------------------------\n` +
                                     `${finalStatusEmoji} <b>ESTADO FINAL: ${finalStatusText}</b>\n` +
                                     `<i>Operador: ${body.callback_query.from.first_name || 'Admin'}</i>\n` +
                                     `<i>Fecha: ${new Date().toLocaleString('es-VE')}</i>\n` +
                                     `------------------------------------------------` +
                                     injectionMessage; 

                await editTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, messageId, originalText + statusMarker);
                console.log(`>>> 🏁 FIN PROCESO [ID: ${transactionId}] <<<`);
                
            } catch (e) {
                console.error(`💥 ERROR CRÍTICO EN EL FLUJO [${transactionId}]:`, e.message);
                await sendTelegramAlert(TELEGRAM_BOT_TOKEN, chatId, `💥 <b>ERROR CRÍTICO:</b> <code>${e.message}</code>\nID: <code>${transactionId}</code>`, messageId);
            }
        }
    } 
    
    return { statusCode: 200, body: "Webhook processed" };
};


// ----------------------------------------------------------------------
// --- FUNCIONES AUXILIARES CON LOGS DETALLADOS ---
// ----------------------------------------------------------------------

async function sendInvoiceEmail(transactionId, userEmail, emailSubject, emailBody) {
    const port = parseInt(process.env.SMTP_PORT, 10); 
    console.log(`[SMTP] Configurando transporte: ${process.env.SMTP_HOST}:${port} (User: ${process.env.SMTP_USER})`);

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        tls: { rejectUnauthorized: false }
    });

    try {
        console.log(`[SMTP] Enviando mail a ${userEmail}...`);
        let info = await transporter.sendMail({
            from: `"GamingKings" <${process.env.SMTP_USER}>`,
            to: userEmail,               
            subject: emailSubject,
            html: emailBody,             
        });
        console.log(`[SMTP] ✅ Éxito. ID: ${info.messageId}`);
        return true;
    } catch (e) {
        console.error(`[SMTP] ❌ Error enviando email:`, e.message);
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
        console.log("[Telegram] ✅ Mensaje editado correctamente.");
    } catch (error) {
        console.error("[Telegram] ❌ Error editando mensaje:", error.response?.data || error.message);
    }
}

async function sendTelegramAlert(token, chatId, text, replyToMessageId = null) {
    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML', 
            reply_to_message_id: replyToMessageId 
        });
        console.log("[Telegram] ✅ Alerta enviada.");
    } catch (error) {
        console.error("[Telegram] ❌ Error enviando alerta:", error.response?.data || error.message);
    }
}