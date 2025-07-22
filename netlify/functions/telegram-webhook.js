// netlify/functions/telegram-webhook.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

// Función para escapar caracteres especiales de MarkdownV2 para Telegram
function escapeMarkdownV2(text) {
    if (typeof text !== 'string') {
        text = String(text);
    }
    const specialChars = /[_*\[\]()~`>#+\-={}.!]/g; // Caracteres especiales que deben ser escapados
    return text.replace(specialChars, '\\$&');
}

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const SMTP_HOST = process.env.SMTP_HOST;
    const SMTP_PORT = process.env.SMTP_PORT;
    const SMTP_USER = process.env.SMTP_USER;
    const SMTP_PASS = process.env.SMTP_PASS;
    const SENDER_EMAIL = process.env.SENDER_EMAIL || SMTP_USER;
    const WHATSAPP_CONTACT = process.env.WHATSAPP_CONTACT || '584126949631'; // Nueva variable de entorno

    // Validar variables de entorno críticas
    if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SMTP_HOST || isNaN(parseInt(SMTP_PORT, 10)) || !SMTP_USER || !SMTP_PASS) {
        console.error("Faltan variables de entorno requeridas para el webhook de Telegram o SMTP_PORT inválido.");
        return { statusCode: 500, body: "Error de configuración del servidor." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    try {
        const body = JSON.parse(event.body);
        const callbackQuery = body.callback_query;

        if (callbackQuery) {
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id; // ID del mensaje original que se va a editar
            const userId = callbackQuery.from.id; // ID del usuario que presionó el botón
            const userName = callbackQuery.from.first_name || `Usuario ${userId}`; // Nombre del usuario
            const data = callbackQuery.data;

            if (data.startsWith('mark_done_')) {
                const transactionId = data.replace('mark_done_', '');

                // 1. Obtener la transacción de Supabase
                // Usar 'id_transaccion' para la consulta si así lo guardas en process-payment.js
                const { data: transaction, error: fetchError } = await supabase
                    .from('transactions') // Asegúrate de que 'transactions' sea el nombre correcto de tu tabla
                    .select('*')
                    .eq('id_transaccion', transactionId)
                    .single();

                if (fetchError || !transaction) {
                    console.error("Error al obtener la transacción de Supabase:", fetchError ? fetchError.message : "Transacción no encontrada.");
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2(`❌ Error: No se pudo encontrar la transacción ${transactionId}.`),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error fetching transaction" };
                }

                // Verificar si ya está marcada para evitar re-procesamiento
                if (transaction.status === 'realizada') {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQuery.id,
                        text: "¡Esta recarga ya fue marcada como realizada!",
                        show_alert: true
                    });
                    return { statusCode: 200, body: "Already completed" };
                }

                // 2. Actualizar el estado en Supabase
                const { error: updateError } = await supabase
                    .from('transactions')
                    .update({
                        status: 'realizada',
                        completed_at: new Date().toISOString(), // Usar ISO string para timestampz
                        completed_by: userName // Guardar quién la completó
                    })
                    .eq('id_transaccion', transactionId); // Usar el campo correcto para actualizar

                if (updateError) {
                    console.error("Error al actualizar la transacción en Supabase:", updateError.message);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2(`❌ Error al procesar la recarga ${transactionId}: ${updateError.message}. Consulta los logs de Netlify.`),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error updating transaction" };
                }

                // 3. Editar el mensaje original en Telegram
                let newCaption = callbackQuery.message.text; // Captura el texto actual del mensaje
                // Reemplaza "Estado: PENDIENTE" con "Estado: REALIZADA"
                newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `REALIZADA` ✅');
                // Añade la línea "Recarga marcada por:"
                const completionTime = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
                const completionDate = new Date().toLocaleDateString('es-VE');
                newCaption += `\n\nRecarga marcada por: *${escapeMarkdownV2(userName)}* (${completionTime} ${completionDate})`;

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                    chat_id: chatId,
                    message_id: messageId,
                    text: escapeMarkdownV2(newCaption), // Escapar todo el texto
                    parse_mode: 'MarkdownV2', // Asegúrate de usar MarkdownV2
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Recarga Realizada", callback_data: `completed_${transactionId}` }] // Cambiar el botón para indicar que ya está completa
                        ]
                    }
                });

                // 4. Enviar un feedback al usuario que presionó el botón
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Recarga ${transactionId} marcada como realizada por ${userName}.`,
                    show_alert: false // No mostrar una alerta grande
                });

                // --- Enviar correo de confirmación de recarga completada ---
                if (transaction.email) { // Asegúrate de que haya un correo al que enviar
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
                                rejectUnauthorized: false // Puede ser necesario para algunos servidores SMTP
                            }
                        });
                    } catch (createTransportError) {
                        console.error("Error al crear el transportador de Nodemailer en webhook:", createTransportError);
                    }

                    const mailOptionsCompleted = {
                        from: SENDER_EMAIL,
                        to: transaction.email,
                        subject: `✅ ¡Tu Recarga de ${transaction.game} ha sido Completada con Éxito por GamingKings! ✅`, // CAMBIO: Nombre de la marca
                        html: `
                            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                                <h2 style="color: #28a745;">¡Recarga Completada!</h2>
                                <p>¡Hola ${transaction.email}!</p>
                                <p>Nos complace informarte que tu recarga para <strong>${transaction.game}</strong>, con ID de transacción <strong>${transaction.id_transaccion}</strong>, ha sido <strong>completada exitosamente</strong> por nuestro equipo.</p>
                                <p>¡Ya puedes disfrutar de tu paquete <strong>${transaction.package_name}</strong>!</p>
                                <p>Aquí tienes un resumen de tu recarga:</p>
                                <ul style="list-style: none; padding: 0;">
                                    <li><strong>Juego:</strong> ${transaction.game}</li>
                                    ${transaction.player_id ? `<li><strong>ID de Jugador:</strong> ${transaction.player_id}</li>` : ''}
                                    <li><strong>Paquete:</strong> ${transaction.package_name}</li>
                                    <li><strong>Monto Pagado:</strong> ${transaction.final_price} ${transaction.currency}</li>
                                    <li><strong>Método de Pago:</strong> ${transaction.payment_method.replace('-', ' ').toUpperCase()}</li>
                                    <li><strong>Estado:</strong> <span style="color: #28a745; font-weight: bold;">REALIZADA</span></li>
                                    <li><strong>Completada por:</strong> ${userName} el ${completionTime} ${completionDate}</li>
                                </ul>
                                <p style="margin-top: 20px;">Si tienes alguna pregunta o necesitas asistencia, no dudes en contactarnos a través de nuestro WhatsApp: <a href="https://wa.me/${WHATSAPP_CONTACT}" style="color: #28a745; text-decoration: none;">+${WHATSAPP_CONTACT}</a></p>
                                <p>¡Gracias por elegir GamingKings!</p> <p style="font-size: 0.9em; color: #777;">Este es un correo automático, por favor no respondas a este mensaje.</p>
                            </div>
                        `,
                    };

                    try {
                        await transporter.sendMail(mailOptionsCompleted);
                        console.log("Correo de confirmación de recarga completada enviado a:", transaction.email);
                    } catch (emailError) {
                        console.error("Error al enviar el correo de recarga completada:", emailError.message);
                        if (emailError.response) {
                            console.error("Detalles del error SMTP del correo completado:", emailError.response);
                        }
                    }
                }
            }
        }
        return { statusCode: 200, body: "Webhook processed" };
    } catch (error) {
        console.error("Error en el webhook de Telegram:", error.message);
        return { statusCode: 500, body: `Error en el webhook: ${error.message}` };
    }
};