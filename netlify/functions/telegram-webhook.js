// netlify/functions/telegram-webhook.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js'); 

// Función para escapar caracteres especiales de MarkdownV2 para Telegram
function escapeMarkdownV2(text) {
    if (typeof text !== 'string') {
        text = String(text);
    }
    // Caracteres especiales de MarkdownV2 que necesitan ser escapados universalmente.
    // Se han quitado el guion '-' y el punto '.' de esta lista,
    // ya que solo son especiales en contextos específicos (ej. listas, números de enlace)
    // y no deben escaparse cuando son parte de una cadena de texto literal como un ID.
    const specialChars = /[_*\[\]()~`>#+={}|!]/g; 
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
            const callbackQueryId = callbackQuery.id; // Store the callback_query_id

            // Helper function to answer callback queries
            const answerCallback = async (queryId, text, showAlert = false) => {
                try {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: queryId,
                        text: text,
                        show_alert: showAlert
                    });
                } catch (ansError) {
                    console.error(`Error al responder al callback_query ${queryId}:`, ansError.response ? ansError.response.data : ansError.message);
                }
            };

            // Helper to get transaction without answering the callback internally
            async function getTransaction(id) {
                const { data: transaction, error: fetchError } = await supabase
                    .from('transactions')
                    .select('id_transaccion, game, player_id, package_name, final_price, currency, payment_method, status, email, full_name, whatsapp_number, receipt_url, invoice_text_content')
                    .eq('id_transaccion', id)
                    .single();

                if (fetchError || !transaction) {
                    console.error("Error al obtener la transacción de Supabase:", fetchError ? fetchError.message : "Transacción no encontrada.");
                    // Do NOT answer callback here, it's handled by the main flow
                    return null;
                }
                return transaction;
            }

            // --- Handler para 'mark_done_' (juegos existentes) ---
            if (data.startsWith('mark_done_')) {
                const transactionId = data.replace('mark_done_', '');
                await answerCallback(callbackQueryId, `Procesando recarga ${transactionId}...`, false); // Respond immediately

                const transaction = await getTransaction(transactionId); // Removed callbackQueryId from here

                if (!transaction) {
                    // If transaction not found after initial acknowledgement, send a new message
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2("❌ Error: Transacción no encontrada para la ID proporcionada."),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error fetching transaction for mark_done" };
                }

                console.log(`DEBUG: Estado actual de la transacción ${transactionId} al hacer clic: ${transaction.status}`);

                if (transaction.status === 'realizada') {
                    console.log(`DEBUG: Transacción ${transactionId} ya marcada como 'realizada'. Enviando alerta.`);
                    await answerCallback(callbackQueryId, "¡Esta recarga ya fue marcada como realizada!", true); // Alert if already done
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
                    } catch (editErrorAlreadyDone) {
                        console.error(`ERROR: Fallo al editar mensaje de Telegram (ya realizada) para ${transactionId}:`, editErrorAlreadyDone.response ? editErrorAlreadyDone.response.data : editErrorAlreadyDone.message);
                    }

                    return { statusCode: 200, body: "Already completed" };
                }

                const now = new Date();
                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const year = now.getFullYear();
                const formattedDate = `${day}/${month}/${year}`;
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const formattedTime = `${hours}:${minutes}`;
                
                // --- Construimos la factura de texto para guardar ---
                let invoiceTextContent = `
🎉 ¡Hola! 👋

¡Tu recarga ha sido *COMPLETADA* por GamingKings!

Aquí tienes los detalles de tu recarga:
---
*Factura \\#${escapeMarkdownV2(transaction.id_transaccion)}*
*Estado: REALIZADA ✅* 📅 Fecha: ${formattedDate}
🎮 Juego: ${escapeMarkdownV2(transaction.game || 'N/A')}
👤 ID de Jugador: ${escapeMarkdownV2(transaction.player_id || 'N/A')}
📦 Paquete: ${escapeMarkdownV2(transaction.package_name || 'N/A')}
💰 Monto Pagado: ${escapeMarkdownV2(transaction.final_price.toString() || 'N/A')} ${escapeMarkdownV2(transaction.currency || 'N/A')}
💳 Método de Pago: ${escapeMarkdownV2(transaction.payment_method.replace('-', ' ').toUpperCase() || 'N/A')}
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
                        text: escapeMarkdownV2('❌ Error al marcar la transacción `' + transactionId + '` como realizada en la DB: ' + updateError.message + '. Por favor, inténtalo de nuevo o revisa los logs.'),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error updating transaction status" };
                }
                
                console.log(`Transacción ${transactionId} marcada como realizada en Supabase y factura generada.`);

                let newCaption = callbackQuery.message.text;
                newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `REALIZADA` ✅');
                newCaption += `\n\nRecarga marcada por: *${escapeMarkdownV2(userName)}* (${escapeMarkdownV2(formattedTime)} ${escapeMarkdownV2(formattedDate)})`;

                // --- Generar el enlace corto de WhatsApp para el cliente ---
                let whatsappLinkCompletedCustomer = null;
                if (transaction.whatsapp_number && transaction.whatsapp_number.trim() !== '') {
                    const customerWhatsappNumberFormatted = transaction.whatsapp_number.startsWith('+') ? transaction.whatsapp_number : `+${transaction.whatsapp_number}`;
                    
                    const invoiceLink = `${NETLIFY_SITE_URL}/.netlify/functions/get-invoice?id=${transaction.id_transaccion}`;
                    
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
                        text: escapeMarkdownV2(newCaption),
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
                            text: escapeMarkdownV2('⚠️ Advertencia: Recarga `' + transactionId + '` marcada como *REALIZADA* en la base de datos, pero hubo un problema al editar el mensaje de Telegram.'),
                            parse_mode: 'MarkdownV2'
                        });
                    }
                }
            }
            // --- Handler para 'release_kingcoins_' ---
            else if (data.startsWith('release_kingcoins_')) {
                const transactionId = data.replace('release_kingcoins_', '');
                await answerCallback(callbackQueryId, `Liberando KingCoins para transacción ${transactionId}...`, false); // Respond immediately

                const transaction = await getTransaction(transactionId); // Removed callbackQueryId from here

                if (!transaction) {
                    // If transaction not found after initial acknowledgement, send a new message
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2("❌ Error: Transacción no encontrada para la ID proporcionada."),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error fetching transaction for KingCoins release" };
                }

                if (transaction.status === 'realizada') {
                    await answerCallback(callbackQueryId, "¡Estos KingCoins ya fueron liberados!", true); // Alert if already released
                    let newCaption = callbackQuery.message.text;
                    newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `LIBERADO` ✅');
                    newCaption += `\n\nKingCoins liberados por: *${escapeMarkdownV2(userName)}*`; 

                    let updatedInlineKeyboard = [];
                    updatedInlineKeyboard.push([{ text: "✅ KingCoins Liberados", callback_data: `completed_status_${transactionId}` }]); 

                    let whatsappLinkCompletedCustomer = null;
                    if (transaction.whatsapp_number && transaction.whatsapp_number.trim() !== '') {
                        const customerWhatsappNumberFormatted = transaction.whatsapp_number.startsWith('+') ? transaction.whatsapp_number : `+${transaction.whatsapp_number}`;
                        const invoiceLink = `${NETLIFY_SITE_URL}/.netlify/functions/get-invoice?id=${transaction.id_transaccion}`;
                        const cleanedPackageName = transaction.package_name.includes('<i class="fas fa-crown"></i>') 
                            ? transaction.package_name.replace('<i class="fas fa-crown"></i>', ' KingCoins') 
                            : transaction.package_name;

                        const shortWhatsappMessage = `
🎉 ¡Hola! 👋

¡Tu compra de KingCoins (Transaccion: ${escapeMarkdownV2(transaction.id_transaccion)}. ha sido *COMPLETADA* por GamingKings!

Puedes ver los detalles de tu factura aquí: ${invoiceLink}

¡Gracias por tu compra! ✨
                        `.trim();
                        whatsappLinkCompletedCustomer = `https://wa.me/${customerWhatsappNumberFormatted}?text=${encodeURIComponent(shortWhatsappMessage)}`;
                    }

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
                            text: escapeMarkdownV2(newCaption),
                            parse_mode: 'MarkdownV2',
                            reply_markup: updatedReplyMarkup,
                            disable_web_page_preview: true
                        });
                    } catch (editErrorAlreadyReleased) {
                        console.error(`ERROR: Fallo al editar mensaje de Telegram (ya liberados) para ${transactionId}:`, editErrorAlreadyReleased.response ? editErrorAlreadyReleased.response.data : editErrorAlreadyReleased.message);
                    }
                    return { statusCode: 200, body: "KingCoins already confirmed" };
                }

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
                                kingcoinsCreditedMessage = `\n⚠️ Error al crear wallet para ${escapeMarkdownV2(transaction.player_id || 'N/A')}: ${escapeMarkdownV2(insertWalletError.message || 'Error desconocido')}`;
                            } else {
                                console.log(`Wallet creada y ${kingcoinAmount} KingCoins acreditados a ${transaction.player_id}.`);
                                kingcoinsCreditedMessage = `\n✅ ${kingcoinAmount} KingCoins acreditados a *${escapeMarkdownV2(transaction.player_id || 'N/A')}*.`;
                            }
                        } else if (fetchWalletError) {
                            console.error("Error al obtener wallet de usuario:", fetchWalletError.message);
                            kingcoinsCreditedMessage = `\n⚠️ Error al obtener wallet para ${escapeMarkdownV2(transaction.player_id || 'N/A')}: ${escapeMarkdownV2(fetchWalletError.message || 'Error desconocido')}`;
                        } else {
                            const newBalance = userWallet.balance + kingcoinAmount;
                            const { error: updateWalletError } = await supabase
                                .from('user_wallets')
                                .update({ balance: newBalance })
                                .eq('user_id', transaction.player_id);

                            if (updateWalletError) {
                                console.error("Error al actualizar wallet de usuario:", updateWalletError.message);
                                kingcoinsCreditedMessage = `\n⚠️ Error al actualizar wallet para ${escapeMarkdownV2(transaction.player_id || 'N/A')}: ${escapeMarkdownV2(updateWalletError.message || 'Error desconocido')}`;
                            } else {
                                console.log(`${kingcoinAmount} KingCoins acreditados a ${transaction.player_id}. Nuevo saldo: ${newBalance}`);
                                kingcoinsCreditedMessage = `\n✅ ${kingcoinAmount} KingCoins acreditados a *${escapeMarkdownV2(transaction.player_id || 'N/A')}*. Nuevo saldo: *${escapeMarkdownV2(newBalance.toString())}*.`;
                            }
                        }
                    } catch (walletOperationError) {
                        console.error("Error inesperado en operación de wallet:", walletOperationError.message);
                        kingcoinsCreditedMessage = `\n❌ Error inesperado al acreditar KingCoins: ${escapeMarkdownV2(walletOperationError.message || 'Error desconocido')}`;
                    }
                } else {
                    kingcoinsCreditedMessage = `\nℹ️ No se pudieron acreditar KingCoins (cantidad 0 o ID de jugador/usuario no válida).`;
                }

                let invoiceTextContent = `
🎉 ¡Hola! 👋

¡Tu compra de KingCoins ha sido *COMPLETADA* por GamingKings!

Aquí tienes los detalles de tu transacción:
---
*Factura \\#${escapeMarkdownV2(transaction.id_transaccion)}*
*Estado: LIBERADO ✅* 📅 Fecha: ${formattedDate}
👑 Producto: KingCoins
💰 Cantidad Comprada: ${escapeMarkdownV2(cleanedPackageName || 'N/A')}
💲 Monto Pagado: ${escapeMarkdownV2(transaction.final_price.toString() || 'N/A')} ${escapeMarkdownV2(transaction.currency || 'N/A')}
💳 Método de Pago: ${escapeMarkdownV2(transaction.payment_method.replace('-', ' ').toUpperCase() || 'N/A')}
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
                        text: escapeMarkdownV2('❌ Error al liberar KingCoins para `' + transactionId + '` en la DB: ' + updateError.message + '.'),
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
                
                let whatsappLinkCompletedCustomer = null;
                if (transaction.whatsapp_number && transaction.whatsapp_number.trim() !== '') {
                    const customerWhatsappNumberFormatted = transaction.whatsapp_number.startsWith('+') ? transaction.whatsapp_number : `+${transaction.whatsapp_number}`;
                    const invoiceLink = `${NETLIFY_SITE_URL}/.netlify/functions/get-invoice?id=${transaction.id_transaccion}`;
                    const shortWhatsappMessage = `
🎉 ¡Hola! 👋

¡Tu compra de KingCoins (Transaccion: ${escapeMarkdownV2(transaction.id_transaccion)}) ha sido *COMPLETADA* por GamingKings!

Puedes ver los detalles de tu factura aquí: ${invoiceLink}

¡Gracias por tu compra! ✨
                    `.trim();
                    whatsappLinkCompletedCustomer = `https://wa.me/${customerWhatsappNumberFormatted}?text=${encodeURIComponent(shortWhatsappMessage)}`;
                }

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
                            text: escapeMarkdownV2('⚠️ Advertencia: KingCoins `' + transactionId + '` marcados como *LIBERADOS* en la base de datos, pero hubo un problema al editar el mensaje de Telegram.'),
                            parse_mode: 'MarkdownV2'
                        });
                    }
                }
            }
            else if (data.startsWith('send_invoice_kingcoins:')) {
                const transactionId = data.split(':')[1];
                await answerCallback(callbackQueryId, `Generando enlace de factura para ${transactionId}...`, false); // Respond immediately

                const transaction = await getTransaction(transactionId); // Removed callbackQueryId from here

                if (!transaction) {
                    // If transaction not found after initial acknowledgement, send a new message
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2("❌ Error: Transacción no encontrada para la ID proporcionada."),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error fetching transaction for KingCoins invoice" };
                }
                
                let whatsappLinkInvoiceCustomer = null;
                if (transaction.whatsapp_number && transaction.whatsapp_number.trim() !== '') {
                    const customerWhatsappNumberFormatted = transaction.whatsapp_number.startsWith('+') ? transaction.whatsapp_number : `+${transaction.whatsapp_number}`;
                    
                    const invoiceLink = `${NETLIFY_SITE_URL}/.netlify/functions/get-invoice?id=${transaction.id_transaccion}`;
                    
                    const cleanedPackageName = transaction.package_name.includes('<i class="fas fa-crown"></i>') 
                        ? transaction.package_name.replace('<i class="fas fa-crown"></i>', ' KingCoins') 
                        : transaction.package_name;

                    const whatsappMessageInvoice = `
🎉 ¡Hola! 👋

Aquí tienes tu factura para la compra de ${escapeMarkdownV2(cleanedPackageName)} (Transacción \\#${escapeMarkdownV2(transaction.id_transaccion)}) de GamingKings.

Puedes verla aquí: ${invoiceLink}

¡Gracias por tu compra! ✨
                    `.trim();

                    whatsappLinkInvoiceCustomer = `https://wa.me/${customerWhatsappNumberFormatted}?text=${encodeURIComponent(whatsappMessageInvoice)}`;
                    
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2('👉 *Enlace de Factura para cliente de la transacción `' + transactionId + '`:* [Enviar por WhatsApp](' + whatsappLinkInvoiceCustomer + ')'),
                        parse_mode: 'MarkdownV2',
                        disable_web_page_preview: true
                    });
                    console.log(`Enlace de WhatsApp 'Factura' generado para cliente ${transaction.whatsapp_number}.`);
                } else {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2('⚠️ La transacción `' + transactionId + '` no tiene un número de WhatsApp asociado para enviar la factura.'),
                        parse_mode: 'MarkdownV2'
                    });
                    console.log(`No hay número de WhatsApp para el cliente de la transacción ${transactionId}. No se generará el enlace de WhatsApp de factura.`);
                }
            }
            // --- Handler para 'send_whatsapp_' (existente para recargador) ---
            else if (data.startsWith('send_whatsapp_')) { 
                const transactionId = data.replace('send_whatsapp_', '');
                await answerCallback(callbackQueryId, `Generando enlace de WhatsApp para el recargador...`, false); // Respond immediately

                const transaction = await getTransaction(transactionId); // Removed callbackQueryId from here
                
                if (!transaction) {
                    // If transaction not found after initial acknowledgement, send a new message
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2("❌ Error: Transacción no encontrada para la ID proporcionada."),
                        parse_mode: 'MarkdownV2'
                    });
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

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: escapeMarkdownV2('👉 *Enlace para el recargador de la transacción `' + transactionId + '`:* [Haz clic aquí](' + whatsappLinkRecargador + ')'),
                    parse_mode: 'MarkdownV2',
                    disable_web_page_preview: true
                });

                console.log(`Enlace de WhatsApp para recargador generado (desde viejo callback) para transacción ${transactionId}: ${whatsappLinkRecargador}`);
            }
            // --- Handler para callbacks de estado finalizados/informativos ---
            else if (data.startsWith('completed_status_') || data.startsWith('no_whatsapp_factura_')) {
                await answerCallback(callbackQueryId, "Acción ya completada o informativa.", false); // Respond for informative clicks
            }
        }

        return { statusCode: 200, body: "Webhook processed" };
    } catch (error) {
        console.error("Error en el webhook de Telegram:", error.response ? error.response.data : error.message);
        const body = JSON.parse(event.body || '{}');
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