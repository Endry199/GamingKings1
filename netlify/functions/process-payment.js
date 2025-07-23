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
    const specialChars = /[_*[\]()~`>#+\-={}.!]/g;
    return text.replace(specialChars, '\\$&');
}

exports.handler = async function(event, context) {
    console.log("FUNCTION START: process-payment.js initiated."); // Added for debugging flow
    if (event.httpMethod !== "POST") {
        console.log("METHOD NOT ALLOWED: Only POST method is accepted."); // Added for debugging flow
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
            console.log("DEBUG: Request is multipart/form-data. Parsing with formidable."); // Added for debugging flow
            const { fields, files } = await new Promise((resolve, reject) => {
                form.parse(reqStream, (err, fields, files) => {
                    if (err) {
                        console.error('ERROR: Formidable parse error:', err); // Added ERROR tag
                        return reject(err);
                    }
                    resolve({ fields, files });
                });
            });

            // Flatten fields data as formidable returns arrays
            fieldsData = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
            paymentReceiptFile = files['paymentReceipt'] ? files['paymentReceipt'][0] : null;
            console.log("DEBUG: Formidable parsing complete. fieldsData:", JSON.stringify(fieldsData)); // Added for debugging flow

        } else if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
            console.log("DEBUG: Request is application/json."); // Added for debugging flow
            fieldsData = JSON.parse(event.body);
        } else {
            console.log("DEBUG: Request is x-www-form-urlencoded."); // Added for debugging flow
            const { parse } = require('querystring');
            fieldsData = parse(event.body);
        }
        console.log("DEBUG: Parsed fieldsData:", fieldsData); // Consolidated console.log for parsed data
        console.log("DEBUG: whatsappNumber recibido:", fieldsData.whatsappNumber); // Original debug line
        console.log("DEBUG: fullName recibido:", fieldsData.fullName); // Original debug line

    } catch (parseError) {
        console.error("ERROR: Failed to parse request body:", parseError); // Added ERROR tag
        return {
            statusCode: 400,
            body: JSON.stringify({ message: `Error al procesar los datos de la solicitud: ${parseError.message || 'Unknown error'}. Por favor, verifica tus datos e inténtalo de nuevo.` })
        };
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const WHATSAPP_NUMBER_RECARGADOR = process.env.WHATSAPP_NUMBER_RECARGADOR;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseServiceKey || !WHATSAPP_NUMBER_RECARGADOR) {
        console.error("CONFIGURATION ERROR: Missing required environment variables."); // Added ERROR tag
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
        email, 
        fullName, 
        whatsappNumber, 
        referenceNumber, 
        txid 
    } = fieldsData;

    let receiptUrl = null;
    let invoiceText = null; // Variable para almacenar el texto de la factura
    let invoiceUrl = null; // Variable para la URL de la factura en Supabase Storage
    let newTransactionData;
    let id_transaccion_generado;

    try {
        id_transaccion_generado = `GMK-${Date.now()}`; 
        console.log(`DEBUG: Generated transaction ID: ${id_transaccion_generado}`); // Added debug log

        // --- Subir comprobante del cliente a Supabase Storage ---
        if (paymentReceiptFile && paymentReceiptFile.filepath && fs.existsSync(paymentReceiptFile.filepath) && game !== "TikTok") { // Added fs.existsSync check
            console.log(`DEBUG: Attempting to upload client receipt: ${paymentReceiptFile.originalFilename} (${paymentReceiptFile.mimetype})`); // More detailed debug log
            const fileBuffer = fs.readFileSync(paymentReceiptFile.filepath);
            const fileName = `${id_transaccion_generado}_comprobante_${Date.now()}_${paymentReceiptFile.originalFilename}`; // Changed filename for clarity
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('comprobantes') 
                .upload(fileName, fileBuffer, {
                    contentType: paymentReceiptFile.mimetype,
                    upsert: false 
                });

            if (uploadError) {
                console.error("ERROR: Supabase Storage upload failed for client receipt:", uploadError); // Added ERROR tag
            } else {
                const { data: publicUrlData } = supabase.storage
                    .from('comprobantes')
                    .getPublicUrl(fileName);
                receiptUrl = publicUrlData.publicUrl;
                console.log("DEBUG: Client receipt uploaded to Supabase Storage:", receiptUrl); // Added debug log
            }
        } else {
            console.log("DEBUG: No payment receipt file to upload or game is TikTok. Skipping receipt upload."); // Added debug log
        }

        // --- Generar la Factura como Texto Plano ---
        const now = new Date();
        const rechargeTime = now.toLocaleString('es-VE', { 
            hour: '2-digit', minute: '2-digit', second: '2-digit', 
            day: '2-digit', month: '2-digit', year: 'numeric' 
        });

        invoiceText = `
*FACTURA DE RECARGA - GamingKings*
    
-------------------------------------
*ID Transacción:* ${escapeMarkdownV2(id_transaccion_generado)}
*Fecha y Hora:* ${escapeMarkdownV2(rechargeTime)}
-------------------------------------
*Detalles del Cliente:*
Nombre Completo: ${escapeMarkdownV2(fullName || 'N/A')}
ID de Jugador: ${escapeMarkdownV2(playerId || 'N/A')}
Correo Electrónico: ${escapeMarkdownV2(email || 'N/A')}
Número WhatsApp: ${escapeMarkdownV2(whatsappNumber || 'N/A')}
-------------------------------------
*Detalles de la Recarga:*
Juego: ${escapeMarkdownV2(game)}
Paquete: ${escapeMarkdownV2(packageName)}
Monto: ${escapeMarkdownV2(finalPrice)} ${escapeMarkdownV2(currency)}
Método de Pago: ${escapeMarkdownV2(paymentMethod.replace('-', ' ').toUpperCase())}
${referenceNumber ? `Referencia/TXID: ${escapeMarkdownV2(referenceNumber)}` : ''}
${txid ? `TXID Binance: ${escapeMarkdownV2(txid)}` : ''}
-------------------------------------
¡Gracias por elegir GamingKings! Tu recarga está siendo procesada.
`;
        console.log("DEBUG: Invoice generated as plain text."); // Added debug log

        // --- Subir invoiceText a Supabase Storage como archivo .txt ---
        try {
            const invoiceFileName = `${id_transaccion_generado}_factura_${Date.now()}.txt`;
            // IMPORTANTE: Asegúrate de tener un bucket llamado 'facturas' en Supabase y que sea público para lectura.
            // Si quieres usar el bucket 'comprobantes', cambia 'facturas' por 'comprobantes' aquí y abajo.
            const { data: invoiceUploadData, error: invoiceUploadError } = await supabase.storage
                .from('facturas') 
                .upload(invoiceFileName, invoiceText, {
                    contentType: 'text/plain',
                    upsert: false 
                });

            if (invoiceUploadError) {
                console.error("ERROR: Supabase Storage upload failed for invoice text:", invoiceUploadError); // Added ERROR tag
            } else {
                const { data: invoicePublicUrlData } = supabase.storage
                    .from('facturas') // Usa el mismo bucket que arriba
                    .getPublicUrl(invoiceFileName);
                invoiceUrl = invoicePublicUrlData.publicUrl;
                console.log("DEBUG: Invoice text uploaded to Supabase Storage:", invoiceUrl); // Added debug log
            }
        } catch (uploadInvoiceError) {
            console.error("ERROR: Failed to upload invoice text to Supabase:", uploadInvoiceError); // Added ERROR tag
        }

        // --- PREPARANDO DATOS PARA LA INSERCIÓN ---
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
            invoice_url: invoiceUrl, // Almacena la URL de la factura de texto
        };
        console.log("DEBUG: Data prepared for Supabase insertion:", JSON.stringify(dataToInsert)); // Added debug log

        const { data: insertedData, error: insertError } = await supabase
            .from('transactions') 
            .insert(dataToInsert)
            .select(); 

        if (insertError) {
            console.error("ERROR: Supabase insertError captured:", JSON.stringify(insertError, null, 2)); // Added ERROR tag
            throw insertError; 
        }
        
        if (!insertedData || insertedData.length === 0) {
            console.error("ERROR: Supabase insert successful but returned empty data. Response:", JSON.stringify({ insertedData, insertError }, null, 2)); // Added ERROR tag
            throw new Error("Supabase insert did not return expected data.");
        }

        newTransactionData = insertedData[0];
        console.log("DEBUG: Transaction saved to Supabase with internal ID:", newTransactionData.id); // Added debug log

    } catch (supabaseError) {
        console.error("ERROR: Failed to save transaction to Supabase (catch block):", JSON.stringify(supabaseError, null, 2)); // Added ERROR tag
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error al guardar la transacción en la base de datos." })
        };
    }

    // --- INICIO DE SECCIÓN DE NOTIFICACIONES (Telegram y WhatsApp) ---
    try {
        console.log("DEBUG: Starting notification section."); // Added debug log
        let whatsappLinkCustomer = null;
        if (whatsappNumber && whatsappNumber.trim() !== '') {
            const customerNamePart = fullName && fullName.trim() !== '' ? `${fullName.split(' ')[0]}` : '';
            const greeting = customerNamePart ? `¡Hola ${customerNamePart}! 👋` : `¡Hola! 👋`;
            const gameAndPlayerId = playerId ? ` para *${escapeMarkdownV2(game)}* (ID: \`${escapeMarkdownV2(playerId)}\`)` : ` para *${escapeMarkdownV2(game)}*`;
            
            const whatsappMessageCustomer = `
${greeting}

Tu solicitud de recarga de *${escapeMarkdownV2(packageName)}*${gameAndPlayerId} ha sido recibida y está siendo *PROCESADA* bajo el número de transacción: \`${escapeMarkdownV2(id_transaccion_generado)}\`.

Te enviaremos una notificación de confirmación cuando la recarga se haga efectiva. ¡Gracias por tu paciencia!
${invoiceUrl ? `Puedes ver los detalles de tu factura aquí: ${invoiceUrl}` : ''}
            `.trim(); 
            const customerWhatsappNumberClean = whatsappNumber.replace(/\D/g, ''); 
            whatsappLinkCustomer = `https://wa.me/${customerWhatsappNumberClean}?text=${encodeURIComponent(whatsappMessageCustomer)}`;
            console.log("DEBUG: whatsappLinkCustomer generated for client:", whatsappLinkCustomer); // Added debug log
        } else {
            console.log(`DEBUG: No whatsappNumber provided. Skipping whatsappLinkCustomer generation.`); // Added debug log
        }

        let whatsappLinkRecargador = null;
        if (game && game.toLowerCase() === 'free fire' && WHATSAPP_NUMBER_RECARGADOR) {
            const recargadorWhatsappNumberClean = WHATSAPP_NUMBER_RECARGADOR.replace(/\D/g, ''); 
            const cleanedPackageName = (packageName || 'N/A').replace(/\+/g, '%2B');

            let whatsappMessageRecargador = `Hola. Por favor, realiza esta recarga lo antes posible.\n\n`;
            whatsappMessageRecargador += `*ID de Jugador:* ${escapeMarkdownV2(playerId || 'N/A')}\n`;
            whatsappMessageRecargador += `*Paquete a Recargar:* ${escapeMarkdownV2(cleanedPackageName)}\n`; 
            whatsappMessageRecargador += `*Monto:* ${escapeMarkdownV2(finalPrice)} ${escapeMarkdownV2(currency)}\n`;
            whatsappMessageRecargador += `*Método de Pago:* ${escapeMarkdownV2(paymentMethod.replace('-', ' ').toUpperCase())}\n`;
            whatsappMessageRecargador += `*ID Transacción:* \`${escapeMarkdownV2(id_transaccion_generado)}\`\n`;
            whatsappMessageRecargador += `*Comprobante:* ${receiptUrl ? escapeMarkdownV2(receiptUrl) : 'N/A'}\n\n`;
            whatsappMessageRecargador += `*Factura (Link):* ${invoiceUrl ? escapeMarkdownV2(invoiceUrl) : 'N/A'}`; // Incluye la URL de la factura
            
            whatsappLinkRecargador = `https://wa.me/${recargadorWhatsappNumberClean}?text=${encodeURIComponent(whatsappMessageRecargador)}`;
            console.log("DEBUG: whatsappLinkRecargador generated for recargador:", whatsappLinkRecargador); // Added debug log
        } else {
            console.log(`DEBUG: Skipping whatsappLinkRecargador because game is not Free Fire or WHATSAPP_NUMBER_RECARGADOR is missing. Game: ${game}`); // Added debug log
        }

        let messageText = `✨ *NUEVA RECARGA PENDIENTE* ✨\n\n`; 
        messageText += `*ID de Transacción:* \`${escapeMarkdownV2(id_transaccion_generado || 'N/A')}\`\n`;
        messageText += `*Estado:* \`PENDIENTE\`\n\n`;
        messageText += `🎮 Juego: *${escapeMarkdownV2(game)}*\n`;
        messageText += `👤 ID de Jugador: *${escapeMarkdownV2(playerId || 'N/A')}*\n`;
        messageText += `📦 Paquete: *${escapeMarkdownV2(packageName)}*\n`; 
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

        messageText += `\n*Factura (Link):* ${invoiceUrl ? escapeMarkdownV2(invoiceUrl) : 'N/A'}`; // Incluye la URL de la factura en el mensaje principal

        let inlineKeyboard = [];
        let currentRow = []; 

        if (whatsappLinkCustomer) {
            currentRow.push({ text: "💬 Chatear con el Cliente", url: whatsappLinkCustomer });
        }
        
        if (whatsappLinkRecargador) { 
            currentRow.push({ text: "📲 WhatsApp Recargador", url: whatsappLinkRecargador });
        }

        if (currentRow.length > 0) {
            inlineKeyboard.push(currentRow);
        }
        
        inlineKeyboard.push([{ text: "✅ Marcar como Realizada", callback_data: `mark_done_${id_transaccion_generado}` }]);
        
        // Añadir el nuevo botón para enviar la factura al cliente
        inlineKeyboard.push([{ text: "✉️ Enviar Factura a Cliente", callback_data: `send_invoice_to_customer_${id_transaccion_generado}` }]);


        const replyMarkup = {
            inline_keyboard: inlineKeyboard
        };

        const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        let telegramMessageResponse;

        try {
            console.log("DEBUG: Attempting to send main Telegram message."); // Added debug log
            telegramMessageResponse = await axios.post(telegramApiUrl, {
                chat_id: TELEGRAM_CHAT_ID,
                text: messageText,
                parse_mode: 'MarkdownV2', 
                reply_markup: replyMarkup,
                disable_web_page_preview: true
            });
            console.log("DEBUG: Main Telegram message with action buttons sent successfully."); // Added debug log

            // Envío del comprobante del cliente (si existe) como archivo
            if (receiptUrl) { 
                try {
                    console.log("DEBUG: Attempting to send client receipt to Telegram."); // Added debug log
                    const sendFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
                    
                    await axios.post(sendFileUrl, {
                        chat_id: TELEGRAM_CHAT_ID,
                        document: receiptUrl, 
                        caption: escapeMarkdownV2(`Comprobante de pago para la transacción ${id_transaccion_generado}`),
                        parse_mode: 'MarkdownV2'
                    });
                    console.log("DEBUG: Client receipt sent to Telegram using Supabase URL."); // Added debug log
                } catch (fileSendError) {
                    console.error("ERROR: Failed to send client receipt to Telegram from URL:", fileSendError.response ? fileSendError.response.data : fileSendError.message); // Added ERROR tag
                }
            }

            // Envío de la factura de texto como documento aparte en Telegram (opcional, pero buena práctica)
            if (invoiceUrl) {
                try {
                    console.log("DEBUG: Attempting to send invoice text to Telegram as document."); // Added debug log
                    const sendFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
                    
                    await axios.post(sendFileUrl, {
                        chat_id: TELEGRAM_CHAT_ID,
                        document: invoiceUrl, 
                        caption: escapeMarkdownV2(`Factura de recarga para la transacción ${id_transaccion_generado}`),
                        parse_mode: 'MarkdownV2'
                    });
                    console.log("DEBUG: Invoice text sent to Telegram using Supabase URL."); // Added debug log
                } catch (invoiceFileSendError) {
                    console.error("ERROR: Failed to send invoice text to Telegram from URL:", invoiceFileSendError.response ? invoiceFileSendError.response.data : invoiceFileSendError.message); // Added ERROR tag
                }
            }
            
            if (newTransactionData && telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
                const { data: updatedData, error: updateError } = await supabase
                    .from('transactions')
                    .update({ 
                        telegram_message_id: telegramMessageResponse.data.result.message_id,
                        invoice_url: invoiceUrl, // Asegura que la URL de la factura se actualice
                    })
                    .eq('id', newTransactionData.id); 

                if (updateError) {
                    console.error("ERROR: Failed to update transaction in Supabase with telegram_message_id/invoice_url:", updateError.message); // Added ERROR tag
                } else {
                    console.log("DEBUG: Transaction updated in Supabase with telegram_message_id and invoice_url."); // Added debug log
                }
            }

        } catch (telegramError) {
            console.error("ERROR: Error sending Telegram message or receipt:", telegramError.response ? telegramError.response.data : telegramError.message); // Consolidated ERROR tag and message
        }
    } catch (notificationSectionRootError) {
        console.error("ERROR: An unhandled error occurred in the overall notification section:", notificationSectionRootError.message);
        if (notificationSectionRootError.stack) {
            console.error("ERROR STACK:", notificationSectionRootError.stack);
        }
    }
    // --- FIN DE SECCIÓN DE NOTIFICACIONES ---

    // Limpiar archivo temporal si existe
    if (paymentReceiptFile && paymentReceiptFile.filepath && fs.existsSync(paymentReceiptFile.filepath)) {
        try {
            fs.unlinkSync(paymentReceiptFile.filepath);
            console.log("DEBUG: Temporary receipt file deleted."); // Added debug log
        } catch (unlinkError) {
            console.error("ERROR: Failed to delete temporary receipt file:", unlinkError); // Added ERROR tag
        }
    }

    console.log("FUNCTION END: process-payment.js finished."); // Added for debugging flow
    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Solicitud de pago recibida exitosamente. ¡Te enviaremos una confirmación pronto!" }),
    };
};