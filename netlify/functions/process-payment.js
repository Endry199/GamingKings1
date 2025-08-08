// netlify/functions/process-payment.js
const axios = require('axios');
const { Formidable } = require('formidable');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream');
const fs = require('fs');

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
    
    try {
        const bodyBuffer = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '');
        const reqStream = new Readable();
        reqStream.push(bodyBuffer);
        reqStream.push(null);
        reqStream.headers = event.headers;
        reqStream.method = event.httpMethod;

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
    } catch (parseError) {
        console.error("Error al procesar los datos de la solicitud:", parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: `Error al procesar los datos de la solicitud: ${parseError.message || 'Unknown error'}.` })
        };
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const WHATSAPP_NUMBER_RECARGADOR = process.env.WHATSAPP_NUMBER_RECARGADOR;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseServiceKey) {
        console.error("Faltan variables de entorno requeridas.");
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

    const email = fieldsData.email || fieldsData.userEmail;
    console.log("DEBUG: Email final usado para la transacción:", email);

    let cleanedDisplayPackageName = packageName;
    if (cleanedDisplayPackageName && cleanedDisplayPackageName.includes('<i class="fas fa-crown"></i>')) {
        cleanedDisplayPackageName = cleanedDisplayPackageName.replace('<i class="fas fa-crown"></i>', ' KingCoins');
    }

    let receiptUrl = null;
    let newTransactionData;
    let id_transaccion_generado;

    try {
        id_transaccion_generado = `GMK-${Date.now()}`;

        // MODIFICACIÓN CLAVE: NO subir el comprobante si el método de pago es KingCoins
        if (paymentReceiptFile && paymentReceiptFile.filepath && game !== "TikTok" && paymentMethod.toLowerCase() !== 'kingcoins') {
            console.log(`Intentando subir archivo: ${paymentReceiptFile.originalFilename} (${paymentReceiptFile.mimetype})`);
            const fileBuffer = fs.readFileSync(paymentReceiptFile.filepath);
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
        } else if (paymentMethod.toLowerCase() === 'kingcoins') {
            console.log("DEBUG: El método de pago es KingCoins, no se sube comprobante.");
        }

        const dataToInsert = {
            id_transaccion: id_transaccion_generado,
            game: game,
            package_name: packageName,
            final_price: parseFloat(finalPrice),
            currency: currency,
            payment_method: paymentMethod,
            email: email,
            status: 'pendiente',
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

    let messageText = `✨ *NUEVA RECARGA PENDIENTE* ✨\n\n`;
    messageText += `*ID de Transacción:* \`${escapeMarkdownV2(id_transaccion_generado || 'N/A')}\`\n`;
    messageText += `*Estado:* \`PENDIENTE\`\n\n`;
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
        messageText += `📊 Referencia Zinli: ${escapeMarkdownV2(referenceNumber)}\n`;
    }

    let inlineKeyboard = [];

    if (cleanedDisplayPackageName && cleanedDisplayPackageName.includes('KingCoins')) {
        inlineKeyboard.push([
            { text: "👑 Liberar KingCoins", callback_data: `release_kingcoins_${id_transaccion_generado}` }
        ]);
    } else if (game && game.toLowerCase() === 'free fire' && WHATSAPP_NUMBER_RECARGADOR) {
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
        console.log(`No se añadieron botones de acción para el juego ${game} y la transacción ${id_transaccion_generado}.`);
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

    if (paymentReceiptFile && paymentReceiptFile.filepath && fs.existsSync(paymentReceiptFile.filepath)) {
        try {
            fs.unlinkSync(paymentReceiptFile.filepath);
            console.log("Archivo temporal del comprobante eliminado al finalizar la función.");
        } catch (unlinkError) {
            console.error("Error al eliminar el archivo temporal del comprobante:", unlinkError);
        }
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Solicitud de pago recibida exitosamente. ¡Te enviaremos una confirmación pronto!" }),
    };
};