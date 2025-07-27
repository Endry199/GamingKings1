// netlify/functions/telegram-webhook.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js'); // Correcto: @supabase/supabase-js

// Función para escapar caracteres especiales de MarkdownV2 para Telegram
// Esta función SÍ se usa para los mensajes de Telegram, pero NO para el contenido de la factura
function escapeMarkdownV2(text) {
    if (typeof text !== 'string') {
        text = String(text);
    }
    // Caracteres especiales que Telegram MarkdownV2 requiere escapar
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
    // Usaremos la URL de tu sitio Netlify como base para la función de factura
    // Esta variable ya debería estar disponible en el entorno de Netlify como process.env.URL
    const NETLIFY_SITE_URL = process.env.URL || 'https://gamingkings.netlify.app'; 


    if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !NETLIFY_SITE_URL) { 
        console.error("Faltan variables de entorno requeridas para el webhook de Telegram.");
        console.error(`Missing TELEGRAM_BOT_TOKEN: ${!TELEGRAM_BOT_TOKEN}`);
        console.error(`Missing SUPABASE_URL: ${!SUPABASE_URL}`);
        console.error(`Missing SUPABASE_SERVICE_KEY: ${!SUPABASE_SERVICE_KEY}`);
        console.error(`Missing NETLIFY_SITE_URL: ${!NETLIFY_SITE_URL}`);
        return { statusCode: 500, body: "Error de configuración del servidor." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    try {
        const body = JSON.parse(event.body);
        console.log("Telegram Webhook Event:", JSON.stringify(body, null, 2)); 
        const callbackQuery = body.callback_query;

        if (callbackQuery) {
            const chatId = callbackQuery.message.chat.id; 
            const messageId = callbackQuery.message.message_id;
            const userId = callbackQuery.from.id;
            const userName = callbackQuery.from.first_name || `Usuario ${userId}`;
            const data = callbackQuery.data;

            async function getTransaction(id) {
                const { data: transaction, error: fetchError } = await supabase
                    .from('transactions')
                    .select('id_transaccion, game, player_id, package_name, final_price, currency, payment_method, status, email, full_name, whatsapp_number, receipt_url, invoice_text_content')
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
                    const currentMessageText = callbackQuery.message.text;
                    const newTextIfAlreadyDone = currentMessageText.includes('REALIZADA') ? currentMessageText : currentMessageText.replace('Estado: `PENDIENTE`', 'Estado: `REALIZADA` ✅');
                    
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: messageId,
                        text: escapeMarkdownV2(newTextIfAlreadyDone),
                        parse_mode: 'MarkdownV2',
                        reply_markup: {
                            inline_keyboard: [[{ text: "✅ Recarga Realizada", callback_data: `completed_status_${transactionId}` }]] 
                        }
                    });

                    return { statusCode: 200, body: "Already completed" };
                }

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Procesando recarga ${transactionId}...`,
                    show_alert: false
                });

                const now = new Date();
                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const year = now.getFullYear();
                const formattedDate = `${day}/${month}/${year}`;
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const formattedTime = `${hours}:${minutes}`;
                
                // --- Construimos la factura de texto para guardar ---
                // *** AQUÍ ES DONDE SE QUITA el escapeMarkdownV2 para el contenido de la factura ***
                let invoiceTextContent = `
🎉 ¡Hola! 👋

¡Tu recarga ha sido *COMPLETADA* por GamingKings!

Aquí tienes los detalles de tu recarga:
---
*Factura #${transaction.id_transaccion}*
*Estado: REALIZADA ✅* 📅 Fecha: ${formattedDate}
🎮 Juego: ${transaction.game}
👤 ID de Jugador: ${transaction.player_id || 'N/A'}
📦 Paquete: ${transaction.package_name}
💰 Monto Pagado: ${transaction.final_price} ${transaction.currency}
💳 Método de Pago: ${transaction.payment_method.replace('-', ' ').toUpperCase()}
---
¡Gracias por tu compra! ✨
                `.trim();

                const { error: updateError } = await supabase
                    .from('transactions')
                    .update({
                        status: 'realizada',
                        completed_at: new Date().toISOString(),
                        completed_by: userName,
                        invoice_text_content: invoiceTextContent // Guardamos la factura de texto limpia
                    })
                    .eq('id_transaccion', transactionId);

                if (updateError) {
                    console.error("Error al actualizar la transacción en Supabase:", updateError.message);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2(`❌ Error al marcar la transacción ${transactionId} como realizada en la DB: ${updateError.message}. Por favor, inténtalo de nuevo o revisa los logs.`),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error updating transaction status" };
                }
                
                console.log(`Transacción ${transactionId} marcada como realizada en Supabase y factura generada.`);

                let newCaption = callbackQuery.message.text;
                newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `REALIZADA` ✅');
                newCaption += `\n\nRecarga marcada por: *${userName}* (${formattedTime} ${formattedDate})`;

                // --- Generar el enlace corto de WhatsApp para el cliente ---
                let whatsappLinkCompletedCustomer = null;
                if (transaction.whatsapp_number && transaction.whatsapp_number.trim() !== '') {
                    // MODIFICACIÓN CLAVE AQUÍ: Usamos directamente transaction.whatsapp_number
                    // Aseguramos que tenga el '+' aunque la DB ya lo guarde así
                    const customerWhatsappNumberFormatted = transaction.whatsapp_number.startsWith('+') ? transaction.whatsapp_number : `+${transaction.whatsapp_number}`;
                    
                    // Construimos la URL de la función Netlify que servirá la factura
                    // Usamos NETLIFY_SITE_URL para el dominio de tu sitio
                    const invoiceLink = `${NETLIFY_SITE_URL}/.netlify/functions/get-invoice?id=${transaction.id_transaccion}`;
                    
                    // Mensaje corto para WhatsApp
                    // ¡Importante! No escapar la invoiceLink con escapeMarkdownV2 aquí,
                    // ya que es una URL para un parámetro de URL, no texto Markdown.
                    const shortWhatsappMessage = `
🎉 ¡Hola! 👋

¡Tu recarga con la ID de transaccion: ${escapeMarkdownV2(transaction.id_transaccion)}. ha sido *COMPLETADA* por GamingKings!

Puedes ver los detalles de tu factura aquí: ${invoiceLink}

¡Gracias por tu compra! ✨
                    `.trim();

                    whatsappLinkCompletedCustomer = `https://wa.me/${customerWhatsappNumberFormatted}?text=${encodeURIComponent(shortWhatsappMessage)}`;
                    
                    console.log(`Enlace de WhatsApp 'Factura Completada' generado para cliente ${transaction.whatsapp_number}.`);
                } else {
                    console.log(`No hay número de WhatsApp para el cliente de la transacción ${transactionId}. No se generará el enlace de WhatsApp de factura.`);
                }

                // Definir los nuevos botones para el mensaje editado
                let updatedInlineKeyboard = [];
                updatedInlineKeyboard.push([{ text: "✅ Recarga Realizada", callback_data: `completed_status_${transactionId}` }]); 

                if (whatsappLinkCompletedCustomer) {
                    updatedInlineKeyboard.push([{ text: "📲 WhatsApp Cliente (Factura)", url: whatsappLinkCompletedCustomer }]);
                } else {
                    updatedInlineKeyboard.push([{ text: "⚠️ Cliente sin WhatsApp para factura", callback_data: `no_whatsapp_factura_${transactionId}` }]);
                }

                const updatedReplyMarkup = {
                    inline_keyboard: updatedInlineKeyboard
                };

                try {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: messageId,
                        text: escapeMarkdownV2(newCaption), // Este mensaje de Telegram SÍ necesita escape
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
                                 telegramEditError.response.data.description && telegramEditError.response.data.description.includes('message to edit not found')) {
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
            else if (data.startsWith('send_whatsapp_')) { 
               const transactionId = data.replace('send_whatsapp_', '');
               const transaction = await getTransaction(transactionId);
               
               if (!transaction) {
                   return { statusCode: 200, body: "Error fetching transaction for send_whatsapp" };
               }
               
               // Asumimos que WHATSAPP_NUMBER_RECARGADOR ya tiene el prefijo '+' o lo añadimos
               const recargadorWhatsappNumberFormatted = WHATSAPP_NUMBER_RECARGADOR.startsWith('+') ? WHATSAPP_NUMBER_RECARGADOR : `+${WHATSAPP_NUMBER_RECARGADOR}`;
               
               let whatsappMessageRecargador = `Hola. Por favor, realiza esta recarga lo antes posible.\n\n`;
               whatsappMessageRecargador += `*ID de Jugador:* ${transaction.player_id || 'N/A'}\n`;
               whatsappMessageRecargador += `*Paquete a Recargar:* ${transaction.package_name.replace(/\+/g, '%2B') || 'N/A'}\n`; 
               
               const whatsappLinkRecargador = `https://wa.me/${recargadorWhatsappNumberFormatted}?text=${encodeURIComponent(whatsappMessageRecargador)}`;

               await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                   callback_query_id: callbackQuery.id,
                   text: `Generando enlace de WhatsApp para el recargador...`,
                   show_alert: false
               });
               
               await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                   chat_id: chatId,
                   text: escapeMarkdownV2(`👉 *Enlace para el recargador de la transacción \`${transactionId}\`:* [Haz clic aquí](${whatsappLinkRecargador})`),
                   parse_mode: 'MarkdownV2',
                   disable_web_page_preview: true
               });

               console.log(`Enlace de WhatsApp para recargador generado (desde viejo callback) para transacción ${transactionId}: ${whatsappLinkRecargador}`);
           }
            else if (data.startsWith('completed_status_') || data.startsWith('no_whatsapp_factura_')) {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: "Acción ya completada o informativa.",
                    show_alert: false
                });
            }
        }

        return { statusCode: 200, body: "Webhook processed" };
    } catch (error) {
        console.error("Error en el webhook de Telegram:", error.response ? error.response.data : error.message);
        if (body && body.message && body.message.chat && body.message.chat.id) {
             await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                 chat_id: body.message.chat.id,
                 text: escapeMarkdownV2(`❌ Ha ocurrido un error inesperado al procesar la solicitud. Por favor, revisa los logs de Netlify.`),
                 parse_mode: 'MarkdownV2'
             }).catch(e => console.error("Error sending generic error message to Telegram:", e.message));
        }
        return { statusCode: 500, body: `Error en el webhook: ${error.message}` };
    }
};