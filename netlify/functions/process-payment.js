// netlify/functions/process-payment.js
const axios = require('axios');
const { Formidable } = require('formidable');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream');
const fs = require('fs');
const nodeHtmlToImage = require('node-html-to-image');
const path = require('path');

// Función para escapar caracteres especiales de MarkdownV2 para Telegram
function escapeMarkdownV2(text) {
    if (typeof text !== 'string') {
        text = String(text);
    }
    const specialChars = /[_*\[\]()~`>#+\-={}.!]/g;
    return text.replace(specialChars, '\\$&');
}

exports.handler = async function(event, context) {
    console.log("FUNCTION START: process-payment.js initiated.");
    if (event.httpMethod !== "POST") {
        console.log("METHOD NOT ALLOWED: Only POST method is accepted.");
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
            console.log("DEBUG: Request is multipart/form-data. Parsing with formidable.");
            const { fields, files } = await new Promise((resolve, reject) => {
                form.parse(reqStream, (err, fields, files) => {
                    if (err) {
                        console.error('ERROR: Formidable parse error:', err);
                        return reject(err);
                    }
                    resolve({ fields, files });
                });
            });

            fieldsData = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
            paymentReceiptFile = files['paymentReceipt'] ? files['paymentReceipt'][0] : null;
            console.log("DEBUG: Formidable parsing complete. fieldsData:", JSON.stringify(fieldsData));
            if (paymentReceiptFile) {
                console.log(`DEBUG: Payment receipt file detected: ${paymentReceiptFile.originalFilename}, path: ${paymentReceiptFile.filepath}`);
            }

        } else if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
            console.log("DEBUG: Request is application/json.");
            fieldsData = JSON.parse(event.body);
        } else {
            console.log("DEBUG: Request is x-www-form-urlencoded.");
            const { parse } = require('querystring');
            fieldsData = parse(event.body);
        }
        console.log("DEBUG: Parsed fieldsData:", fieldsData);

    } catch (parseError) {
        console.error("ERROR: Failed to parse request body:", parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: `Error al procesar los datos de la solicitud: ${parseError.message || 'Unknown error'}. Por favor, verifica tus datos e inténtalo de nuevo.` })
        };
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const WHATSAPP_NUMBER_RECARGADOR = process.env.WHATSAPP_NUMBER_RECARGADOR;
    // URL de tu logo para la factura (CRÍTICO: ASEGÚRATE DE QUE ESTÉ PÚBLICA Y ACCESIBLE)
    const LOGO_URL = process.env.LOGO_URL; 

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseServiceKey || !WHATSAPP_NUMBER_RECARGADOR || !LOGO_URL) {
        console.error("CONFIGURATION ERROR: Missing required environment variables.");
        console.error(`Missing TELEGRAM_BOT_TOKEN: ${!TELEGRAM_BOT_TOKEN}`);
        console.error(`Missing TELEGRAM_CHAT_ID: ${!TELEGRAM_CHAT_ID}`);
        console.error(`Missing SUPABASE_URL: ${!supabaseUrl}`);
        console.error(`Missing SUPABASE_SERVICE_KEY: ${!supabaseServiceKey}`);
        console.error(`Missing WHATSAPP_NUMBER_RECARGADOR: ${!WHATSAPP_NUMBER_RECARGADOR}`);
        console.error(`Missing LOGO_URL: ${!LOGO_URL}`); 
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error de configuración del servidor: Faltan credenciales o configuración inválida." })
        };
    }
    console.log(`DEBUG: LOGO_URL configured: ${LOGO_URL}`);


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
    let invoiceImageUrl = null; 
    let newTransactionData;
    let id_transaccion_generado;

    try {
        id_transaccion_generado = `GMK-${Date.now()}`; 
        console.log(`DEBUG: Generated transaction ID: ${id_transaccion_generado}`);

        // --- Subir comprobante del cliente a Supabase Storage ---
        if (paymentReceiptFile && paymentReceiptFile.filepath && fs.existsSync(paymentReceiptFile.filepath) && game !== "TikTok") {
            console.log(`DEBUG: Attempting to upload client receipt: ${paymentReceiptFile.originalFilename}`);
            const fileBuffer = fs.readFileSync(paymentReceiptFile.filepath);
            const fileName = `${id_transaccion_generado}_comprobante_${Date.now()}_${paymentReceiptFile.originalFilename}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('comprobantes') 
                .upload(fileName, fileBuffer, {
                    contentType: paymentReceiptFile.mimetype,
                    upsert: false 
                });

            if (uploadError) {
                console.error("ERROR: Supabase Storage upload failed for client receipt:", uploadError);
            } else {
                const { data: publicUrlData } = supabase.storage
                    .from('comprobantes')
                    .getPublicUrl(fileName);
                receiptUrl = publicUrlData.publicUrl;
                console.log("DEBUG: Client receipt uploaded to Supabase Storage:", receiptUrl);
            }
        } else {
            console.log("DEBUG: No payment receipt file to upload or game is TikTok. Skipping receipt upload.");
        }

        // --- Generar la Imagen de la Factura ---
        const now = new Date();
        const rechargeTime = now.toLocaleString('es-VE', { 
            hour: '2-digit', minute: '2-digit', second: '2-digit', 
            day: '2-digit', month: '2-digit', year: 'numeric' 
        });

        const invoiceHtmlTemplate = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Factura GamingKings</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f0f0f0;
            color: #333;
        }
        .invoice-container {
            width: 350px; 
            margin: 0 auto;
            background-color: #fff;
            border-radius: 10px;
            box-shadow: 0 0 15px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            padding: 20px;
            border-top: 5px solid #8e44ad; 
        }
        .header {
            text-align: center;
            padding-bottom: 15px;
            border-bottom: 1px solid #eee;
            margin-bottom: 20px;
        }
        .header img {
            max-width: 120px;
            margin-bottom: 10px;
            display: block; /* Ensures it's block-level for margin auto */
            margin-left: auto;
            margin-right: auto;
        }
        .header h1 {
            color: #8e44ad; 
            font-size: 24px;
            margin: 0;
        }
        .header p {
            color: #666;
            font-size: 14px;
            margin-top: 5px;
        }
        .details-section {
            margin-bottom: 20px;
        }
        .details-section h2 {
            color: #e91e63; 
            font-size: 18px;
            border-bottom: 2px solid #e91e63;
            padding-bottom: 5px;
            margin-bottom: 15px;
        }
        .detail-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 15px;
            line-height: 1.4;
        }
        .detail-item .label {
            font-weight: bold;
            color: #555;
            width: 45%;
        }
        .detail-item .value {
            text-align: right;
            width: 55%;
            word-wrap: break-word; 
        }
        .footer {
            text-align: center;
            padding-top: 20px;
            border-top: 1px solid #eee;
            margin-top: 20px;
            color: #777;
            font-size: 12px;
        }
        .highlight {
            color: #e91e63; 
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="invoice-container">
        <div class="header">
            <img src="${LOGO_URL}" alt="GamingKings Logo">
            <h1>Factura de Recarga</h1>
            <p>GamingKings</p>
        </div>

        <div class="details-section">
            <h2>Detalles de la Transacción</h2>
            <div class="detail-item">
                <span class="label">Hora de Recarga:</span>
                <span class="value"><span class="highlight">${rechargeTime}</span></span>
            </div>
            <div class="detail-item">
                <span class="label">ID de Transacción:</span>
                <span class="value"><span class="highlight">${id_transaccion_generado}</span></span>
            </div>
            <div class="detail-item">
                <span class="label">ID de Jugador:</span>
                <span class="value">${playerId || 'N/A'}</span>
            </div>
            <div class="detail-item">
                <span class="label">Correo Cliente:</span>
                <span class="value">${email || 'N/A'}</span>
            </div>
            <div class="detail-item">
                <span class="label">Número de Teléfono:</span>
                <span class="value">${whatsappNumber || 'N/A'}</span>
            </div>
            <div class="detail-item">
                <span class="label">Juego Recargado:</span>
                <span class="value"><span class="highlight">${game}</span></span>
            </div>
            <div class="detail-item">
                <span class="label">Paquete Recargado:</span>
                <span class="value"><span class="highlight">${packageName}</span></span>
            </div>
            <div class="detail-item">
                <span class="label">Monto:</span>
                <span class="value"><span class="highlight">${finalPrice} ${currency}</span></span>
            </div>
            <div class="detail-item">
                <span class="label">Método de Pago:</span>
                <span class="value">${paymentMethod.replace('-', ' ').toUpperCase()}</span>
            </div>
        </div>

        <div class="footer">
            <p>¡Gracias por elegir GamingKings!</p>
            <p>&copy; ${new Date().getFullYear()} GamingKings. Todos los derechos reservados.</p>
        </div>
    </div>
</body>
</html>
        `;

        let browserPath = null;
        // La siguiente línea es crucial para Puppeteer en Netlify
        // netlify-plugin-chromium asegura que el ejecutable esté en este PATH
        if (process.env.LAMBDA_TASK_ROOT) {
            browserPath = path.join(process.env.LAMBDA_TASK_ROOT, 'node_modules', '.bin', 'chromium');
            console.log(`DEBUG: Running in Lambda. Chromium executablePath: ${browserPath}`);
        } else {
            console.warn("WARN: Not in Lambda environment. browserPath will be null for local development.");
        }

        try {
            console.log("DEBUG INVOICE: Starting invoice image generation process.");
            console.log(`DEBUG INVOICE: HTML template size: ${invoiceHtmlTemplate.length} characters.`);
            console.log(`DEBUG INVOICE: Attempting to use browserPath: ${browserPath}`);
            
            const imageBuffer = await nodeHtmlToImage({
                html: invoiceHtmlTemplate,
                quality: 90, 
                type: 'jpeg', 
                puppeteerArgs: {
                    executablePath: browserPath,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process', '--disable-dev-shm-usage', '--no-zygote'] // Added more args for serverless
                }
            });
            console.log("DEBUG INVOICE: Image generated successfully by node-html-to-image. Buffer size:", imageBuffer ? imageBuffer.length : 'null');

            if (!imageBuffer) {
                console.error("ERROR INVOICE: imageBuffer is null or empty after nodeHtmlToImage. Invoice will not be uploaded.");
                throw new Error("Invoice image buffer is empty. Generation failed."); // Force catch block
            }

            const invoiceFileName = `${id_transaccion_generado}_factura.jpg`; 
            console.log(`DEBUG INVOICE: Attempting to upload invoice file: ${invoiceFileName}`);
            const { data: invoiceUploadData, error: invoiceUploadError } = await supabase.storage
                .from('comprobantes') // Asegúrate de que este bucket existe y tiene políticas de R/W adecuadas
                .upload(invoiceFileName, imageBuffer, {
                    contentType: 'image/jpeg', 
                    upsert: false 
                });

            if (invoiceUploadError) {
                console.error("ERROR INVOICE: Supabase Storage upload failed for invoice image:", invoiceUploadError);
            } else {
                const { data: invoicePublicUrlData } = supabase.storage
                    .from('comprobantes')
                    .getPublicUrl(invoiceFileName);
                invoiceImageUrl = invoicePublicUrlData.publicUrl;
                console.log("DEBUG INVOICE: Invoice image uploaded to Supabase Storage and public URL obtained:", invoiceImageUrl);
                if (!invoiceImageUrl) {
                    console.error("WARN INVOICE: Public URL for invoice image is null or empty after Supabase getPublicUrl, despite successful upload.");
                }
            }

        } catch (invoiceGenError) {
            console.error("CRITICAL ERROR INVOICE GENERATION/UPLOAD:", invoiceGenError.message);
            if (invoiceGenError.stack) {
                console.error("CRITICAL ERROR INVOICE STACK:", invoiceGenError.stack);
            }
            invoiceImageUrl = null; // Ensure it remains null if error occurs
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
            invoice_image_url: invoiceImageUrl, 
            telegram_chat_id: TELEGRAM_CHAT_ID, 
        };
        console.log("DEBUG: Data prepared for Supabase insertion:", JSON.stringify(dataToInsert));

        const { data: insertedData, error: insertError } = await supabase
            .from('transactions') 
            .insert(dataToInsert)
            .select(); 

        if (insertError) {
            console.error("ERROR: Supabase insertError captured:", JSON.stringify(insertError, null, 2));
            throw insertError; 
        }
        
        if (!insertedData || insertedData.length === 0) {
            console.error("ERROR: Supabase insert successful but returned empty data. Response:", JSON.stringify({ insertedData, insertError }, null, 2));
            throw new Error("Supabase insert did not return expected data.");
        }

        newTransactionData = insertedData[0];
        console.log("DEBUG: Transaction saved to Supabase with internal ID:", newTransactionData.id);

    } catch (supabaseError) {
        console.error("ERROR: Failed to save transaction to Supabase (catch block):", JSON.stringify(supabaseError, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error al guardar la transacción en la base de datos." })
        };
    }

    // ... (El resto del código para Telegram y WhatsApp permanece igual) ...
    let whatsappLinkCustomer = null;
    if (whatsappNumber && whatsappNumber.trim() !== '') {
        const customerNamePart = fullName && fullName.trim() !== '' ? `${fullName.split(' ')[0]}` : '';
        const greeting = customerNamePart ? `¡Hola ${customerNamePart}! 👋` : `¡Hola! 👋`;
        const gameAndPlayerId = playerId ? ` para *${game}* (ID: \`${escapeMarkdownV2(playerId)}\`)` : ` para *${game}*`;
        
        const whatsappMessageCustomer = `
${greeting}

Tu solicitud de recarga de *${escapeMarkdownV2(packageName)}*${gameAndPlayerId} ha sido recibida y está siendo *PROCESADA* bajo el número de transacción: \`${escapeMarkdownV2(id_transaccion_generado)}\`.

Te enviaremos una notificación de confirmación cuando la recarga se haga efectiva. ¡Gracias por tu paciencia!
        `.trim();
        const customerWhatsappNumberClean = whatsappNumber.replace(/\D/g, ''); 
        whatsappLinkCustomer = `https://wa.me/${customerWhatsappNumberClean}?text=${encodeURIComponent(whatsappMessageCustomer)}`;
        console.log("DEBUG: whatsappLinkCustomer generated for client:", whatsappLinkCustomer);
    } else {
        console.log(`DEBUG: No whatsappNumber provided. Skipping whatsappLinkCustomer generation.`);
    }

    let whatsappLinkRecargador = null;
    if (game && game.toLowerCase() === 'free fire' && WHATSAPP_NUMBER_RECARGADOR) {
        const recargadorWhatsappNumberClean = WHATSAPP_NUMBER_RECARGADOR.replace(/\D/g, ''); 
        const cleanedPackageName = (packageName || 'N/A').replace(/\+/g, '%2B');

        let whatsappMessageRecargador = `Hola. Por favor, realiza esta recarga lo antes posible.\n\n`;
        whatsappMessageRecargador += `*ID de Jugador:* ${playerId || 'N/A'}\n`;
        whatsappMessageRecargador += `*Paquete a Recargar:* ${cleanedPackageName}\n`; 
        
        whatsappLinkRecargador = `https://wa.me/${recargadorWhatsappNumberClean}?text=${encodeURIComponent(whatsappMessageRecargador)}`;
        console.log("DEBUG: whatsappLinkRecargador generated for recargador:", whatsappLinkRecargador);
    } else {
        console.log(`DEBUG: Skipping whatsappLinkRecargador because game is not Free Fire or WHATSAPP_NUMBER_RECARGADOR is missing. Game: ${game}`);
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
        console.log("DEBUG: Telegram message with action buttons sent successfully.");

        // Envío del comprobante del cliente (si existe) como archivo
        if (receiptUrl) { 
            try {
                const sendFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
                
                await axios.post(sendFileUrl, {
                    chat_id: TELEGRAM_CHAT_ID,
                    document: receiptUrl, 
                    caption: escapeMarkdownV2(`Comprobante de pago para la transacción ${id_transaccion_generado}`),
                    parse_mode: 'MarkdownV2'
                });
                console.log("DEBUG: Client receipt sent to Telegram using Supabase URL.");
            } catch (fileSendError) {
                console.error("ERROR: Failed to send client receipt to Telegram from URL:", fileSendError.response ? fileSendError.response.data : fileSendError.message);
            }
        }
        
        // Envío de la FACTURA GENERADA como archivo (si existe)
        if (invoiceImageUrl) { 
            try {
                const sendFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
                
                await axios.post(sendFileUrl, {
                    chat_id: TELEGRAM_CHAT_ID,
                    document: invoiceImageUrl, 
                    caption: escapeMarkdownV2(`Factura de Recarga para la transacción ${id_transaccion_generado}`),
                    parse_mode: 'MarkdownV2'
                });
                console.log("DEBUG: Generated invoice sent to Telegram using Supabase URL.");
            } catch (invoiceSendError) {
                console.error("ERROR: Failed to send generated invoice to Telegram from URL:", invoiceSendError.response ? invoiceSendError.response.data : invoiceSendError.message);
            }
        }


        if (newTransactionData && telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
            const { data: updatedData, error: updateError } = await supabase
                .from('transactions')
                .update({ 
                    telegram_message_id: telegramMessageResponse.data.result.message_id,
                    invoice_image_url: invoiceImageUrl 
                })
                .eq('id', newTransactionData.id); 

            if (updateError) {
                console.error("ERROR: Failed to update transaction in Supabase with telegram_message_id/invoice_image_url:", updateError.message);
            } else {
                console.log("DEBUG: Transaction updated in Supabase with telegram_message_id and invoice_image_url:", telegramMessageResponse.data.result.message_id, invoiceImageUrl);
            }
        }

    } catch (telegramError) {
        console.error("ERROR: Failed to send Telegram message or file:", telegramError.response ? telegramError.response.data : telegramError.message);
    }

    if (paymentReceiptFile && paymentReceiptFile.filepath && fs.existsSync(paymentReceiptFile.filepath)) {
        try {
            fs.unlinkSync(paymentReceiptFile.filepath);
            console.log("DEBUG: Temporary receipt file deleted.");
        } catch (unlinkError) {
            console.error("ERROR: Failed to delete temporary receipt file:", unlinkError);
        }
    }

    console.log("FUNCTION END: process-payment.js finished.");
    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Solicitud de pago recibida exitosamente. ¡Te enviaremos una confirmación pronto!" }),
    };
};