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
    const NETLIFY_SITE_URL = process.env.URL || 'https://gamingkings.netlify.app';

    if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !NETLIFY_SITE_URL) {
        console.error("Faltan variables de entorno requeridas para el webhook de Telegram.");
        return { statusCode: 500, body: "Error de configuración del servidor." };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    try {
        const body = JSON.parse(event.body);
        const callbackQuery = body.callback_query;

        // Función para obtener la transacción
        async function getTransaction(id) {
            console.log(`DEBUG: Buscando transacción con id_transaccion: ${id}`);
            const { data: transaction, error: fetchError } = await supabase
                .from('transactions')
                .select('id_transaccion, game, player_id, package_name, final_price, currency, payment_method, status, email, full_name, whatsapp_number, receipt_url, invoice_text_content')
                .eq('id_transaccion', id)
                .single();
            
            if (fetchError && fetchError.code === 'PGRST116') {
                console.error("Error al obtener la transacción de Supabase: Transacción no encontrada.", `Transaction ID: ${id}`);
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: "❌ Error: Transacción no encontrada. Verifica la ID.",
                    show_alert: true
                });
                return null;
            } else if (fetchError) {
                console.error("Error al obtener la transacción de Supabase:", fetchError.message, `Transaction ID: ${id}`);
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `❌ Error de Supabase: ${escapeMarkdownV2(fetchError.message)}`,
                    show_alert: true
                });
                return null;
            }
            return transaction;
        }

        if (callbackQuery) {
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;
            const userId = callbackQuery.from.id;
            const userName = callbackQuery.from.first_name || `Usuario ${userId}`;
            const data = callbackQuery.data;

            // Handler unificado para 'update_transaction'
            if (data.startsWith('update_transaction:')) {
                const parts = data.split(':');
                const transactionId = parts[1];
                const status = parts[2];
                
                console.log(`DEBUG: Callback Data - Action: update_transaction, Transaction ID: ${transactionId}, Status: ${status}`);

                const transaction = await getTransaction(transactionId);
                
                if (!transaction) {
                    return { statusCode: 200, body: "Error fetching transaction" };
                }

                if (transaction.status === status) {
                    console.log(`DEBUG: Transacción ${transactionId} ya está en estado '${status}'.`);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQuery.id,
                        text: `La transacción ya se encuentra en estado '${status}'.`,
                        show_alert: false
                    });
                    return { statusCode: 200, body: "Status not changed" };
                }

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Marcando la transacción ${transactionId} como '${status}'...`,
                    show_alert: false
                });

                // Procesar la lógica de KingCoins si la transacción fue 'realizada'
                if (status === 'realizada' && transaction.payment_method.toLowerCase().includes('kingcoins')) {
                    console.log(`DEBUG: Procesando acreditación de KingCoins para transacción ${transactionId}.`);
                    const now = new Date();
                    const day = String(now.getDate()).padStart(2, '0');
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const year = now.getFullYear();
                    const formattedDate = `${day}/${month}/${year}`;
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    const formattedTime = `${hours}:${minutes}`;

                    const cleanedPackageName = transaction.package_name.includes('<i class="fas fa-crown"></i>')
                        ? transaction.package_name.replace('<i class="fas fa-crown"></i>', ' KingCoins')
                        : transaction.package_name;

                    const kingcoinAmountMatch = cleanedPackageName.match(/(\d+)\s*KingCoins/i);
                    const kingcoinAmount = kingcoinAmountMatch ? parseInt(kingcoinAmountMatch[1], 10) : 0;

                    let kingcoinsCreditedMessage = '';

                    if (kingcoinAmount > 0 && transaction.player_id) {
                        try {
                            const { data: userWallet, error: fetchWalletError } = await supabase
                                .from('user_wallets')
                                .select('balance')
                                .eq('user_id', transaction.player_id)
                                .single();

                            if (fetchWalletError && fetchWalletError.code === 'PGRST116') {
                                const { error: insertWalletError } = await supabase
                                    .from('user_wallets')
                                    .insert({
                                        user_id: transaction.player_id,
                                        balance: kingcoinAmount
                                    });
                                if (insertWalletError) {
                                    console.error(`Error al insertar nueva wallet para ${transaction.player_id}:`, insertWalletError.message);
                                    kingcoinsCreditedMessage = `\n⚠️ Error al crear wallet para \`${transaction.player_id}\`: ${escapeMarkdownV2(insertWalletError.message)}`;
                                } else {
                                    console.log(`Wallet creada y ${kingcoinAmount} KingCoins acreditados a ${transaction.player_id}.`);
                                    kingcoinsCreditedMessage = `\n✅ ${kingcoinAmount} KingCoins acreditados a \`${transaction.player_id}\`.`;
                                }
                            } else if (fetchWalletError) {
                                console.error(`Error al obtener wallet para ${transaction.player_id}:`, fetchWalletError.message);
                                kingcoinsCreditedMessage = `\n⚠️ Error al obtener wallet para \`${transaction.player_id}\`: ${escapeMarkdownV2(fetchWalletError.message)}`;
                            } else {
                                const newBalance = userWallet.balance + kingcoinAmount;
                                const { error: updateWalletError } = await supabase
                                    .from('user_wallets')
                                    .update({ balance: newBalance })
                                    .eq('user_id', transaction.player_id);

                                if (updateWalletError) {
                                    console.error(`Error al actualizar wallet para ${transaction.player_id}:`, updateWalletError.message);
                                    kingcoinsCreditedMessage = `\n⚠️ Error al actualizar wallet para \`${transaction.player_id}\`: ${escapeMarkdownV2(updateWalletError.message)}`;
                                } else {
                                    console.log(`${kingcoinAmount} KingCoins acreditados a ${transaction.player_id}. Nuevo saldo: ${newBalance}`);
                                    kingcoinsCreditedMessage = `\n✅ ${kingcoinAmount} KingCoins acreditados a \`${transaction.player_id}\`. Nuevo saldo: \`${newBalance}\`.`;
                                }
                            }
                        } catch (walletOperationError) {
                            console.error("Error inesperado en operación de wallet:", walletOperationError.message);
                            kingcoinsCreditedMessage = `\n❌ Error inesperado al acreditar KingCoins: ${escapeMarkdownV2(walletOperationError.message)}`;
                        }
                    } else {
                        kingcoinsCreditedMessage = `\nℹ️ No se pudieron acreditar KingCoins (cantidad 0 o ID de jugador/usuario no válida).`;
                    }
                }

                // Preparar el texto para la factura
                const now = new Date();
                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const year = now.getFullYear();
                const formattedDate = `${day}/${month}/${year}`;
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const formattedTime = `${hours}:${minutes}`;

                let invoiceTextContent = null;
                if (status === 'realizada' && transaction.payment_method.toLowerCase().includes('kingcoins')) {
                    const cleanedPackageName = transaction.package_name.includes('<i class="fas fa-crown"></i>')
                        ? transaction.package_name.replace('<i class="fas fa-crown"></i>', ' KingCoins')
                        : transaction.package_name;
                    invoiceTextContent = `
🎉 ¡Hola! 👋

¡Tu compra de KingCoins ha sido *COMPLETADA* por GamingKings!

Aquí tienes los detalles de tu transacción:
---
*Factura #${escapeMarkdownV2(transaction.id_transaccion)}*
*Estado: LIBERADO ✅* 📅 Fecha: ${formattedDate}
👑 Producto: KingCoins
💰 Cantidad Comprada: ${escapeMarkdownV2(cleanedPackageName)}
💲 Monto Pagado: ${escapeMarkdownV2(transaction.final_price)} ${escapeMarkdownV2(transaction.currency)}
💳 Método de Pago: ${escapeMarkdownV2(transaction.payment_method.replace('-', ' ').toUpperCase())}
---
¡Gracias por tu compra! ✨
`.trim();
                } else if (status === 'realizada') {
                    invoiceTextContent = `
🎉 ¡Hola! 👋

¡Tu recarga ha sido *COMPLETADA* por GamingKings!

Aquí tienes los detalles de tu recarga:
---
*Factura #${escapeMarkdownV2(transaction.id_transaccion)}*
*Estado: REALIZADA ✅* 📅 Fecha: ${formattedDate}
🎮 Juego: ${escapeMarkdownV2(transaction.game)}
👤 ID de Jugador: ${escapeMarkdownV2(transaction.player_id || 'N/A')}
📦 Paquete: ${escapeMarkdownV2(transaction.package_name.includes('<i class="fas fa-crown"></i>') ? transaction.package_name.replace('<i class="fas fa-crown"></i>', ' KingCoins') : transaction.package_name)}
💰 Monto Pagado: ${escapeMarkdownV2(transaction.final_price)} ${escapeMarkdownV2(transaction.currency)}
💳 Método de Pago: ${escapeMarkdownV2(transaction.payment_method.replace('-', ' ').toUpperCase())}
---
¡Gracias por tu compra! ✨
`.trim();
                } else if (status === 'rechazada') {
                    invoiceTextContent = `
👋 ¡Hola!

Lamentamos informarte que tu recarga con el ID de transacción *#${escapeMarkdownV2(transaction.id_transaccion)}* ha sido *RECHAZADA* ❌.

Esto puede deberse a:
- El pago no fue verificado.
- Datos incorrectos en la solicitud.
- O algún otro problema técnico.

Puedes intentar realizar la compra de nuevo. Si crees que se trata de un error, por favor contacta con el soporte de GamingKings.

¡Gracias por tu comprensión!
`.trim();
                }
                
                const updateData = {
                    status: status,
                    completed_at: status === 'realizada' ? new Date().toISOString() : null,
                    completed_by: status === 'realizada' ? userName : null,
                    invoice_text_content: invoiceTextContent
                };

                const { error: updateError } = await supabase
                    .from('transactions')
                    .update(updateData)
                    .eq('id_transaccion', transactionId);

                if (updateError) {
                    console.error("Error al actualizar la transacción en Supabase:", updateError.message, `Transaction ID: ${transactionId}`);
                    return { statusCode: 200, body: "Error updating transaction status" };
                }
                
                console.log(`Transacción ${transactionId} actualizada a '${status}' en Supabase.`);

                let newCaption = callbackQuery.message.text;
                const statusText = status === 'realizada' ? 'REALIZADA' : 'RECHAZADA';
                const statusEmoji = status === 'realizada' ? '✅' : '❌';
                newCaption = newCaption.replace('Estado: PENDIENTE', `Estado: ${statusText} ${statusEmoji}`);
                
                const statusLine = `Marcada por: *${escapeMarkdownV2(userName)}*`;
                if (!newCaption.includes(statusLine)) {
                    newCaption += `\n\n${statusLine} (${escapeMarkdownV2(formattedTime)} ${escapeMarkdownV2(formattedDate)})`;
                }

                let updatedInlineKeyboard = [];

                if (status === 'realizada' || status === 'rechazada') {
                    updatedInlineKeyboard.push([{ text: `${statusEmoji} Recarga ${statusText}`, callback_data: `completed_status_${transactionId}` }]);
                    
                    if (status === 'realizada' && transaction.whatsapp_number && transaction.whatsapp_number.trim() !== '') {
                        const customerWhatsappNumberFormatted = transaction.whatsapp_number.startsWith('+') ? transaction.whatsapp_number : `+${transaction.whatsapp_number}`;
                        const invoiceLink = `${NETLIFY_SITE_URL}/.netlify/functions/get-invoice?id=${encodeURIComponent(transaction.id_transaccion)}`;
                        const shortWhatsappMessage = `
🎉 ¡Hola! 👋
¡Tu recarga con la ID de transaccion: \`${escapeMarkdownV2(transaction.id_transaccion)}\` ha sido *COMPLETADA* por GamingKings!
Puedes ver los detalles de tu factura aquí: ${escapeMarkdownV2(invoiceLink)}
¡Gracias por tu compra! ✨
`.trim();
                        const whatsappLinkCompletedCustomer = `https://wa.me/${customerWhatsappNumberFormatted}?text=${encodeURIComponent(shortWhatsappMessage)}`;
                        updatedInlineKeyboard.push([{ text: "📲 WhatsApp Cliente (Factura)", url: whatsappLinkCompletedCustomer }]);
                    } else if (status === 'realizada') {
                        updatedInlineKeyboard.push([{ text: "⚠️ Cliente sin WhatsApp para factura", callback_data: `no_whatsapp_factura_${transactionId}` }]);
                    }
                }

                const updatedReplyMarkup = {
                    inline_keyboard: updatedInlineKeyboard
                };

                try {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: messageId,
                        text: newCaption, 
                        parse_mode: 'MarkdownV2',
                        reply_markup: updatedReplyMarkup,
                        disable_web_page_preview: true
                    });
                    console.log(`DEBUG: Mensaje de Telegram para ${transactionId} editado con éxito.`);
                } catch (telegramEditError) {
                    console.error(`ERROR: Fallo al editar mensaje de Telegram para ${transactionId}:`, telegramEditError.response ? telegramEditError.response.data : telegramEditError.message);
                }
            }
            // Handler para 'send_whatsapp_'
            else if (data.startsWith('send_whatsapp_')) {
                const transactionId = data.replace('send_whatsapp_', '');
                const transaction = await getTransaction(transactionId);
                
                if (!transaction) {
                    return { statusCode: 200, body: "Error fetching transaction for send_whatsapp" };
                }
                
                const recargadorWhatsappNumberFormatted = WHATSAPP_NUMBER_RECARGADOR.startsWith('+') ? WHATSAPP_NUMBER_RECARGADOR : `+${WHATSAPP_NUMBER_RECARGADOR}`;
                
                const cleanedPackageNameForRecargador = transaction.package_name.includes('<i class="fas fa-crown"></i>')
                    ? transaction.package_name.replace('<i class="fas fa-crown"></i>', ' KingCoins')
                    : transaction.package_name;

                let whatsappMessageRecargador = `Hola. Por favor, realiza esta recarga lo antes posible.\n\n`;
                whatsappMessageRecargador += `*ID de Transacción:* ${escapeMarkdownV2(transaction.id_transaccion || 'N/A')}\n`;
                whatsappMessageRecargador += `*ID de Jugador:* ${escapeMarkdownV2(transaction.player_id || 'N/A')}\n`;
                whatsappMessageRecargador += `*Paquete a Recargar:* ${escapeMarkdownV2(cleanedPackageNameForRecargador || 'N/A')}\n`;
                
                const whatsappLinkRecargador = `https://wa.me/${recargadorWhatsappNumberFormatted}?text=${encodeURIComponent(whatsappMessageRecargador)}`;

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Generando enlace de WhatsApp para el recargador de ${escapeMarkdownV2(transactionId)}...`,
                    show_alert: false
                });
                
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: `👉 *Enlace para el recargador de la transacción \`${escapeMarkdownV2(transactionId)}\`:* [Haz clic aquí](${escapeMarkdownV2(whatsappLinkRecargador)})`,
                    parse_mode: 'MarkdownV2',
                    disable_web_page_preview: true
                });

                console.log(`Enlace de WhatsApp para recargador generado para transacción ${transactionId}.`);
            }
            // Handler para callbacks de estado finalizados/informativos
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
        const body = JSON.parse(event.body || '{}');
        if (body && body.message && body.message.chat && body.message.chat.id) {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: body.message.chat.id,
                text: escapeMarkdownV2(`❌ Ha ocurrido un error inesperado al procesar la solicitud. Por favor, revisa los logs de Netlify. Detalles: \`${escapeMarkdownV2(error.message)}\``),
                parse_mode: 'MarkdownV2'
            }).catch(e => console.error("Error sending generic error message to Telegram:", e.message));
        }
        return { statusCode: 500, body: `Error en el webhook: ${error.message}` };
    }
};