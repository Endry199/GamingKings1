// netlify/functions/process-payment.js
const axios = require('axios');
const { Formidable } = require('formidable');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream');

// Función para escapar caracteres especiales de MarkdownV2 para Telegram
function escapeMarkdownV2(text) {
    if (typeof text !== 'string') {
        text = String(text);
    }
    const specialChars = /[_*\[\]()~`>#+\-={}.!]/g;
    return text.replace(specialChars, '\\$&');
}

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    let fieldsData;
    let paymentReceiptFile;

    // --- Configuración de Supabase ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Parsing de FormData con formidable ---
    const form = new Formidable({ multiples: true });

    let bodyBuffer;
    if (event.isBase64Encoded) {
        bodyBuffer = Buffer.from(event.body, 'base64');
    } else {
        bodyBuffer = Buffer.from(event.body || '');
    }

    const reqStream = new Readable();
    reqStream.push(bodyBuffer);
    reqStream.push(null);

    reqStream.headers = event.headers;
    reqStream.method = event.httpMethod;

    try {
        if (event.headers['content-type'] && event.headers['content-type'].includes('multipart/form-data')) {
            const { fields, files } = await new Promise((resolve, reject) => {
                form.parse(reqStream, (err, fields, files) => {
                    if (err) {
                        console.error('Formidable parse error:', err);
                        return reject(err);
                    }
                    resolve({ fields, files });
                });
            });

            // Flatten fields data as formidable returns arrays
            fieldsData = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
            paymentReceiptFile = files['paymentReceipt'] ? files['paymentReceipt'][0] : null;

        } else if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
            fieldsData = JSON.parse(event.body);
        } else {
            const { parse } = require('querystring');
            fieldsData = parse(event.body);
        }
        console.log("DEBUG: fieldsData al inicio de la función:", fieldsData);
        console.log("DEBUG: whatsappNumber recibido:", fieldsData.whatsappNumber);
        // MODIFICACIÓN: Log del campo de email en ambos posibles nombres
        console.log("DEBUG: email recibido:", fieldsData.email);
        console.log("DEBUG: userEmail recibido:", fieldsData.userEmail);

    } catch (parseError) {
        console.error("Error al procesar los datos de la solicitud:", parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: `Error al procesar los datos de la solicitud: ${parseError.message || 'Unknown error'}. Por favor, verifica tus datos e inténtalo de nuevo.` })
        };
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const WHATSAPP_NUMBER_RECARGADOR = process.env.WHATSAPP_NUMBER_RECARGADOR;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseServiceKey || !WHATSAPP_NUMBER_RECARGADOR) {
        console.error("Faltan variables de entorno requeridas.");
        console.error(`Missing TELEGRAM_BOT_TOKEN: ${!TELEGRAM_BOT_TOKEN}`);
        console.error(`Missing TELEGRAM_CHAT_ID: ${!TELEGRAM_CHAT_ID}`);
        console.error(`Missing SUPABASE_URL: ${!supabaseUrl}`);
        console.error(`Missing SUPABASE_SERVICE_KEY: ${!supabaseServiceKey}`);
        console.error(`Missing WHATSAPP_NUMBER_RECARGADOR: ${!WHATSAPP_NUMBER_RECARGADOR}`);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error de configuración del servidor: Faltan credenciales o configuración inválida." })
        };
    }

    const {
        game,
        playerId,
        package: packageName,
        finalPrice,
        currency,
        paymentMethod,
        fullName,
        whatsappNumber,
        referenceNumber,
        txid
    } = fieldsData;

    // MODIFICACIÓN CLAVE: Obtener el email del campo correcto
    const email = fieldsData.email || fieldsData.userEmail;
    console.log("DEBUG: Email final usado para la transacción:", email);

    // MODIFICACIÓN: Limpiar packageName específicamente para la visualización en mensajes
    let cleanedDisplayPackageName = packageName;
    if (cleanedDisplayPackageName && cleanedDisplayPackageName.includes('<i class="fas fa-crown"></i>')) {
        cleanedDisplayPackageName = cleanedDisplayPackageName.replace('<i class="fas fa-crown"></i>', ' KingCoins');
    }

    let receiptUrl = null;
    let newTransactionData;
    let id_transaccion_generado;
    let transactionStatus = 'pendiente';

    try {
        id_transaccion_generado = `GMK-${Date.now()}`;

        if (paymentMethod === 'kingcoins') {
            console.log(`DEBUG: Procesando pago con KingCoins para el email: ${email}`);

            try {
                const deductionResponse = await axios.post('/.netlify/functions/deduct-kingcoins', {
                    email: email,
                    finalPrice: finalPrice
                });

                if (deductionResponse.status === 200) {
                    transactionStatus = 'completo';
                    console.log(`DEBUG: Pago con KGC procesado exitosamente a través de la nueva función.`);
                } else {
                    console.error("Error al deducir KGC:", deductionResponse.data);
                    return {
                        statusCode: deductionResponse.status,
                        body: JSON.stringify(deductionResponse.data)
                    };
                }
            } catch (deductionError) {
                console.error("Fallo en la llamada a la función deduct-kingcoins:", deductionError.response ? deductionError.response.data : deductionError.message);
                const errorData = deductionError.response ? deductionError.response.data : { message: "Error interno al procesar el pago con KingCoins." };
                return {
                    statusCode: deductionError.response ? deductionError.response.status : 500,
                    body: JSON.stringify(errorData)
                };
            }
        }

        if (paymentReceiptFile && paymentReceiptFile.filepath && game !== "TikTok") {
            console.log(`Intentando subir archivo: ${paymentReceiptFile.originalFilename} (${paymentReceiptFile.mimetype})`);
            
            // MODIFICACIÓN CRUCIAL: Lee el archivo directamente de la memoria sin usar 'fs'
            const fileBuffer = await paymentReceiptFile.toBuffer();
            
            const fileName = `${id_transaccion_generado}_${Date.now()}_${paymentReceiptFile.originalFilename}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('comprobantes')
                .upload(fileName, fileBuffer, {
                    contentType: paymentReceiptFile.mimetype,
                    upsert: false
                });

            if (uploadError) {
                console.error("Error al subir el comprobante a Supabase Storage:", uploadError);
            } else {
                const { data: publicUrlData } = supabase.storage
                    .from('comprobantes')
                    .getPublicUrl(fileName);
                receiptUrl = publicUrlData.publicUrl;
                console.log("Comprobante subido a Supabase Storage:", receiptUrl);
            }
        }

        const dataToInsert = {
            id_transaccion: id_transaccion_generado,
            game: game,
            package_name: packageName,
            final_price: parseFloat(finalPrice),
            currency: currency,
            payment_method: paymentMethod,
            email: email,
            status: transactionStatus,
            player_id: playerId || null,
            full_name: fullName || null,
            whatsapp_number: whatsappNumber || null,
            reference_number: referenceNumber || null,
            txid: txid || null,
            receipt_url: receiptUrl,
            telegram_chat_id: TELEGRAM_CHAT_ID,
        };

        const { data: insertedData, error: insertError } = await supabase
            .from('transactions')
            .insert(dataToInsert)
            .select();

        if (insertError) {
            console.error("DEBUG: Supabase insertError capturado directamente:", JSON.stringify(insertError, null, 2));
            throw insertError;
        }

        if (!insertedData || insertedData.length === 0) {
            console.error("DEBUG: Supabase insert successful but returned empty data. Response:", JSON.stringify({ insertedData, insertError }, null, 2));
            throw new Error("Supabase insert did not return expected data.");
        }

        newTransactionData = insertedData[0];
        console.log("Transacción guardada en Supabase con ID interno:", newTransactionData.id);

    } catch (supabaseError) {
        console.error("Error al guardar la transacción en Supabase (catch block):", JSON.stringify(supabaseError, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error al guardar la transacción en la base de datos." })
        };
    }

    let finalMessage = "Solicitud de pago recibida exitosamente. ¡Te enviaremos una confirmación pronto!";
    if (paymentMethod === 'kingcoins') {
        finalMessage = "¡Tu pago con KingCoins ha sido procesado y completado exitosamente! La recarga ha sido acreditada.";
    }

    let whatsappLinkCustomer = null;
    if (whatsappNumber && whatsappNumber.trim() !== '') {
        const customerNamePart = fullName && fullName.trim() !== '' ? `${fullName.split(' ')[0]}` : '';
        const greeting = customerNamePart ? `¡Hola ${customerNamePart}! 👋` : `¡Hola! 👋`;
        const gameAndPlayerId = (game && cleanedDisplayPackageName.includes('KingCoins'))
            ? ` para *${game}*`
            : (playerId ? ` para *${game}* (ID: \`${escapeMarkdownV2(playerId)}\`)` : ` para *${game}*`);

        let whatsappMessageCustomer = '';
        if (paymentMethod === 'kingcoins') {
            whatsappMessageCustomer = `
${greeting}

Tu recarga de *${escapeMarkdownV2(cleanedDisplayPackageName)}* ha sido *COMPLETADA* exitosamente. ¡Tu saldo ha sido actualizado!
`.trim();
        } else {
            whatsappMessageCustomer = `
${greeting}

Tu solicitud de recarga de *${escapeMarkdownV2(cleanedDisplayPackageName)}*${gameAndPlayerId} ha sido recibida y está siendo *PROCESADA* bajo el número de transacción: \`${escapeMarkdownV2(id_transaccion_generado)}\`.

Te enviaremos una notificación de confirmación cuando la recarga se haga efectiva. ¡Gracias por tu paciencia!
`.trim();
        }

        const customerWhatsappNumberFormatted = whatsappNumber.startsWith('+') ? whatsappNumber : `+${whatsappNumber}`;
        whatsappLinkCustomer = `https://wa.me/${customerWhatsappNumberFormatted}?text=${encodeURIComponent(whatsappMessageCustomer)}`;
        console.log("DEBUG: whatsappLinkCustomer generado para el cliente:", whatsappLinkCustomer);
    } else {
        console.log(`DEBUG: No se pudo generar whatsappLinkCustomer (cliente). whatsappNumber: '${whatsappNumber}'.`);
    }

    let whatsappLinkRecargador = null;
    if (game && game.toLowerCase() === 'free fire' && WHATSAPP_NUMBER_RECARGADOR) {
        const recargadorWhatsappNumberFormatted = WHATSAPP_NUMBER_RECARGADOR.startsWith('+') ? WHATSAPP_NUMBER_RECARGADOR : `+${WHATSAPP_NUMBER_RECARGADOR}`;
        const cleanedPackageNameForWhatsappRecargador = (cleanedDisplayPackageName || 'N/A').replace(/\+/g, '%2B');
        
        let whatsappMessageRecargador = `Hola. Por favor, realiza esta recarga lo antes posible.\n\n`;
        whatsappMessageRecargador += `*ID de Jugador:* ${playerId || 'N/A'}\n`;
        whatsappMessageRecargador += `*Paquete a Recargar:* ${cleanedPackageNameForWhatsappRecargador}\n`;

        whatsappLinkRecargador = `https://wa.me/${recargadorWhatsappNumberFormatted}?text=${encodeURIComponent(whatsappMessageRecargador)}`;
        console.log("DEBUG: whatsappLinkRecargador generado:", whatsappLinkRecargador);
    } else {
        console.log(`DEBUG: No se generará el enlace de WhatsApp para el recargador porque el juego no es Free Fire o falta WHATSAPP_NUMBER_RECARGADOR. Juego: ${game}`);
    }

    let messageText;
    let telegramMessageStatus = 'PENDIENTE';
    if (paymentMethod === 'kingcoins') {
        telegramMessageStatus = 'COMPLETADA (Automático)';
        messageText = `✅ *RECARGA COMPLETADA (KGC)* ✅\n\n`;
    } else {
        messageText = `✨ *NUEVA RECARGA PENDIENTE* ✨\n\n`;
    }

    messageText += `*ID de Transacción:* \`${escapeMarkdownV2(id_transaccion_generado || 'N/A')}\`\n`;
    messageText += `*Estado:* \`${escapeMarkdownV2(telegramMessageStatus)}\`\n\n`;
    messageText += `🎮 Juego: *${escapeMarkdownV2(game)}*\n`;

    if (game && !cleanedDisplayPackageName.includes('KingCoins')) {
        messageText += `👤 ID de Jugador: *${escapeMarkdownV2(playerId || 'N/A')}*\n`;
    }

    messageText += `📦 Paquete: *${escapeMarkdownV2(cleanedDisplayPackageName)}*\n`;
    messageText += `💰 Total a Pagar: *${escapeMarkdownV2(finalPrice)} ${escapeMarkdownV2(currency)}*\n`;
    messageText += `💳 Método de Pago: *${escapeMarkdownV2(paymentMethod.replace('-', ' ').toUpperCase())}*\n`;
    messageText += `📧 Correo Cliente: ${escapeMarkdownV2(email || 'N/A')}\n`;
    if (fullName) {
        messageText += `🧑‍💻 Nombre Cliente: ${escapeMarkdownV2(fullName)}\n`;
    }
    if (whatsappNumber) {
        messageText += `📱 WhatsApp Cliente: ${escapeMarkdownV2(whatsappNumber)}\n`;
    }

    if (paymentMethod === 'pago-movil' && referenceNumber) {
        messageText += `📊 Referencia Pago Móvil: ${escapeMarkdownV2(referenceNumber)}\n`;
    } else if (paymentMethod === 'binance' && txid) {
        messageText += `🆔 TXID Binance: ${escapeMarkdownV2(txid)}\n`;
    } else if (paymentMethod === 'zinli' && referenceNumber) {
        messageText += `📊 Referencia Zinli: ${referenceNumber}\n`;
    }

    // --- Lógica de botones de Telegram: SÓLO botones específicos ---
    let inlineKeyboard = [];

    if (paymentMethod === 'kingcoins') {
        inlineKeyboard.push([
            { text: "👑 Ver Transacción KGC", url: 'https://dashboard.gamingkings.com' }
        ]);
    } else if (game && game.toLowerCase() === 'free fire') {
        if (WHATSAPP_NUMBER_RECARGADOR) {
            const recargadorWhatsappNumberFormatted = WHATSAPP_NUMBER_RECARGADOR.startsWith('+') ? WHATSAPP_NUMBER_RECARGADOR : `+${WHATSAPP_NUMBER_RECARGADOR}`;
            const cleanedPackageNameForWhatsappRecargador = (cleanedDisplayPackageName || 'N/A').replace(/\+/g, '%2B');
            
            let whatsappMessageRecargador = `Hola. Por favor, realiza esta recarga lo antes posible.\n\n`;
            whatsappMessageRecargador += `*ID de Jugador:* ${playerId || 'N/A'}\n`;
            whatsappMessageRecargador += `*Paquete a Recargar:* ${cleanedPackageNameForWhatsappRecargador}\n`;

            const whatsappLinkRecargadorButton = `https://wa.me/${recargadorWhatsappNumberFormatted}?text=${encodeURIComponent(whatsappMessageRecargador)}`;

            inlineKeyboard.push([
                { text: "📲 WhatsApp Recargador", url: whatsappLinkRecargadorButton }
            ]);
        } else {
            console.log("Advertencia: WHATSAPP_NUMBER_RECARGADOR no está configurado para Free Fire. El botón no se mostrará.");
        }
    } else {
        console.log(`No se añadieron botones de acción para el juego ${game} y la transacción ${id_transaccion_generado} según la nueva política.`);
    }

    const replyMarkup = {
        inline_keyboard: inlineKeyboard
    };

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    let telegramMessageResponse;

    try {
        telegramMessageResponse = await axios.post(telegramApiUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: messageText,
            parse_mode: 'MarkdownV2',
            reply_markup: replyMarkup,
            disable_web_page_preview: true
        });
        console.log("Mensaje de Telegram con botones de acción enviado con éxito.");

        if (receiptUrl) {
            try {
                const sendFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;

                await axios.post(sendFileUrl, {
                    chat_id: TELEGRAM_CHAT_ID,
                    document: receiptUrl,
                    caption: escapeMarkdownV2(`Comprobante de pago para la transacción ${id_transaccion_generado}`),
                    parse_mode: 'MarkdownV2'
                });
                console.log("Comprobante de pago enviado a Telegram usando URL de Supabase.");
            } catch (fileSendError) {
                console.error("ERROR: Fallo al enviar el comprobante a Telegram desde URL:", fileSendError.response ? fileSendError.response.data : fileSendError.message);
            }
        }

        if (newTransactionData && telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
            const { data: updatedData, error: updateError } = await supabase
                .from('transactions')
                .update({ telegram_message_id: telegramMessageResponse.data.result.message_id })
                .eq('id', newTransactionData.id);

            if (updateError) {
                console.error("Error al actualizar la transacción en Supabase con telegram_message_id:", updateError.message);
            } else {
                console.log("Transaction actualizada en Supabase con telegram_message_id:", telegramMessageResponse.data.result.message_id);
            }
        }

    } catch (telegramError) {
        console.error("Error al enviar mensaje de Telegram o comprobante:", telegramError.response ? telegramError.response.data : telegramError.message);
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ message: finalMessage }),
    };
};