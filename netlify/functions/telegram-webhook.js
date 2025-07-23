// netlify/functions/telegram-webhook.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

// Función para escapar caracteres especiales de MarkdownV2 para Telegram
function escapeMarkdownV2(text) {
    if (typeof text !== 'string') {
        text = String(text);
    }
    // Caracteres especiales que deben ser escapados en MarkdownV2
    // Añadimos el guion '-' aquí explícitamente, aunque la regex ya lo incluye, para énfasis.
    const specialChars = /[_*\[\]()~`>#+\-={}.!]/g; 
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
    const WHATSAPP_CONTACT_CLIENTE = process.env.WHATSAPP_CONTACT_CLIENTE || '584126949631'; // Para el email al cliente
    const WHATSAPP_NUMBER_RECARGADOR = process.env.WHATSAPP_NUMBER_RECARGADOR; // ¡NUEVA VARIABLE PARA TU PRIMO!

    // Validar variables de entorno críticas
    if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SMTP_HOST || isNaN(parseInt(SMTP_PORT, 10)) || !SMTP_USER || !SMTP_PASS || !WHATSAPP_NUMBER_RECARGADOR) {
        console.error("Faltan variables de entorno requeridas para el webhook de Telegram o SMTP_PORT inválido.");
        // Log específico para la nueva variable
        if (!WHATSAPP_NUMBER_RECARGADOR) console.error("Falta la variable de entorno WHATSAPP_NUMBER_RECARGADOR.");
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

            // Función auxiliar para obtener transacción y manejar errores comunes
            async function getTransaction(id) {
                const { data: transaction, error: fetchError } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('id_transaccion', id)
                    .single();

                if (fetchError || !transaction) {
                    console.error("Error al obtener la transacción de Supabase:", fetchError ? fetchError.message : "Transacción no encontrada.");
                    // Acknowledge the callback query even if transaction not found.
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQuery.id,
                        text: "❌ Error: Transacción no encontrada.",
                        show_alert: true
                    });
                    return null;
                }
                return transaction;
            }

            // Manejar el botón "Marcar como Realizada"
            if (data.startsWith('mark_done_')) {
                const transactionId = data.replace('mark_done_', '');
                const transaction = await getTransaction(transactionId); // Fetches the transaction

                if (!transaction) {
                    // La función getTransaction ya maneja el answerCallbackQuery si no se encuentra
                    return { statusCode: 200, body: "Error fetching transaction for mark_done" };
                }

                console.log(`DEBUG: Estado actual de la transacción ${transactionId} al hacer clic: ${transaction.status}`);

                // Verificar si ya está marcada para evitar re-procesamiento
                if (transaction.status === 'realizada') {
                    console.log(`DEBUG: Transacción ${transactionId} ya marcada como 'realizada'. Enviando alerta.`);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQuery.id,
                        text: "¡Esta recarga ya fue marcada como realizada!",
                        show_alert: true
                    });
                    return { statusCode: 200, body: "Already completed" };
                }

                // --- ¡IMPORTANTE CAMBIO AQUÍ! Mover answerCallbackQuery antes de operaciones largas. ---
                // Esto responde a Telegram inmediatamente para evitar reintentos y mostrar feedback.
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Procesando recarga ${transactionId}...`, // Mensaje breve para el usuario en Telegram
                    show_alert: false
                });

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
                    // Si falla la actualización de DB, enviar un mensaje nuevo al chat (no editar el original)
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2(`❌ Error al procesar la recarga ${transactionId}: ${updateError.message}. Por favor, inténtalo de nuevo o revisa los logs.`),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error updating transaction" };
                }

                // 3. Editar el mensaje original en Telegram
                let newCaption = callbackQuery.message.text; // Captura el texto actual del mensaje
                // Reemplaza "Estado: PENDIENTE" con "Estado: REALIZADA"
                newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `REALIZADA` ✅');
                
                // Construir la fecha y hora manualmente con barras (/)
                const now = new Date();
                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
                const year = now.getFullYear();
                const formattedDate = `${day}/${month}/${year}`;

                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const formattedTime = `${hours}:${minutes}`;
                
                // Añadir al caption, y luego escapar el *caption completo*
                newCaption += `\n\nRecarga marcada por: *${userName}* (${formattedTime} ${formattedDate})`;

                // --- ¡CAMBIO CLAVE AQUÍ! Aplicar escapeMarkdownV2 a la cadena completa antes de enviar ---
                const escapedNewCaption = escapeMarkdownV2(newCaption);

                // Definir los nuevos botones después de completar
                const updatedButtons = [
                    [{ text: "✅ Recarga Realizada", callback_data: `completed_${transactionId}` }]
                ];

                try {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: messageId,
                        text: escapedNewCaption, // Enviamos la cadena ya escapada
                        parse_mode: 'MarkdownV2',
                        reply_markup: {
                            inline_keyboard: updatedButtons
                        }
                    });
                    console.log(`DEBUG: Mensaje de Telegram para ${transactionId} editado con éxito.`);
                } catch (telegramEditError) {
                    console.error(`ERROR: Fallo al editar mensaje de Telegram para ${transactionId}:`, telegramEditError.response ? telegramEditError.response.data : telegramEditError.message);
                    // Comprobar si el error es por "message not modified" (ya editado, común en race conditions)
                    if (telegramEditError.response && telegramEditError.response.status === 400 && 
                       (telegramEditError.response.data.description && telegramEditError.response.data.description.includes('message is not modified'))) {
                        console.log(`DEBUG: Mensaje ${messageId} para ${transactionId} no modificado o ya editado. Ignorando este error ya que la DB fue actualizada.`);
                    } else if (telegramEditError.response && telegramEditError.response.status === 400 &&
                               (telegramEditError.response.data.description && telegramEditError.response.data.description.includes('message to edit not found'))) {
                        console.log(`DEBUG: Mensaje ${messageId} para ${transactionId} no encontrado, probablemente eliminado. Ignorando este error.`);
                    } else {
                        // Para otros errores 400 o cualquier otro tipo de error, notificar al chat
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                            chat_id: chatId,
                            text: escapeMarkdownV2(`⚠️ Advertencia: Recarga ${transactionId} marcada como *REALIZADA* en la base de datos, pero hubo un problema al editar el mensaje de Telegram.`),
                            parse_mode: 'MarkdownV2'
                        });
                    }
                }

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
                        subject: `✅ ¡Tu Recarga de ${transaction.game} ha sido Completada con Éxito por GamingKings! ✅`, 
                        html: `
                            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                                <h2 style="color: #28a745;">¡Recarga Completada!</h2>
                                <p>¡Hola ${transaction.full_name || transaction.email}!</p>
                                <p>Nos complace informarte que tu recarga para <strong>${transaction.game}</strong>, con ID de transacción <strong>${transaction.id_transaccion}</strong>, ha sido <strong>completada exitosamente</strong> por nuestro equipo.</p>
                                <p>¡Ya puedes disfrutar de tu paquete <strong>${transaction.package_name}</strong>!</p>
                                <p>Aquí tienes un resumen de tu recarga:</p>
                                <ul style="list-style: none; padding: 0;">
                                    <li><strong>Juego:</strong> ${transaction.game}</li>
                                    ${transaction.player_id ? `<li><strong>ID de Jugador:</strong> ${transaction.player_id}</li>` : ''}
                                    <li><strong>Paquete:</strong> ${transaction.package_name}</li>
                                    <li><strong>Monto Pagado:</b> ${transaction.final_price} ${transaction.currency}</li>
                                    <li><strong>Método de Pago:</strong> ${transaction.payment_method.replace('-', ' ').toUpperCase()}</li>
                                    <li><strong>Estado:</strong> <span style="color: #28a745; font-weight: bold;">REALIZADA</span></li>
                                    <li><strong>Completada por:</strong> ${userName} el ${formattedTime} ${formattedDate}</li>
                                </ul>
                                <p style="margin-top: 20px;">Si tienes alguna pregunta o necesitas asistencia, no dudes en contactarnos a través de nuestro WhatsApp: <a href="https://wa.me/${WHATSAPP_CONTACT_CLIENTE}" style="color: #28a745; text-decoration: none;">+${WHATSAPP_CONTACT_CLIENTE}</a></p>
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
            // --- Lógica: Manejar el botón "Enviar a WhatsApp" al recargador ---
            else if (data.startsWith('send_whatsapp_')) {
                const transactionId = data.replace('send_whatsapp_', '');
                const transaction = await getTransaction(transactionId);

                if (!transaction) {
                    return { statusCode: 200, body: "Error fetching transaction for send_whatsapp" };
                }

                const recargadorWhatsappNumber = WHATSAPP_NUMBER_RECARGADOR.replace(/\D/g, ''); // Limpiar el número de cualquier caracter no numérico

                // Para el signo '+' en package_name: reemplazamos '+' por su equivalente URL-encoded '%2B'
                const packageNameForWhatsapp = (transaction.package_name || 'N/A').replace(/\+/g, '%2B');

                // Mensaje pre-rellenado para WhatsApp de tu primo (el recargador)
                let whatsappMessageRecargador = `Hola. Por favor, realiza esta recarga lo antes posible.\n\n`;
                whatsappMessageRecargador += `*ID de Jugador:* ${transaction.player_id || 'N/A'}\n`; // CORRECCIÓN: Ahora es ID de Jugador
                whatsappMessageRecargador += `*Paquete a Recargar:* ${packageNameForWhatsapp}\n`; // USA packageNameForWhatsapp

                const whatsappLinkRecargador = `https://wa.me/${recargadorWhatsappNumber}?text=${encodeURIComponent(whatsappMessageRecargador)}`;

                // Los botones deben recrearse según el juego, aunque aquí el botón de WhatsApp ya fue presionado.
                // Es importante que la lógica en process-payment.js ya decida si el botón de WhatsApp debe estar o no.
                // Aquí solo necesitamos asegurarnos de que el botón de "Marcar como Realizada" se mantenga.
                const newReplyMarkup = {
                    inline_keyboard: [
                        [
                            { text: "💬 Abrir WhatsApp del Recargador", url: whatsappLinkRecargador }, // Botón para tu primo
                        ],
                        [
                            { text: "✅ Marcar como Realizada", callback_data: `mark_done_${transactionId}` } // Mantener el botón de marcar como realizada
                        ]
                    ]
                };

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: newReplyMarkup
                });

                // Enviar un feedback al usuario que presionó el botón
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Enlace de WhatsApp al recargador generado para ${transactionId}.`,
                    show_alert: false
                });

                console.log(`Enlace de WhatsApp para recargador generado para transacción ${transactionId}: ${whatsappLinkRecargador}`);
            }
        }

        return { statusCode: 200, body: "Webhook processed" };
    } catch (error) {
        console.error("Error en el webhook de Telegram:", error.message);
        return { statusCode: 500, body: `Error en el webhook: ${error.message}` };
    }
};