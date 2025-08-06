// kingcoin_transactions.js

import { supabase } from './supabaseClient.js';

// Función para manejar una compra con KingCoins
// Recibe el ID del artículo y el precio en KingCoins (KGC)
async function purchaseWithKingcoins(itemId, priceInKGC) {
    console.log(`Intentando comprar item ${itemId} por ${priceInKGC} KGC`);

    // 1. Verificar si el usuario está logueado
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        alert('Debes iniciar sesión para realizar una compra.');
        // Opcional: redirigir a la página de inicio de sesión
        // window.location.href = 'login.html';
        return;
    }

    // 2. Obtener el saldo actual del usuario
    const { data: walletData, error: walletError } = await supabase
        .from('user_wallets')
        .select('balance')
        .eq('user_id', user.id)
        .single();

    if (walletError || !walletData) {
        console.error('Error al obtener el saldo del usuario:', walletError);
        alert('Ocurrió un error al verificar tu saldo. Por favor, inténtalo de nuevo.');
        return;
    }

    const currentBalance = parseFloat(walletData.balance);
    const itemPrice = parseFloat(priceInKGC);

    // 3. Verificar si el saldo es suficiente
    if (currentBalance < itemPrice) {
        alert('Saldo de KingCoins insuficiente para esta compra.');
        return;
    }

    // 4. Calcular el nuevo saldo y actualizar la base de datos
    const newBalance = currentBalance - itemPrice;
    
    const { error: updateError } = await supabase
        .from('user_wallets')
        .update({ balance: newBalance })
        .eq('user_id', user.id);

    if (updateError) {
        console.error('Error al actualizar el saldo:', updateError);
        alert('Ocurrió un error al procesar tu compra. Por favor, inténtalo de nuevo.');
        return;
    }

    // 5. Mensaje de éxito y recargar la página para actualizar el saldo
    alert('¡Compra realizada con éxito! Tu nuevo saldo es ' + newBalance.toFixed(2) + ' (KGC)');
    window.location.reload(); 
}

// Para que la función sea accesible globalmente desde el HTML
window.purchaseWithKingcoins = purchaseWithKingcoins;