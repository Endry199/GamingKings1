// netlify/functions/plisio-webhook.js (MODIFICADO PARA INCLUIR BOTÓN DE REALIZADO Y WHATSAPP)
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const nodemailer = require('nodemailer'); 

// ⭐️ INICIO: FUNCIÓN DE NORMALIZACIÓN DEL NÚMERO DE WHATSAPP ⭐️
function normalizeWhatsappNumber(number) {
    if (!number) return null;

    // 1. Eliminar todos los caracteres no numéricos
    let cleanedNumber = number.replace(/[^\d]/g, '');

    // 2. Manejar prefijos comunes de Venezuela
    
    // Si empieza con '0412', '0414', etc. (Formato local con 0)
    // Se asume que el código de país (58) está implícito si el número tiene 11 dígitos.
    if (cleanedNumber.length === 11 && cleanedNumber.startsWith('0')) {
        // Quita el 0 y añade el 58. Ej: 04121234567 -> 584121234567
        return '58' + cleanedNumber.substring(1);
    }

    // Si empieza con '580412', '580414', etc. (Formato +58 con el 0 del código de área)
    if (cleanedNumber.length === 13 && cleanedNumber.startsWith('580')) {
        // Quita el 0 después del 58. Ej: 5804121234567 -> 584121234567
        return '58' + cleanedNumber.substring(3);
    }
    
    // Si ya empieza con '58' y tiene 12 dígitos, ya está correcto. Ej: 584121234567
    if (cleanedNumber.length === 12 && cleanedNumber.startsWith('58')) {
        return cleanedNumber;
    }
    
    // Si empieza con el código de área sin el 58. (Asumiendo 10 dígitos)
    if (cleanedNumber.length === 10 && (cleanedNumber.startsWith('412') || cleanedNumber.startsWith('424') || cleanedNumber.startsWith('414') || cleanedNumber.startsWith('416') || cleanedNumber.startsWith('426'))) {
        return '58' + cleanedNumber;
    }

    // Fallback: si no cumple el formato 58... pero está limpio y tiene al menos 10 dígitos
    if (cleanedNumber.length >= 10) {
        return cleanedNumber; 
    }

    return null; // Devuelve null si no es un número de teléfono válido/esperado
}
// ⭐️ FIN: FUNCIÓN DE NORMALIZACIÓN DEL NÚMERO DE WHATSAPP ⭐️


exports.handler = async (event, context) => {
    // 🚨 TRAZA 0: Verificamos si la función empieza a ejecutarse.
    console.log("TRAZA 0: Webhook recibido. Verificando método..."); 
    
    if (event.httpMethod !== "POST") {
        console.log(`TRAZA 0.1: Método incorrecto: ${event.httpMethod}. Retornando 405.`);
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Variables de Entorno ---
    const PLISIO_API_KEY = process.env.PLISIO_API_KEY; 
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = process.env.SMTP_PORT;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SENDER_EMAIL = process.env.SENDER_EMAIL || SMTP_USER;

    if (!PLISIO_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("TRAZA 0.2: Faltan variables de entorno esenciales.");
        return { statusCode: 500, body: "Error de configuración." };
    }
    
    // --- Parseo del Body (SOPORTE JSON) ---
    let rawBody = event.body;
    
    if (event.isBase64Encoded) {
        try {
            rawBody = Buffer.from(event.body, 'base64').toString('utf8');
        } catch (e) {
            console.error("TRAZA 1.2: ERROR FATAL al decodificar Base64.", e);
            return { statusCode: 500, body: "Failed to decode body." };
        }
    }
    
    let body = {}; // Objeto final con los datos

    try {
        body = JSON.parse(rawBody);
    } catch (e) {
        console.error("TRAZA 2.2: ERROR: Fallo al parsear JSON. Deteniendo.");
        return { statusCode: 400, body: "Invalid JSON body. Expected JSON due to ?json=true." };
    }
    // Fin Parseo

    // --- OBTENCIÓN DE DATOS CRÍTICOS ---
    const receivedHash = body.verify_hash; 
    // Se mantiene 'order_number' como la variable que contiene el ID de la transacción.
    // ASUMIMOS: Que si el order_number viene con un prefijo tipo MALOK-XXXXX, este prefijo está bien y solo es necesario cambiarlo en el front-end o en la generación de este ID. 
    // Aquí sólo lo usamos como una llave de búsqueda.
    const invoiceID = body.order_number; 
    const plisioTxnId = body.txn_id; // Guardar el ID interno de Plisio.
    const status = body.status;

    console.log(`TRAZA 3: Variables de Plisio obtenidas: OrderID=${invoiceID}, Status=${status}, Hash recibido=${receivedHash ? receivedHash.substring(0, 5) + '...' : 'N/A'}`);
    
    // --- 1. VERIFICACIÓN DE SEGURIDAD (HMAC-SHA1 de Plisio) ---
    
    if (!invoiceID) {
        console.error("TRAZA 5.1: ERROR: No se pudo obtener el Número de Orden (order_number) de Plisio. Deteniendo.");
        return { statusCode: 200, body: "Missing Plisio order_number." }; 
    }
    
    if (!receivedHash) {
         console.error(`TRAZA 5.2: ERROR: No se recibió verify_hash para OrderID: ${invoiceID}.`); 
         return { statusCode: 200, body: `Missing Plisio Security Hash (verify_hash).` };
    }
    
    // 🔑 IMPLEMENTACIÓN DEL MÉTODO DE VERIFICACIÓN DE PLISIO (Node.js/HMAC-SHA1)
    const ordered = { ...body };
    delete ordered.verify_hash; // Eliminar el hash recibido antes de stringificar
    
    const stringToHash = JSON.stringify(ordered);
    
    const hmac = crypto.createHmac('sha1', PLISIO_API_KEY);
    hmac.update(stringToHash);
    const generatedHash = hmac.digest('hex');

    if (generatedHash !== receivedHash) {
        console.error(`TRAZA 6: ERROR: Firma de Webhook de Plisio INVÁLIDA para OrderID: ${invoiceID}.`);
        console.error(`TRAZA 6.1: Generated Hash (Full): ${generatedHash}. Received Hash (Full): ${receivedHash}.`); 
        return { statusCode: 200, body: `Invalid Plisio Hash.` }; 
    }
    
    console.log(`TRAZA 7: Webhook de Plisio verificado exitosamente para OrderID: ${invoiceID}, Estado: ${status}`);
    
    // ----------------------------------------------------------------------
    // --- 2. PROCESAMIENTO DEL PAGO (COMPLETED/PENDING/FALLO) ---
    // ----------------------------------------------------------------------

    // --- 2a. Manejo de estados intermedios o de fallo ---
    if (status !== 'completed' && status !== 'amount_check') {
        
        let updateData = {};
        let needsDbUpdate = false;
        
        if (status === 'pending') {
             updateData.status = 'PENDIENTE DE CONFIRMACIÓN'; 
             needsDbUpdate = true;
        } else if (status === 'mismatch' || status === 'expired' || status === 'error' || status === 'cancelled') {
             updateData.status = `FALLO: ${status.toUpperCase()} (PLISIO)`;
             needsDbUpdate = true;
        } else {
             console.log("TRAZA 8.1: Estado intermedio (new, pending internal, cancelled duplicate). Fin.");
             return { statusCode: 200, body: "Webhook processed, no action needed for this status." };
        }
        
        if (needsDbUpdate) { 
            try {
                console.log(`TRAZA 8.2: Actualizando estado de fallo/intermedio en Supabase a: ${updateData.status}`);
                const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
                await supabase.from('transactions').update(updateData).eq('id_transaccion', invoiceID);
            } catch (e) {
                console.error("TRAZA 8.3: Error al actualizar estado intermedio:", e.message);
            }
        }
        
        return { statusCode: 200, body: "Webhook processed, non-completion event" };
    }
    
    // --- 2b. Manejo del estado COMPLETED/AMOUNT_CHECK ---
    console.log(`TRAZA 9: Pago CONFIRMADO para la orden: ${invoiceID}. Iniciando proceso de BD/Telegram.`);
    
    let transactionData;
    let injectionMessage = "";
    let normalizedWhatsapp = null; // Inicializar la variable

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { persistSession: false },
        });

        // 🔑 PASO A0: OBTENER LA TASA DE CAMBIO DINÁMICA
        let EXCHANGE_RATE = 1.0; 
        try {
            const { data: configData } = await supabase
                .from('configuracion_sitio')
                .select('tasa_dolar')
                .eq('id', 1)
                .maybeSingle();

            if (configData && configData.tasa_dolar > 0) {
                EXCHANGE_RATE = configData.tasa_dolar;
                console.log(`TRAZA 9.1: Tasa de dólar obtenida de DB: ${EXCHANGE_RATE}`);
            }
        } catch (e) {
            console.error("TRAZA 9.2: ERROR CRITICO al obtener configuración de DB:", e.message);
        }

        
        // a) BUSCAR LA TRANSACCIÓN EN SUPABASE (Incluir 'game', 'google_id' y 'base_amount')
        console.log(`TRAZA 10: Buscando transacción ${invoiceID} en Supabase.`);
        const { data: transactions, error: fetchError } = await supabase
            .from('transactions')
            .select('*, google_id, game, base_amount')
            .eq('id_transaccion', invoiceID)
            .maybeSingle(); 

        if (fetchError || !transactions) {
            console.error(`TRAZA 10.1: ERROR al buscar transacción en Supabase:`, fetchError ? fetchError.message : 'No encontrada');
            return { statusCode: 200, body: "DB Fetch Error/Transaction not found." };
        }
        
        transactionData = transactions;
        // ⭐️ NUEVO: Normalizar el número de WhatsApp ⭐️
        normalizedWhatsapp = normalizeWhatsappNumber(transactionData.whatsappNumber);

        // Destructuramos la nueva variable y mantenemos las viejas por si acaso
        const { google_id, game, "finalPrice": finalPrice, currency, base_amount } = transactionData;
        
        // 🔑 PASO A1: LÓGICA DE INYECCIÓN AUTOMÁTICA
        // Se mantiene 'Recarga de Saldo' ya que es un valor almacenado en la DB y cambiarlo rompería la lógica
        const IS_WALLET_RECHARGE = game === 'Recarga de Saldo';
        
        // Determinar el monto a inyectar
        let amountToInject; 
        if (IS_WALLET_RECHARGE && base_amount && parseFloat(base_amount) > 0) {
            amountToInject = parseFloat(base_amount); // Usar base_amount (sin comisión)
        } else {
            amountToInject = parseFloat(finalPrice); // Fallback: Usar finalPrice si no hay base_amount
        }

        console.log(`TRAZA 11: Transacción encontrada. Game: ${game}, Google ID: ${google_id}`);
        console.log(`TRAZA 11.0: Monto base (sin comisión): ${base_amount} USD. Monto a inyectar: ${amountToInject} USD.`);
        
        let newStatus = 'CONFIRMADO'; // Estado por defecto

        if (IS_WALLET_RECHARGE) {
             
            if (!google_id || isNaN(amountToInject) || amountToInject <= 0) {
                 injectionMessage = `\n\n❌ **ERROR DE INYECCIÓN DE SALDO (GamingKings):** Datos incompletos (Google ID: ${google_id}, Monto: ${amountToInject}). **¡REVISIÓN MANUAL REQUERIDA!**`;
                 newStatus = 'CONFIRMADO (ERROR SALDO)'; // Marcar con advertencia

            } else {
                 // Intenta la inyección atómica del saldo
                 try {
                     const { error: balanceUpdateError } = await supabase
                         .rpc('incrementar_saldo', { 
                             p_user_id: google_id, 
                             p_monto: amountToInject.toFixed(2)
                         }); 
                         
                     if (balanceUpdateError) {
                         console.error(`TRAZA 11.1: Fallo al inyectar saldo a ${google_id}. Msg: ${balanceUpdateError.message}.`);
                         injectionMessage = `\n\n❌ **ERROR CRÍTICO AL INYECTAR SALDO (GamingKings):** No se pudo actualizar la billetera del cliente. \n\n${balanceUpdateError.message}`;
                         newStatus = 'CONFIRMADO (ERROR SALDO)'; // Marcar con advertencia
                     } else {
                         console.log(`TRAZA 11.2: Inyección de saldo exitosa: $${amountToInject.toFixed(2)} USD para ${google_id}.`);
                         injectionMessage = `\n\n💰 **INYECCIÓN DE SALDO EXITOSA (GamingKings):** Se inyectaron **$${amountToInject.toFixed(2)} USD** a la billetera del cliente (\`${google_id}\`).`;
                         newStatus = 'REALIZADA'; // Completar automáticamente
                     }
                 } catch (e) {
                     console.error("TRAZA 11.3: Falló la llamada RPC para inyección de saldo.", e.message);
                     injectionMessage = `\n\n❌ **ERROR CRÍTICO AL INYECTAR SALDO (GamingKings):** Falló la RPC. Msg: ${e.message}`;
                     newStatus = 'CONFIRMADO (ERROR SALDO)'; // Marcar con advertencia
                 }
            }
        } else {
            // Si NO es recarga de saldo (es un producto), lo marcamos como CONFIRMADO
            injectionMessage = `\n\n🛒 **PRODUCTO PENDIENTE DE ENTREGA (GamingKings):** Transacción de **${game}**. El operador debe procesar el pedido.`;
            newStatus = 'CONFIRMADO';
        }
        
        // b) ACTUALIZAR EL ESTADO DE LA TRANSACCIÓN (FINAL)
        console.log(`TRAZA 12: Actualizando estado final a '${newStatus}' en Supabase.`);
        const { error: updateError } = await supabase
            .from('transactions')
            .update({ 
                status: newStatus, 
                "paymentMethod": `PLISIO (${body.currency || 'N/A'})`, 
                "completed_at": new Date().toISOString(),
                "methodDetails": { 
                    plisio_txn_id: plisioTxnId,
                    plisio_currency_paid: body.currency,
                    plisio_amount: body.amount,
                    plisio_hash: receivedHash
                }
            })
            .eq('id_transaccion', invoiceID);

        if (updateError) {
             console.error("TRAZA 12.1: Error al actualizar el estado de la transacción:", updateError.message);
             injectionMessage += `\n\n⚠️ **ADVERTENCIA (GamingKings):** Fallo al actualizar estado final en DB: ${updateError.message}`;
             newStatus = 'CONFIRMADO (ERROR DB)';
        }

        // c) PREPARAR Y ENVIAR LA NOTIFICACIÓN DETALLADA A TELEGRAM
        console.log("TRAZA 13: Preparando mensaje para Telegram.");
        
        let cartItems = [];
        if (transactionData.cartDetails && typeof transactionData.cartDetails === 'string') {
             try {
                 cartItems = JSON.parse(transactionData.cartDetails); 
             } catch (e) {
                 console.error("TRAZA 13.2: Error al parsear cartDetails de la BD:", e);
             }
        } 
        
        if (!Array.isArray(cartItems) || cartItems.length === 0) {
             // Fallback
             cartItems = [{
                 game: transactionData.game,
                 packageName: transactionData.packageName,
                 playerId: transactionData.playerId,
                 finalPrice: transactionData.finalPrice,
                 currency: transactionData.currency
             }];
        }
        
        // 💡 CAMBIO 1: Determinar el emoji según el estado final
        const emoji = newStatus === 'REALIZADA' ? '✅' : '🔔';
        // Reemplazo de Malok Recargas por GamingKings en el título del mensaje
        let messageText = `${emoji} *¡PAGO CONFIRMADO!* (GamingKings - Plisio) ${emoji}\n\n`; 
        messageText += `*ID de Transacción:* \`${invoiceID || 'N/A'}\`\n`;
        messageText += `*Estado Final:* \`${newStatus}\`\n`; // <--- Estado final
        messageText += `------------------------------------------------\n`;

        // ... [Lógica de listado de productos] ...
        cartItems.forEach((item, index) => {
            if (item.game || item.packageName || item.playerId) {
                messageText += `*📦 Producto ${cartItems.length > 1 ? index + 1 : ''}:*\n`;
                
                const game = item.game || 'N/A';
                const packageName = item.packageName || 'N/A';
                const playerId = item.playerId || 'N/A';
                
                messageText += `🎮 Juego/Servicio: *${game}*\n`;
                messageText += `📦 Paquete: *${packageName}*\n`;
                
                const robloxEmail = item.roblox_email || transactionData.roblox_email;
                const robloxPassword = item.roblox_password || transactionData.roblox_password;
                const codmEmail = item.codm_email || transactionData.codm_email;
                const codmPassword = item.codm_password || transactionData.codm_password;
                const codmVinculation = item.codm_vinculation || transactionData.codm_vinculation;

                if (game && game.toLowerCase().includes('roblox') && robloxEmail && robloxPassword) {
                     messageText += `📧 Correo Roblox: \`${robloxEmail}\`\n`;
                     messageText += `🔑 Contraseña Roblox: \`${robloxPassword}\`\n`;
                } else if (game && game.toLowerCase().includes('duty mobile') && codmEmail && codmPassword) {
                     messageText += `📧 Correo CODM: \`${codmEmail}\`\n`;
                     messageText += `🔑 Contraseña CODM: \`${codmPassword}\`\n`;
                     messageText += `🔗 Vinculación CODM: ${codmVinculation || 'N/A'}\n`;
                } else if (playerId && playerId !== 'N/A') {
                     messageText += `👤 ID de Jugador: *${playerId}*\n`;
                }
                
                const itemPrice = item.priceUSD || item.finalPrice || 'N/A'; 
                const itemCurrency = item.currency || transactionData.currency || 'USD';

                if (itemPrice !== 'N/A' && itemCurrency !== 'N/A') {
                     messageText += `💲 Precio (Est.): ${parseFloat(itemPrice).toFixed(2)} ${itemCurrency}\n`;
                }
                
                messageText += `------------------------------------------------\n`;
            }
        });

        // Información de Pago y Contacto (Global)
        messageText += `\n*RESUMEN DE PAGO (Plisio)*\n`;
        messageText += `💰 *Monto Recibido (Cripto):* *${body.amount || 'N/A'} ${body.currency || 'N/A'}*\n`; 
        messageText += `💵 *Monto de Orden (USD):* *${body.source_amount || 'N/A'} ${body.source_currency || 'N/A'}*\n`;
        messageText += `💳 Método de Pago: *PLISIO (${body.psys_cid || 'Cripto'})*\n`;
        messageText += `🆔 TXID Plisio: \`${plisioTxnId || 'N/A'}\`\n`;
        
        messageText += `\n*DETALLE DE PROCESAMIENTO*\n`;
        messageText += injectionMessage; // <--- Mensaje de inyección/alerta
        
        messageText += `\n*DATOS DEL CLIENTE (GamingKings)*\n`;
        messageText += `📧 Correo Cliente: ${transactionData.email || 'N/A'}\n`;
        if (transactionData.whatsappNumber) { 
             messageText += `📱 WhatsApp Cliente: ${transactionData.whatsappNumber}\n`;
             if (normalizedWhatsapp && normalizedWhatsapp !== transactionData.whatsappNumber) {
                 messageText += `(Número normalizado: ${normalizedWhatsapp})\n`;
             }
        }


        // 💡 CAMBIO 2: Lógica de generación del botón
        let replyMarkup = {};
        const inlineKeyboard = []; // Usaremos un array para construir los botones

        // 1. Botón de Marcar como REALIZADA (Solo si no fue automática)
        if (newStatus === 'CONFIRMADO') {
            console.log("TRAZA 13.5: Creando botón 'Marcar como REALIZADA' para producto pendiente.");
            inlineKeyboard.push([{ 
                text: '✅ Marcar como REALIZADA', 
                callback_data: `mark_done_${invoiceID}` 
            }]);
        }
        
        // 2. Botón de WhatsApp (Si el número se normalizó correctamente)
        if (normalizedWhatsapp) {
            console.log("TRAZA 13.6: Creando botón de WhatsApp con número normalizado.");
            const whatsappLink = `https://wa.me/${normalizedWhatsapp}`;
            // Agregamos este botón en una nueva fila
            inlineKeyboard.push([{ text: "💬 Contactar Cliente por WhatsApp", url: whatsappLink }]);
        }

        // 3. Ensamblar el replyMarkup si hay botones
        if (inlineKeyboard.length > 0) {
            replyMarkup = {
                inline_keyboard: inlineKeyboard
            };
        }


        const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        let telegramMessageResponse;
        
        console.log("TRAZA 14: Enviando mensaje final a Telegram.");
        
        try {
            telegramMessageResponse = await axios.post(telegramApiUrl, {
                chat_id: TELEGRAM_CHAT_ID,
                text: messageText,
                parse_mode: 'Markdown',
                reply_markup: Object.keys(replyMarkup).length > 0 ? replyMarkup : undefined // Enviar solo si hay botón
            });
            console.log("TRAZA 14.1: Mensaje de Telegram final enviado con éxito.");
            
            // d) ACTUALIZAR EL message_id en Supabase
            if (telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
                console.log("TRAZA 15: Actualizando Supabase con telegram_message_id.");
                await supabase
                    .from('transactions')
                    .update({ telegram_message_id: telegramMessageResponse.data.result.message_id })
                    .eq('id_transaccion', invoiceID);
                console.log("TRAZA 15.1: Transaction actualizada con telegram_message_id.");
            }

        } catch (telegramError) {
            console.error("TRAZA 14.2: ERROR: Fallo al enviar mensaje de Telegram.", telegramError.response ? telegramError.response.data : telegramError.message);
        }

        // e) Enviar Correo de Confirmación al Cliente (Si está configurado)
        if (transactionData.email && SMTP_HOST) {
             console.log("TRAZA 16: Enviando correo de confirmación al cliente.");
             const transporter = nodemailer.createTransport({
                 host: SMTP_HOST,
                 port: parseInt(SMTP_PORT, 10),
                 secure: parseInt(SMTP_PORT, 10) === 465,
                 auth: { user: SMTP_USER, pass: SMTP_PASS },
                 tls: { rejectUnauthorized: false }
             });
             
             // Aquí se reemplaza Malok Recargas por GamingKings
             const emailSubject = newStatus === 'REALIZADA' 
                 ? `✅ ¡Recarga ACREDITADA con GamingKings! Tu pedido #${invoiceID} está listo.`
                 : `✅ ¡Pago CONFIRMADO con GamingKings! Tu pedido #${invoiceID} está en proceso.`;
             
             // Se usa el valor de la orden que viene en el webhook (body.source_amount)
             // Aquí se reemplaza Malok Recargas por GamingKings
             const emailHtml = newStatus === 'REALIZADA'
                 ? `<p>Hola,</p><p>Tu pago de ${body.source_amount || 'N/A'} ${body.source_currency || 'USD'} ha sido confirmado y el saldo ha sido **acreditado automáticamente** a tu cuenta de GamingKings.</p><p>Gracias por tu compra en GamingKings.</p>`
                 : `<p>Hola,</p><p>Tu pago de ${body.source_amount || 'N/A'} ${body.source_currency || 'USD'} ha sido confirmado por la pasarela de Plisio. Tu pedido está siendo procesado por el equipo de GamingKings.</p><p>Gracias por tu compra en GamingKings.</p>`;
             
             const mailOptions = {
                 from: SENDER_EMAIL,
                 to: transactionData.email,
                 subject: emailSubject,
                 html: emailHtml,
             };
             
             await transporter.sendMail(mailOptions).catch(err => console.error("TRAZA 16.1: Error al enviar el correo de confirmación de Plisio:", err.message));
             console.log("TRAZA 17: Correo enviado/intento de envío completado.");
        }

    } catch (procError) {
        console.error("TRAZA 18: ERROR CRÍTICO durante el procesamiento de la orden de Plisio:", procError.message);
    }

    console.log("TRAZA FINAL: Webhook procesado. Retornando 200.");
    // SIEMPRE devolver 200 OK para indicarle a Plisio que el webhook fue recibido
    return { statusCode: 200, body: "Webhook processed" };
};