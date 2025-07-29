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
                            text: escapeMarkdownV2(`⚠️ Advertencia: Recarga ${transactionId} marcada como *REALIZADA* en la base de datos, pero hubo un problema al editar el mensaje de Telegram.`),
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

                // Asegurarse de que no se confirme dos veces
                if (transaction.status === 'realizada') {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callbackQuery.id,
                        text: "¡Estos KingCoins ya fueron liberados!",
                        show_alert: true
                    });
                    // Editar el mensaje para que muestre el estado final y el botón de factura
                    let newCaption = callbackQuery.message.text;
                    newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `LIBERADO` ✅');
                    newCaption += `\n\nKingCoins liberados por: *${userName}*`; // No añadir fecha/hora aquí, ya que se añade más abajo

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

                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: messageId,
                        text: escapeMarkdownV2(newCaption),
                        parse_mode: 'MarkdownV2',
                        reply_markup: updatedReplyMarkup,
                        disable_web_page_preview: true
                    });
                    return { statusCode: 200, body: "KingCoins already confirmed" };
                }

                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Liberando KingCoins para transacción ${transactionId}...`,
                    show_alert: false
                });

                // --- Lógica para liberar KingCoins (actualizar Supabase y tu sistema interno) ---
                const now = new Date();
                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const year = now.getFullYear();
                const formattedDate = `${day}/${month}/${year}`;
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const formattedTime = `${hours}:${minutes}`;

                // Limpiar packageName para la factura y mensajes
                const cleanedPackageName = transaction.package_name.includes('<i class="fas fa-crown"></i>') 
                    ? transaction.package_name.replace('<i class="fas fa-crown"></i>', ' KingCoins') 
                    : transaction.package_name;

                // Extraer la cantidad numérica de KingCoins del package_name
                const kingcoinAmountMatch = cleanedPackageName.match(/(\d+)\s*KingCoins/i);
                const kingcoinAmount = kingcoinAmountMatch ? parseInt(kingcoinAmountMatch[1], 10) : 0;

                let kingcoinsCreditedMessage = ''; // Mensaje para indicar si se acreditaron los KingCoins

                // ACREDITAR KINGCOINS EN user_wallets
                if (kingcoinAmount > 0 && transaction.player_id) { // Usamos transaction.player_id como el user_id (UUID)
                    try {
                        // Intentar obtener el saldo actual del usuario
                        const { data: userWallet, error: fetchWalletError } = await supabase
                            .from('user_wallets') // Usamos 'user_wallets'
                            .select('balance') // Seleccionamos la columna 'balance'
                            .eq('user_id', transaction.player_id) // Buscamos por 'user_id'
                            .single();

                        if (fetchWalletError && fetchWalletError.code === 'PGRST116') { // No rows found
                            // Si el usuario no existe, inserta una nueva entrada
                            const { error: insertWalletError } = await supabase
                                .from('user_wallets') // Usamos 'user_wallets'
                                .insert({
                                    user_id: transaction.player_id, // Insertamos en 'user_id'
                                    balance: kingcoinAmount // Insertamos en 'balance'
                                });
                            if (insertWalletError) {
                                console.error("Error al insertar nueva wallet de usuario:", insertWalletError.message);
                                kingcoinsCreditedMessage = `\n⚠️ Error al crear wallet para ${transaction.player_id}: ${insertWalletError.message}`;
                            } else {
                                console.log(`Wallet creada y ${kingcoinAmount} KingCoins acreditados a ${transaction.player_id}.`);
                                kingcoinsCreditedMessage = `\n✅ ${kingcoinAmount} KingCoins acreditados a *${escapeMarkdownV2(transaction.player_id)}*.`;
                            }
                        } else if (fetchWalletError) {
                            console.error("Error al obtener wallet de usuario:", fetchWalletError.message);
                            kingcoinsCreditedMessage = `\n⚠️ Error al obtener wallet para ${transaction.player_id}: ${fetchWalletError.message}`;
                        } else {
                            // Si el usuario existe, actualiza el saldo
                            const newBalance = userWallet.balance + kingcoinAmount; // Sumamos al 'balance' existente
                            const { error: updateWalletError } = await supabase
                                .from('user_wallets') // Usamos 'user_wallets'
                                .update({ balance: newBalance }) // Actualizamos 'balance'
                                .eq('user_id', transaction.player_id); // Buscamos por 'user_id'

                            if (updateWalletError) {
                                console.error("Error al actualizar wallet de usuario:", updateWalletError.message);
                                kingcoinsCreditedMessage = `\n⚠️ Error al actualizar wallet para ${transaction.player_id}: ${updateWalletError.message}`;
                            } else {
                                console.log(`${kingcoinAmount} KingCoins acreditados a ${transaction.player_id}. Nuevo saldo: ${newBalance}`);
                                kingcoinsCreditedMessage = `\n✅ ${kingcoinAmount} KingCoins acreditados a *${escapeMarkdownV2(transaction.player_id)}*. Nuevo saldo: *${newBalance}*.`;
                            }
                        }
                    } catch (walletOperationError) {
                        console.error("Error inesperado en operación de wallet:", walletOperationError.message);
                        kingcoinsCreditedMessage = `\n❌ Error inesperado al acreditar KingCoins: ${walletOperationError.message}`;
                    }
                } else {
                    kingcoinsCreditedMessage = `\nℹ️ No se pudieron acreditar KingCoins (cantidad 0 o ID de jugador/usuario no válida).`;
                }


                // Construimos la factura de texto para KingCoins
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
                        status: 'realizada', // Usamos 'realizada' consistentemente
                        completed_at: new Date().toISOString(),
                        completed_by: userName,
                        invoice_text_content: invoiceTextContent // Guarda la factura de texto limpia
                    })
                    .eq('id_transaccion', transactionId);

                if (updateError) {
                    console.error("Error al actualizar la transacción de KingCoins en Supabase:", updateError.message);
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2(`❌ Error al liberar KingCoins para ${transactionId} en la DB: ${updateError.message}.`),
                        parse_mode: 'MarkdownV2'
                    });
                    return { statusCode: 200, body: "Error updating KingCoins transaction status" };
                }

                console.log(`KingCoins liberados y transacción ${transactionId} marcada como 'realizada'.`);

                let newCaption = callbackQuery.message.text;
                newCaption = newCaption.replace('Estado: `PENDIENTE`', 'Estado: `LIBERADO` ✅');
                newCaption += `\n\nKingCoins liberados por: *${userName}* (${formattedTime} ${formattedDate})`;
                newCaption += kingcoinsCreditedMessage; // Añadir el mensaje de acreditación

                // Definir los nuevos botones para el mensaje editado de KingCoins
                let updatedInlineKeyboard = [];
                updatedInlineKeyboard.push([{ text: "✅ KingCoins Liberados", callback_data: `completed_status_${transactionId}` }]); 
                
                // Botón de factura por WhatsApp para el cliente (se genera aquí también para el mensaje editado)
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
                            text: escapeMarkdownV2(`⚠️ Advertencia: KingCoins ${transactionId} marcados como *LIBERADOS* en la base de datos, pero hubo un problema al editar el mensaje de Telegram.`),
                            parse_mode: 'MarkdownV2'
                        });
                    }
                }
            }
            // --- Handler para 'send_invoice_kingcoins' (este es el que se activaría si tuvieras un botón separado para la factura) ---
            // NOTA: Este bloque ahora se activa si el callback_data es 'send_invoice_kingcoins:',
            // pero el botón de factura se genera automáticamente después de liberar KingCoins.
            // Si tuvieras un botón separado para la factura, su callback_data debería ser 'send_invoice_kingcoins_TRANSACTIONID'
            // para que este handler lo procese.
            else if (data.startsWith('send_invoice_kingcoins:')) {
                const transactionId = data.split(':')[1];
                const transaction = await getTransaction(transactionId);

                if (!transaction) {
                    return { statusCode: 200, body: "Error fetching transaction for KingCoins invoice" };
                }
                
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callbackQuery.id,
                    text: `Generando enlace de factura para ${transactionId}...`,
                    show_alert: false
                });

                let whatsappLinkInvoiceCustomer = null;
                if (transaction.whatsapp_number && transaction.whatsapp_number.trim() !== '') {
                    const customerWhatsappNumberFormatted = transaction.whatsapp_number.startsWith('+') ? transaction.whatsapp_number : `+${transaction.whatsapp_number}`;
                    
                    const invoiceLink = `${NETLIFY_SITE_URL}/.netlify/functions/get-invoice?id=${transaction.id_transaccion}`;
                    
                    // Limpiar packageName para el mensaje de la factura
                    const cleanedPackageName = transaction.package_name.includes('<i class="fas fa-crown"></i>') 
                        ? transaction.package_name.replace('<i class="fas fa-crown"></i>', ' KingCoins') 
                        : transaction.package_name;

                    const whatsappMessageInvoice = `
🎉 ¡Hola! 👋

Aquí tienes tu factura para la compra de ${escapeMarkdownV2(cleanedPackageName)} (Transacción #${escapeMarkdownV2(transaction.id_transaccion)}) de GamingKings.

Puedes verla aquí: ${invoiceLink}

¡Gracias por tu compra! ✨
                    `.trim();

                    whatsappLinkInvoiceCustomer = `https://wa.me/${customerWhatsappNumberFormatted}?text=${encodeURIComponent(whatsappMessageInvoice)}`;
                    
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2(`👉 *Enlace de Factura para cliente de la transacción \`${transactionId}\`:* [Enviar por WhatsApp](${whatsappLinkInvoiceCustomer})`),
                        parse_mode: 'MarkdownV2',
                        disable_web_page_preview: true
                    });
                    console.log(`Enlace de WhatsApp 'Factura' generado para cliente ${transaction.whatsapp_number}.`);
                } else {
                    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: escapeMarkdownV2(`⚠️ La transacción \`${transactionId}\` no tiene un número de WhatsApp asociado para enviar la factura.`),
                        parse_mode: 'MarkdownV2'
                    });
                    console.log(`No hay número de WhatsApp para el cliente de la transacción ${transactionId}. No se generará el enlace de WhatsApp de factura.`);
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
               
               // Limpiar packageName para el mensaje del recargador
               const cleanedPackageNameForRecargador = transaction.package_name.includes('<i class="fas fa-crown"></i>') 
                   ? transaction.package_name.replace('<i class="fas fa-crown"></i>', ' KingCoins') 
                   : transaction.package_name;

               let whatsappMessageRecargador = `Hola. Por favor, realiza esta recarga lo antes posible.\n\n`;
               whatsappMessageRecargador += `*ID de Jugador:* ${transaction.player_id || 'N/A'}\n`;
               whatsappMessageRecargador += `*Paquete a Recargar:* ${cleanedPackageNameForRecargador || 'N/A'}\n`; 
               
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
        const body = JSON.parse(event.body || '{}'); // Parse body safely
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
