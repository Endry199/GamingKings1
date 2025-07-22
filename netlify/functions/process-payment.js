// netlify/functions/process-payment.js
const axios = require('axios');
const { Formidable } = require('formidable');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('stream');
const fs = require('fs');
const FormData = require('form-data'); 

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

    console.log("DEBUG: SUPABASE_URL vista por la función:", supabaseUrl);
    console.log("DEBUG: SUPABASE_SERVICE_KEY vista por la función:", supabaseServiceKey);

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
    } catch (parseError) {
        console.error("Error al procesar los datos de la solicitud:", parseError);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: `Error al procesar los datos de la solicitud: ${parseError.message || 'Unknown error'}. Por favor, verifica tus datos e inténtalo de nuevo.` })
        };
    }

    // --- Validar y cargar variables de entorno ---
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = process.env.SMTP_PORT;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SENDER_EMAIL = process.env.SENDER_EMAIL || SMTP_USER;
    const WHATSAPP_CONTACT = process.env.WHATSAPP_CONTACT || '584126949631';

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !SMTP_HOST || isNaN(parseInt(SMTP_PORT, 10)) || !SMTP_USER || !SMTP_PASS || !supabaseUrl || !supabaseServiceKey) {
        console.error("Faltan variables de entorno requeridas o SMTP_PORT no es un número válido.");
        console.error(`Missing TELEGRAM_BOT_TOKEN: ${!TELEGRAM_BOT_TOKEN}`);
        console.error(`Missing TELEGRAM_CHAT_ID: ${!TELEGRAM_CHAT_ID}`);
        console.error(`Missing SMTP_HOST: ${!SMTP_HOST}`);
        console.error(`Invalid SMTP_PORT: ${isNaN(parseInt(SMTP_PORT, 10))}`);
        console.error(`Missing SMTP_USER: ${!SMTP_USER}`);
        console.error(`Missing SMTP_PASS: ${!SMTP_PASS}`);
        console.error(`Missing SUPABASE_URL: ${!supabaseUrl}`);
        console.error(`Missing SUPABASE_SERVICE_KEY: ${!supabaseServiceKey}`);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error de configuración del servidor: Faltan credenciales o configuración inválida." })
        };
    }

    const { game, playerId, package: packageName, finalPrice, currency, paymentMethod, email, fullName, whatsappNumber, referenceNumber, txid } = fieldsData;

    let receiptUrl = null;
    let newTransactionData;
    let id_transaccion_generado;

    try {
        id_transaccion_generado = `GMK-${Date.now()}`; 

        // --- Subir comprobante a Supabase Storage PRIMERO ---
        if (paymentReceiptFile && paymentReceiptFile.filepath) {
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
        }

        // --- PREPARANDO DATOS PARA LA INSERCIÓN ---
        const dataToInsert = {
            id_transaccion: id_transaccion_generado,
            game: game,                       
            player_id: playerId || null,      
            package_name: packageName,        
            final_price: parseFloat(finalPrice),
            currency: currency,               
            payment_method: paymentMethod,    
            email: email,                     
            full_name: fullName || null,      
            whatsapp_number: whatsappNumber || null, 
            reference_number: referenceNumber || null, 
            txid: txid || null,               
            receipt_url: receiptUrl,          
            status: 'pendiente',              
            telegram_chat_id: TELEGRAM_CHAT_ID, 
        };
        console.log("DEBUG: Datos preparados para insertar en Supabase:", JSON.stringify(dataToInsert, null, 2));

        // --- Guardar Transacción en Supabase ---
        const { data: insertedData, error: insertError } = await supabase
            .from('transactions') 
            .insert(dataToInsert)
            .select(); // .select() es importante para obtener los datos insertados

        // --- LÓGICA DE DEPURACIÓN DE ERRORES DE INSERCIÓN ---
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
        // CAMBIO: Imprimir el objeto de error completo serializado para depuración
        console.error("Error al guardar la transacción en Supabase (catch block):", JSON.stringify(supabaseError, null, 2));
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error al guardar la transacción en la base de datos." })
        };
    }

    // --- Enviar Notificación a Telegram ---
    let messageText = `✨ Nueva Recarga GamingKings ✨\n\n`; 
    messageText += `*ID de Transacción:* \`${escapeMarkdownV2(id_transaccion_generado || 'N/A')}\`\n`;
    messageText += `*Estado:* \`PENDIENTE\`\n\n`;
    messageText += `🎮 Juego: *${escapeMarkdownV2(game)}*\n`;
    messageText += `👤 ID de Jugador: *${escapeMarkdownV2(playerId || 'N/A')}*\n`;
    messageText += `📦 Paquete: *${escapeMarkdownV2(packageName)}*\n`;
    messageText += `💰 Total a Pagar: *${escapeMarkdownV2(finalPrice)} ${escapeMarkdownV2(currency)}*\n`;
    messageText += `💳 Método de Pago: *${escapeMarkdownV2(paymentMethod.replace('-', ' ').toUpperCase())}*\n`;
    messageText += `📧 Correo Cliente: ${escapeMarkdownV2(email)}\n`;
    if (fullName) {
        messageText += `🧑‍💻 Nombre Cliente: ${escapeMarkdownV2(fullName)}\n`;
    }
    if (whatsappNumber) {
        messageText += `📱 WhatsApp Cliente: ${escapeMarkdownV2(whatsappNumber)}\n`;
    }

    if (paymentMethod === 'pago-movil') {
        messageText += `📊 Referencia Pago Móvil: ${escapeMarkdownV2(referenceNumber || 'N/A')}\n`;
    } else if (paymentMethod === 'binance') {
        messageText += `🆔 TXID Binance: ${escapeMarkdownV2(txid || referenceNumber || 'N/A')}\n`;
    } else if (paymentMethod === 'zinli') {
        messageText += `📊 Referencia Zinli: ${escapeMarkdownV2(referenceNumber || 'N/A')}\n`;
    }

    const replyMarkup = {
        inline_keyboard: [
            [{ text: "✅ Marcar como Realizada", callback_data: `mark_done_${id_transaccion_generado}` }]
        ]
    };

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    let telegramMessageResponse;

    try {
        telegramMessageResponse = await axios.post(telegramApiUrl, {
            chat_id: TELEGRAM_CHAT_ID,
            text: messageText,
            parse_mode: 'MarkdownV2', 
            reply_markup: replyMarkup
        });
        console.log("Mensaje de Telegram enviado con éxito.");

        if (receiptUrl) { 
            console.log("DEBUG: Intentando enviar comprobante a Telegram desde Supabase URL.");
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
                console.error("ERROR: Fallo al enviar el comprobante a Telegram desde URL.");
                if (fileSendError.response) {
                    console.error("Detalles del error de respuesta de Telegram:", fileSendError.response.data);
                    console.error("Estado del error de respuesta:", fileSendError.response.status);
                } else if (fileSendError.request) {
                    console.error("No se recibió respuesta de Telegram (la solicitud fue enviada):", fileSendError.request);
                } else {
                    console.error("Error al configurar la solicitud:", fileSendError.message);
                }
            }
        } else {
            console.log("DEBUG: No hay URL de comprobante de pago para enviar a Telegram.");
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

    // --- Enviar Confirmación por Correo Electrónico al Cliente (con Nodemailer) ---
    if (email) {
        let transporter;
        try {
            transporter = nodemailer.createTransport({
                host: SMTP_HOST,
                port: parseInt(SMTP_PORT, 10),
                secure: parseInt(SMTP_PORT, 10) === 465, 
                auth: {
                    user: SMTP_USER,
                    pass: SMTP_PASS,
                },
                tls: {
                    rejectUnauthorized: false 
                }
            });
        } catch (createTransportError) {
            console.error("Error al crear el transportador de Nodemailer:", createTransportError);
        }

        const mailOptions = {
            from: SENDER_EMAIL,
            to: email,
            subject: `🎉 Tu Solicitud de Recarga de ${game} con GamingKings ha sido Recibida! 🎉`, 
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <h2 style="color: #007bff;">¡Hola!</h2>
                    <p>Hemos recibido tu solicitud de recarga para <strong>${game}</strong> con ID: <strong>${id_transaccion_generado}</strong>.</p>
                    <p>Aquí están los detalles que nos proporcionaste:</p>
                    <ul style="list-style: none; padding: 0;">
                        <li><strong>Juego:</strong> ${game}</li>
                        ${playerId ? `<li><strong>ID de Jugador:</strong> ${playerId}</li>` : ''}
                        <li><strong>Paquete:</strong> ${packageName}</li>
                        <li><strong>Monto a Pagar:</strong> ${finalPrice} ${currency}</li>
                        <li><strong>Método de Pago Seleccionado:</strong> ${paymentMethod.replace('-', ' ').toUpperCase()}</li>
                        ${whatsappNumber ? `<li><strong>Número de WhatsApp Proporcionado:</strong> ${whatsappNumber}</li>` : ''}
                    </ul>
                    <p>Tu solicitud está actualmente en estado: <strong>PENDIENTE</strong>.</p>
                    <p>Estamos procesando tu recarga. Te enviaremos un <strong>correo de confirmación de la recarga completada y tu factura virtual una vez que tu recarga sea procesada</strong> por nuestro equipo.</p>
                    <p style="margin-top: 20px;">¡Gracias por confiar en GamingKings!</p> <p style="font-size: 0.9em; color: #777;">Si tienes alguna pregunta, contáctanos a través de nuestro WhatsApp: <a href="https://wa.me/${WHATSAPP_CONTACT}" style="color: #28a745; text-decoration: none;">+${WHATSAPP_CONTACT}</a></p>
                </div>
            `,
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log("Correo de confirmación inicial enviado al cliente:", email);
        } catch (emailError) {
            console.error("Error al enviar el correo de confirmación inicial:", emailError.message);
            if (emailError.response) {
                console.error("Detalles del error SMTP:", emailError.response);
            }
        }
    }

    // --- Limpieza del archivo temporal después de todo procesamiento ---
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