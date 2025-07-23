// netlify/functions/process-payment.js
const axios = require('axios');
const { Formidable } = require('formidable');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream');
const fs = require('fs');
// Importar las nuevas librerías para la generación de imagen
const nodeHtmlToImage = require('node-html-to-image');
const path = require('path'); // Necesario para la ruta de Chromium

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
        console.log("DEBUG: fullName recibido:", fieldsData.fullName);

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
    // URL de tu logo para la factura (SUSTITUIR ESTA URL o configurar en Netlify como LOGO_URL)
    const LOGO_URL = process.env.LOGO_URL || 'https://example.com/your-logo.png'; // Reemplaza con la URL pública de tu logo

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !supabaseUrl || !supabaseServiceKey || !WHATSAPP_NUMBER_RECARGADOR || !LOGO_URL) {
        console.error("Faltan variables de entorno requeridas.");
        console.error(`Missing TELEGRAM_BOT_TOKEN: ${!TELEGRAM_BOT_TOKEN}`);
        console.error(`Missing TELEGRAM_CHAT_ID: ${!TELEGRAM_CHAT_ID}`);
        console.error(`Missing SUPABASE_URL: ${!supabaseUrl}`);
        console.error(`Missing SUPABASE_SERVICE_KEY: ${!supabaseServiceKey}`);
        console.error(`Missing WHATSAPP_NUMBER_RECARGADOR: ${!WHATSAPP_NUMBER_RECARGADOR}`);
        console.error(`Missing LOGO_URL: ${!LOGO_URL}`); // Verifica que esta esté presente
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

    let receiptUrl = null; // URL del comprobante de pago subido por el cliente
    let invoiceImageUrl = null; // URL de la factura generada
    let newTransactionData;
    let id_transaccion_generado;

    try {
        id_transaccion_generado = `GMK-${Date.now()}`; 

        // --- Subir comprobante del cliente a Supabase Storage PRIMERO ---
        if (paymentReceiptFile && paymentReceiptFile.filepath && game !== "TikTok") {
            console.log(`Intentando subir comprobante del cliente: ${paymentReceiptFile.originalFilename} (${paymentReceiptFile.mimetype})`);
            const fileBuffer = fs.readFileSync(paymentReceiptFile.filepath);
            const fileName = `${id_transaccion_generado}_comprobante_${Date.now()}_${paymentReceiptFile.originalFilename}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('comprobantes') 
                .upload(fileName, fileBuffer, {
                    contentType: paymentReceiptFile.mimetype,
                    upsert: false 
                });

            if (uploadError) {
                console.error("Error al subir el comprobante del cliente a Supabase Storage:", uploadError);
            } else {
                const { data: publicUrlData } = supabase.storage
                    .from('comprobantes')
                    .getPublicUrl(fileName);
                receiptUrl = publicUrlData.publicUrl;
                console.log("Comprobante del cliente subido a Supabase Storage:", receiptUrl);
            }
        }

        // --- Generar la Imagen de la Factura ---
        const now = new Date();
        const rechargeTime = now.toLocaleString('es-VE', { 
            hour: '2-digit', minute: '2-digit', second: '2-digit', 
            day: '2-digit', month: '2-digit', year: 'numeric' 
        });

        // Plantilla HTML de la factura (con tu diseño y placeholders)
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
            background-color: #f0f0f0; /* Gris claro de fondo */
            color: #333;
        }
        .invoice-container {
            width: 350px; /* Ancho fijo para la imagen */
            margin: 0 auto;
            background-color: #fff;
            border-radius: 10px;
            box-shadow: 0 0 15px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            padding: 20px;
            border-top: 5px solid #8e44ad; /* Morado superior */
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
        }
        .header h1 {
            color: #8e44ad; /* Morado */
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
            color: #e91e63; /* Rosa */
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
            color: #e91e63; /* Rosa para resaltar valores */
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
        // Netlify-plugin-chromium asegura que el ejecutable esté en este PATH
        if (process.env.LAMBDA_TASK_ROOT) {
            browserPath = path.join(process.env.LAMBDA_TASK_ROOT, 'node_modules', '.bin', 'chromium');
        } else {
            // Para desarrollo local, puedes apuntar a tu propio Chromium
            // O dejarlo null para que puppeteer-core lo intente encontrar
            console.warn("No en entorno Lambda, browserPath será null para desarrollo local.");
        }

        try {
            console.log("DEBUG: Intentando generar imagen de factura...");
            const imageBuffer = await nodeHtmlToImage({
                html: invoiceHtmlTemplate,
                quality: 90, // Calidad de la imagen JPG
                type: 'jpeg', // O 'png' si prefieres
                puppeteerArgs: {
                    executablePath: browserPath,
                    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Importante para entornos serverless
                }
            });
            console.log("DEBUG: Imagen de factura generada. Subiendo a Supabase...");

            const invoiceFileName = `${id_transaccion_generado}_factura.jpg`; // O .png
            const { data: invoiceUploadData, error: invoiceUploadError } = await supabase.storage
                .from('comprobantes') // Puedes crear un bucket 'facturas' si quieres separarlos
                .upload(invoiceFileName, imageBuffer, {
                    contentType: 'image/jpeg', // O 'image/png'
                    upsert: false 
                });

            if (invoiceUploadError) {
                console.error("Error al subir la imagen de la factura a Supabase Storage:", invoiceUploadError);
            } else {
                const { data: invoicePublicUrlData } = supabase.storage
                    .from('comprobantes')
                    .getPublicUrl(invoiceFileName);
                invoiceImageUrl = invoicePublicUrlData.publicUrl;
                console.log("Imagen de la factura subida a Supabase Storage:", invoiceImageUrl);
            }

        } catch (invoiceGenError) {
            console.error("ERROR: Fallo al generar o subir la imagen de la factura:", invoiceGenError);
            // Continúa sin la factura si hay un error crítico aquí
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
            receipt_url: receiptUrl, // Comprobante subido por el cliente
            invoice_image_url: invoiceImageUrl, // URL de la factura generada
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
        console.log("DEBUG: whatsappLinkCustomer generado para el cliente:", whatsappLinkCustomer);
    } else {
        console.log(`DEBUG: No se pudo generar whatsappLinkCustomer (cliente). whatsappNumber: '${whatsappNumber}'.`);
    }

    let whatsappLinkRecargador = null;
    if (game && game.toLowerCase() === 'free fire' && WHATSAPP_NUMBER_RECARGADOR) {
        const recargadorWhatsappNumberClean = WHATSAPP_NUMBER_RECARGADOR.replace(/\D/g, ''); 
        const cleanedPackageName = (packageName || 'N/A').replace(/\+/g, '%2B');

        let whatsappMessageRecargador = `Hola. Por favor, realiza esta recarga lo antes posible.\n\n`;
        whatsappMessageRecargador += `*ID de Jugador:* ${playerId || 'N/A'}\n`;
        whatsappMessageRecargador += `*Paquete a Recargar:* ${cleanedPackageName}\n`; 
        
        whatsappLinkRecargador = `https://wa.me/${recargadorWhatsappNumberClean}?text=${encodeURIComponent(whatsappMessageRecargador)}`;
        console.log("DEBUG: whatsappLinkRecargador generado:", whatsappLinkRecargador);
    } else {
        console.log(`DEBUG: No se generará el enlace de WhatsApp para el recargador porque el juego no es Free Fire o falta WHATSAPP_NUMBER_RECARGADOR. Juego: ${game}`);
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
        console.log("Mensaje de Telegram con botones de acción enviado con éxito.");

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
                console.log("Comprobante de pago enviado a Telegram usando URL de Supabase.");
            } catch (fileSendError) {
                console.error("ERROR: Fallo al enviar el comprobante del cliente a Telegram desde URL:", fileSendError.response ? fileSendError.response.data : fileSendError.message);
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
                console.log("Factura generada enviada a Telegram usando URL de Supabase.");
            } catch (invoiceSendError) {
                console.error("ERROR: Fallo al enviar la factura generada a Telegram desde URL:", invoiceSendError.response ? invoiceSendError.response.data : invoiceSendError.message);
            }
        }


        if (newTransactionData && telegramMessageResponse && telegramMessageResponse.data && telegramMessageResponse.data.result) {
            const { data: updatedData, error: updateError } = await supabase
                .from('transactions')
                .update({ 
                    telegram_message_id: telegramMessageResponse.data.result.message_id,
                    invoice_image_url: invoiceImageUrl // Asegúrate de guardar la URL de la factura generada en la DB
                })
                .eq('id', newTransactionData.id); 

            if (updateError) {
                console.error("Error al actualizar la transacción en Supabase con telegram_message_id/invoice_image_url:", updateError.message);
            } else {
                console.log("Transaction actualizada en Supabase con telegram_message_id y invoice_image_url:", telegramMessageResponse.data.result.message_id, invoiceImageUrl);
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