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

            // --- Handler para 'mark_done_' (juegos existentes) ---
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
                    
                    try {
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                            chat_id: chatId,
                            message_id: messageId,
                            text: escapeMarkdownV2(newTextIfAlreadyDone), 
                            parse_mode: 'MarkdownV2',
                            reply_markup: {
                                inline_keyboard: [[{ text: "✅ Recarga Realizada", callback_data: `completed_status_${transactionId}` }]] 
                            }
                        });
                    } catch (editErrorIfAlreadyDone) {
                        console.error(`ERROR (Already Done): Fallo al editar mensaje de Telegram para ${transactionId}:`, editErrorIfAlreadyDone.response ? editErrorIfAlreadyDone.response.data : editErrorIfAlreadyDone.message);
                        if (editErrorIfAlreadyDone.response && editErrorIfAlreadyDone.response.status === 400 && 
                            (editErrorIfAlreadyDone.response.data.description && editErrorIfAlreadyDone.response.data.description.includes('message is not modified'))) {
                            console.log(`DEBUG: Mensaje ${messageId} para ${transactionId} no modificado (ya tenía el estado 'REALIZADA').`);
                        } else {
                            console.error(`ERROR: Fallo al re-editar mensaje para transacción ${transactionId} que ya estaba realizada.`);
                        }
                    }

                    return { statusCode: 200, body: "Already completed" };
                }

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Procesando recarga ${escapeMarkdownV2(transactionId)}...`,
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
                        invoice_text_content: invoiceTextContent 
                    })
                    .eq('id_transaccion', transactionId);

                if (updateError) {
                    console.error("Error al actualizar la transacción en Supabase:", updateError.message);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2(`❌ Error al marcar la transacción \`${transactionId}\` como realizada en la DB: ${updateError.message}. Por favor, inténtalo de nuevo o revisa los logs.`),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error updating transaction status" };
                }
                
                console.log(`Transacción ${transactionId} marcada como realizada en Supabase y factura generada.`);

                let newCaption = callbackQuery.message.text;
                newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `REALIZADA` ✅');
                newCaption += `\n\nRecarga marcada por: *${escapeMarkdownV2(userName)}* (${escapeMarkdownV2(formattedTime)} ${escapeMarkdownV2(formattedDate)})`;

                let updatedInlineKeyboard = [];
                updatedInlineKeyboard.push([{ text: "✅ Recarga Realizada", callback_data: `completed_status_${transactionId}` }]); 

                const updatedReplyMarkup = {
                    inline_keyboard: updatedInlineKeyboard
                };

                try {
                    console.log(`DEBUG (mark_done_): Intentando editar mensaje con el siguiente texto escapado:\n${JSON.stringify(escapeMarkdownV2(newCaption))}`);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: messageId,
                        text: escapeMarkdownV2(newCaption), 
                        parse_mode: 'MarkdownV2',
                        reply_markup: updatedReplyMarkup,
                        disable_web_page_preview: true
                    });
                    console.log(`DEBUG: Mensaje de Telegram para ${transactionId} editado con éxito.`);
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
                            text: escapeMarkdownV2(`⚠️ Advertencia: Recarga \`${transactionId}\` marcada como *REALIZADA* en la base de datos, pero hubo un problema al editar el mensaje de Telegram.`),
                            parse_mode: 'MarkdownV2'
                        });
                    }
                }
            }
            // --- Handler para 'release_kingcoins_' ---
            else if (data.startsWith('release_kingcoins_')) {
                const transactionId = data.replace('release_kingcoins_', '');
                const transaction = await getTransaction(transactionId);

                if (!transaction) {
                    return { statusCode: 200, body: "Error fetching transaction for KingCoins release" };
                }

                if (transaction.status === 'realizada') {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQuery.id,
                        text: "¡Estos KingCoins ya fueron liberados!",
                        show_alert: true
                    });
                    
                    let newCaption = callbackQuery.message.text;
                    newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `LIBERADO` ✅');
                    newCaption += `\n\nKingCoins liberados por: *${escapeMarkdownV2(userName)}*`; 

                    let updatedInlineKeyboard = [];
                    updatedInlineKeyboard.push([{ text: "✅ KingCoins Liberados", callback_data: `completed_status_${transactionId}` }]); 

                    const updatedReplyMarkup = {
                        inline_keyboard: updatedInlineKeyboard
                    };

                    try {
                        console.log(`DEBUG (release_kingcoins_ - Already Liberated): Intentando editar mensaje con el siguiente texto escapado:\n${JSON.stringify(escapeMarkdownV2(newCaption))}`);
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                            chat_id: chatId,
                            message_id: messageId,
                            text: escapeMarkdownV2(newCaption),
                            parse_mode: 'MarkdownV2',
                            reply_markup: updatedReplyMarkup,
                            disable_web_page_preview: true
                        });
                        console.log(`DEBUG: Mensaje de Telegram para KingCoins ${transactionId} editado con éxito (ya estaba liberado).`);
                    } catch (telegramEditError) {
                        console.error(`ERROR (Already Liberated): Fallo al editar mensaje de Telegram para KingCoins ${transactionId}:`, telegramEditError.response ? telegramEditError.response.data : telegramEditError.message);
                        if (telegramEditError.response && telegramEditError.response.status === 400 && 
                           (telegramEditError.response.data.description && telegramEditError.response.data.description.includes('message is not modified'))) {
                            console.log(`DEBUG: Mensaje ${messageId} para KingCoins ${transactionId} no modificado (ya tenía el estado 'LIBERADO').`);
                        } else {
                            console.error(`ERROR: Fallo al re-editar mensaje para transacción KingCoins ${transactionId} que ya estaba liberada.`);
                        }
                    }
                    return { statusCode: 200, body: "KingCoins already confirmed" };
                }

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Liberando KingCoins para transacción ${escapeMarkdownV2(transactionId)}...`,
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
                                console.error("Error al insertar nueva wallet de usuario:", insertWalletError.message);
                                kingcoinsCreditedMessage = `\n⚠️ Error al crear wallet para \`${transaction.player_id}\`: ${escapeMarkdownV2(insertWalletError.message)}`;
                            } else {
                                console.log(`Wallet creada y ${kingcoinAmount} KingCoins acreditados a ${transaction.player_id}.`);
                                kingcoinsCreditedMessage = `\n✅ ${kingcoinAmount} KingCoins acreditados a \`${transaction.player_id}\`.`;
                            }
                        } else if (fetchWalletError) {
                            console.error("Error al obtener wallet de usuario:", fetchWalletError.message);
                            kingcoinsCreditedMessage = `\n⚠️ Error al obtener wallet para \`${transaction.player_id}\`: ${escapeMarkdownV2(fetchWalletError.message)}`;
                        } else {
                            const newBalance = userWallet.balance + kingcoinAmount; 
                            const { error: updateWalletError } = await supabase
                                .from('user_wallets') 
                                .update({ balance: newBalance }) 
                                .eq('user_id', transaction.player_id);

                            if (updateWalletError) {
                                console.error("Error al actualizar wallet de usuario:", updateWalletError.message);
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

                let invoiceTextContent = `
🎉 ¡Hola! 👋

¡Tu compra de KingCoins ha sido *COMPLETADA* por GamingKings!

Aquí tienes los detalles de tu transacción:
---
*Factura #${transaction.id_transaccion}*
*Estado: LIBERADO ✅* 📅 Fecha: ${formattedDate}
👑 Producto: KingCoins
💰 Cantidad Comprada: ${cleanedPackageName}
💲 Monto Pagado: ${transaction.final_price} ${transaction.currency}
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
                        invoice_text_content: invoiceTextContent 
                    })
                    .eq('id_transaccion', transactionId);

                if (updateError) {
                    console.error("Error al actualizar la transacción de KingCoins en Supabase:", updateError.message);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2(`❌ Error al liberar KingCoins para \`${transactionId}\` en la DB: ${updateError.message}.`),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error updating KingCoins transaction status" };
                }

                console.log(`KingCoins liberados y transacción ${transactionId} marcada como 'realizada'.`);

                let newCaption = callbackQuery.message.text;
                newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `LIBERADO` ✅');
                newCaption += `\n\nKingCoins liberados por: *${escapeMarkdownV2(userName)}* (${escapeMarkdownV2(formattedTime)} ${escapeMarkdownV2(formattedDate)})`;
                newCaption += kingcoinsCreditedMessage; 

                let updatedInlineKeyboard = [];
                updatedInlineKeyboard.push([{ text: "✅ KingCoins Liberados", callback_data: `completed_status_${transactionId}` }]); 
                
                const updatedReplyMarkup = {
                    inline_keyboard: updatedInlineKeyboard
                };

                try {
                    console.log(`DEBUG (release_kingcoins_): Texto FINAL del mensaje a Telegram ANTES de escapar:\n${newCaption}`);
                    console.log(`DEBUG (release_kingcoins_): Texto FINAL del mensaje a Telegram DESPUÉS de escapar:\n${JSON.stringify(escapeMarkdownV2(newCaption))}`);

                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: messageId,
                        text: escapeMarkdownV2(newCaption),
                        parse_mode: 'MarkdownV2',
                        reply_markup: updatedReplyMarkup,
                        disable_web_page_preview: true
                    });
                    console.log(`DEBUG: Mensaje de Telegram para KingCoins ${transactionId} editado con éxito.`);
                } catch (telegramEditError) {
                    console.error(`ERROR: Fallo al editar mensaje de Telegram para KingCoins ${transactionId}:`, telegramEditError.response ? telegramEditError.response.data : telegramEditError.message);
                    if (telegramEditError.response && telegramEditError.response.status === 400 && 
                       (telegramEditError.response.data.description && telegramEditError.response.data.description.includes('message is not modified'))) {
                        console.log(`DEBUG: Mensaje ${messageId} para KingCoins ${transactionId} no modificado o ya editado. Ignorando.`);
                    } else if (telegramEditError.response && telegramEditError.response.status === 400 &&
                                 telegramEditError.response.data.description && telegramEditError.response.data.description.includes('message to edit not found')) {
                        console.log(`DEBUG: Mensaje ${messageId} para KingCoins ${transactionId} no encontrado, probablemente eliminado. Ignorando.`);
                    } else {
                        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                            chat_id: chatId,
                            text: escapeMarkdownV2(`⚠️ Advertencia: KingCoins \`${transactionId}\` marcados como *LIBERADOS* en la base de datos, pero hubo un problema al editar el mensaje de Telegram.`),
                            parse_mode: 'MarkdownV2'
                        });
                    }
                }
            }
            // --- Handler para 'send_whatsapp_' (existente para recargador) ---
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
                   text: escapeMarkdownV2(`👉 *Enlace para el recargador de la transacción \`${transactionId}\`:* [Haz clic aquí](${escapeMarkdownV2(whatsappLinkRecargador)})`),
                   parse_mode: 'MarkdownV2',
                   disable_web_page_preview: true
               });

               console.log(`Enlace de WhatsApp para recargador generado (desde viejo callback) para transacción ${transactionId}: ${whatsappLinkRecargador}`);
            }
            // --- Handler para callbacks de estado finalizados/informativos ---
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