// netlify/functions/telegram-webhook.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

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

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const WHATSAPP_NUMBER_RECARGADOR = process.env.WHATSAPP_NUMBER_RECARGADOR;

    // Validar variables de entorno críticas
    if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !WHATSAPP_NUMBER_RECARGADOR) {
        console.error("Faltan variables de entorno requeridas para el webhook de Telegram.");
        if (!WHATSAPP_NUMBER_RECARGADOR) console.error("Falta la variable de entorno WHATSAPP_NUMBER_RECARGADOR.");
        return { statusCode: 500, body: "Error de configuración del servidor." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    try {
        const body = JSON.parse(event.body);
        const callbackQuery = body.callback_query;

        if (callbackQuery) {
            const chatId = callbackQuery.message.chat.id; // Este es el TELEGRAM_CHAT_ID principal
            const messageId = callbackQuery.message.message_id;
            const userId = callbackQuery.from.id;
            const userName = callbackQuery.from.first_name || `Usuario ${userId}`;
            const data = callbackQuery.data;

            // Función auxiliar para obtener transacción y manejar errores comunes
            async function getTransaction(id) {
                const { data: transaction, error: fetchError } = await supabase
                    .from('transactions')
                    .select('id_transaccion, game, player_id, package_name, final_price, currency, payment_method, status, email, full_name, whatsapp_number, receipt_url') 
                    .eq('id_transaccion', id)
                    .single();

                if (fetchError || !transaction) {
                    console.error("Error al obtener la transacción de Supabase:", fetchError ? fetchError.message : "Transacción no encontrada.");
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
                const transaction = await getTransaction(transactionId);

                if (!transaction) {
                    return { statusCode: 200, body: "Error fetching transaction for mark_done" };
                }

                console.log(`DEBUG: Estado actual de la transacción ${transactionId} al hacer clic: ${transaction.status}`);

                if (transaction.status === 'realizada') {
                    console.log(`DEBUG: Transacción ${transactionId} ya marcada como 'realizada'. Enviando alerta.`);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQuery.id,
                        text: "¡Esta recarga ya fue marcada como realizada!",
                        show_alert: true
                    });
                    return { statusCode: 200, body: "Already completed" };
                }

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Procesando recarga ${transactionId}...`,
                    show_alert: false
                });

                // 2. Actualizar el estado en Supabase
                const { error: updateError } = await supabase
                    .from('transactions')
                    .update({
                        status: 'realizada',
                        completed_at: new Date().toISOString(),
                        completed_by: userName
                    })
                    .eq('id_transaccion', transactionId);

                if (updateError) {
                    console.error("Error al actualizar la transacción en Supabase:", updateError.message);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2(`❌ Error al procesar la recarga ${transactionId}: ${updateError.message}. Por favor, inténtalo de nuevo o revisa los logs.`),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error updating transaction" };
                }

                // 3. Editar el mensaje original en Telegram
                let newCaption = callbackQuery.message.text;
                newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `REALIZADA` ✅');
                
                const now = new Date();
                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const year = now.getFullYear();
                const formattedDate = `${day}/${month}/${year}`;

                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const formattedTime = `${hours}:${minutes}`;
                
                newCaption += `\n\nRecarga marcada por: *${userName}* (${formattedTime} ${formattedDate})`;

                const escapedNewCaption = escapeMarkdownV2(newCaption);

                // --- Generar enlace de WhatsApp para el cliente (Factura Completada) ---
                let whatsappLinkCompletedCustomer = null;
                if (transaction.whatsapp_number && transaction.full_name) {
                    const customerName = transaction.full_name.split(' ')[0];
                    const gameName = transaction.game;
                    const packageName = transaction.package_name;
                    const finalPrice = transaction.final_price;
                    const currency = transaction.currency;
                    const playerId = transaction.player_id; 
                    const transactionIdDisplay = transaction.id_transaccion; 
                    const paymentMethod = transaction.payment_method;
                    const receiptUrl = transaction.receipt_url || 'No disponible';

                    const customerWhatsappNumberClean = transaction.whatsapp_number.replace(/\D/g, ''); 

                    const whatsappMessageCustomer = `
🎉 ¡Hola ${customerName}! 🎉

¡Tu recarga ha sido *COMPLETADA* por GamingKings! Ya puedes disfrutar de tu juego.

Aquí tienes el resumen de tu compra (Factura# ${transactionIdDisplay}):

*Juego:* ${escapeMarkdownV2(gameName)}
*ID de Jugador:* ${escapeMarkdownV2(playerId || 'N/A')}
*Paquete:* ${escapeMarkdownV2(packageName)}
*Monto Pagado:* ${escapeMarkdownV2(finalPrice)} ${escapeMarkdownV2(currency)}
*Método de Pago:* ${escapeMarkdownV2(paymentMethod.replace('-', ' ').toUpperCase())}
${receiptUrl !== 'No disponible' ? `*Comprobante:* [Ver aquí](${escapeMarkdownV2(receiptUrl)})` : ''}

¡Gracias por elegir GamingKings!
                    `.trim();

                    whatsappLinkCompletedCustomer = `https://wa.me/${customerWhatsappNumberClean}?text=${encodeURIComponent(whatsappMessageCustomer)}`;
                    console.log(`Enlace de WhatsApp 'Factura Completada' generado para cliente ${transaction.whatsapp_number}.`);
                } else {
                    console.log(`No hay número de WhatsApp o nombre completo para el cliente de la transacción ${transactionId}. No se generará el enlace de WhatsApp de factura.`);
                }

                // Definir los nuevos botones para el mensaje editado
                let updatedInlineKeyboard = [];
                updatedInlineKeyboard.push([{ text: "✅ Recarga Realizada", callback_data: `completed_status_${transactionId}` }]); // Botón de estado

                if (whatsappLinkCompletedCustomer) {
                    // Nuevo botón de factura como URL directa
                    updatedInlineKeyboard.push([{ text: "📲 WhatsApp Cliente (Factura)", url: whatsappLinkCompletedCustomer }]);
                } else {
                     // Si no se puede generar el enlace, puedes añadir un mensaje informativo o un botón que lo indique
                     updatedInlineKeyboard.push([{ text: "⚠️ Cliente sin WhatsApp para factura", callback_data: `no_whatsapp_factura_${transactionId}` }]);
                }

                const updatedReplyMarkup = {
                    inline_keyboard: updatedInlineKeyboard
                };

                try {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: messageId,
                        text: escapedNewCaption,
                        parse_mode: 'MarkdownV2',
                        reply_markup: updatedReplyMarkup,
                        disable_web_page_preview: true
                    });
                    console.log(`DEBUG: Mensaje de Telegram para ${transactionId} editado con éxito, incluyendo botón de factura.`);
                } catch (telegramEditError) {
                    console.error(`ERROR: Fallo al editar mensaje de Telegram para ${transactionId}:`, telegramEditError.response ? telegramEditError.response.data : telegramEditError.message);
                    if (telegramEditError.response && telegramEditError.response.status === 400 && 
                       (telegramEditError.response.data.description && telegramEditError.response.data.description.includes('message is not modified'))) {
                        console.log(`DEBUG: Mensaje ${messageId} para ${transactionId} no modificado o ya editado. Ignorando este error ya que la DB fue actualizada.`);
                    } else if (telegramEditError.response && telegramEditError.response.status === 400 &&
                               (telegramEditError.response.data.description && telegramEditError.response.data.description.includes('message to edit not found'))) {
                        console.log(`DEBUG: Mensaje ${messageId} para ${transactionId} no encontrado, probablemente eliminado. Ignorando este error.`);
                    } else {
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                            chat_id: chatId,
                            text: escapeMarkdownV2(`⚠️ Advertencia: Recarga ${transactionId} marcada como *REALIZADA* en la base de datos, pero hubo un problema al editar el mensaje de Telegram.`),
                            parse_mode: 'MarkdownV2'
                        });
                    }
                }
            }
            // --- Lógica: Manejar el botón "send_whatsapp_" (ESTO ES PARA BOTONES ANTIGUOS) ---
            // Si el proceso-payment ahora genera URLs directas, este bloque solo se activaría si se presiona
            // un botón de una notificación vieja que aún use 'send_whatsapp_' como callback_data.
            // Para las nuevas notificaciones, el botón de Recargador es una URL directa.
            else if (data.startsWith('send_whatsapp_')) { // Antiguo callback_data para recargador, por si acaso
                 const transactionId = data.replace('send_whatsapp_', '');
                 const transaction = await getTransaction(transactionId);
 
                 if (!transaction) {
                     return { statusCode: 200, body: "Error fetching transaction for send_whatsapp" };
                 }
                 
                 // Construir el mensaje de WhatsApp para el recargador
                 const recargadorWhatsappNumber = WHATSAPP_NUMBER_RECARGADOR.replace(/\D/g, ''); 
                 const packageNameForWhatsapp = (transaction.package_name || 'N/A').replace(/\+/g, '%2B');
                 let whatsappMessageRecargador = `Hola. Por favor, realiza esta recarga lo antes posible.\n\n`;
                 whatsappMessageRecargador += `*ID de Jugador:* ${transaction.player_id || 'N/A'}\n`;
                 whatsappMessageRecargador += `*Paquete a Recargar:* ${packageNameForWhatsapp}\n`;
                 const whatsappLinkRecargador = `https://wa.me/${recargadorWhatsappNumber}?text=${encodeURIComponent(whatsappMessageRecargador)}`;
 
                 // Simplemente responder al callback y enviar el enlace al chat (ya que el botón original era un callback_data)
                 await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                     callback_query_id: callbackQuery.id,
                     text: `Generando enlace de WhatsApp para el recargador...`,
                     show_alert: false
                 });
                 
                 await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: escapeMarkdownV2(`👉 *Enlace para el recargador de la transacción ${transactionId}:* [Haz clic aquí](${whatsappLinkRecargador})`),
                    parse_mode: 'MarkdownV2',
                    disable_web_page_preview: true
                 });

                 console.log(`Enlace de WhatsApp para recargador generado (desde viejo callback) para transacción ${transactionId}: ${whatsappLinkRecargador}`);
             } else if (data.startsWith('completed_status_') || data.startsWith('no_whatsapp_factura_')) {
                // Si el usuario hace clic en el botón de "Recarga Realizada" o "Cliente sin WhatsApp para factura"
                // después de que el mensaje ya fue editado a "Realizada", simplemente responde al callback
                // para que el botón no parezca "pegado".
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: "Acción ya completada o informativa.",
                    show_alert: false
                });
             }
        }

        return { statusCode: 200, body: "Webhook processed" };
    } catch (error) {
        console.error("Error en el webhook de Telegram:", error.message);
        return { statusCode: 500, body: `Error en el webhook: ${error.message}` };
    }
};