// dashboard.js
import { supabase } from './supabaseClient.js'; // Asegúrate de que la ruta sea correcta

document.addEventListener('DOMContentLoaded', async () => {
    const welcomeMessage = document.getElementById('welcome-message');
    const userBalanceElement = document.getElementById('balance-value'); // *** AQUÍ: Apunta al SPAN dentro del P ***
    const logoutButton = document.getElementById('logout-button');
    const dashboardMessage = document.getElementById('dashboard-message');

    // Función para mostrar mensajes
    const showMessage = (message, type) => {
        dashboardMessage.textContent = message;
        dashboardMessage.classList.remove('hidden', 'success', 'error');
        dashboardMessage.classList.add(type);
    };

    // 1. Verificar sesión del usuario y obtener datos del perfil
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
        console.error('No hay usuario autenticado o error al obtener el usuario:', userError);
        // Redirigir al usuario a la página de inicio de sesión si no está autenticado
        window.location.href = 'login.html';
        return; // Detener la ejecución del script
    }

    // 2. Obtener el nombre de usuario del perfil (si existe)
    let displayName = user.email; // Valor por defecto si no hay username
    try {
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single();

        if (profileError && profileError.code !== 'PGRST116') { // PGRST116 = No rows found
            console.error('Error al obtener el perfil del usuario:', profileError.message);
        } else if (profile && profile.username) {
            displayName = profile.username; // Usar el username si está disponible
        }
    } catch (profileCatchError) {
        console.error('Error inesperado al obtener el perfil:', profileCatchError.message);
    }

    // 3. Mostrar mensaje de bienvenida
    welcomeMessage.textContent = `Bienvenido, ${displayName}!`;
    await fetchUserBalance(user.id);

    // Función para obtener el balance del usuario
    async function fetchUserBalance(userId) {
        try {
            const { data, error } = await supabase
                .from('user_wallets')
                .select('balance')
                .eq('user_id', userId)
                .single(); // Esperamos solo una fila para el ID del usuario

            if (error) {
                if (error.code === 'PGRST116') { // No rows found
                    // Esto podría pasar si el trigger no creó la billetera por alguna razón
                    console.warn('No se encontró billetera para este usuario. Creando una nueva.');
                    const { data: newWallet, error: newWalletError } = await supabase
                        .from('user_wallets')
                        .insert([{ user_id: userId, balance: 0 }]);
                    if (newWalletError) {
                        throw newWalletError;
                    }
                    userBalanceElement.textContent = `0.00`; // Solo el número, sin "Bs."
                } else {
                    throw error;
                }
            } else if (data) {
                userBalanceElement.textContent = `${parseFloat(data.balance).toFixed(2)}`; // Solo el número, sin "Bs."
            }
        } catch (error) {
            console.error('Error al cargar el balance del usuario:', error.message);
            showMessage('Error al cargar tu balance.', 'error');
            userBalanceElement.textContent = 'Error'; // Mostrar 'Error' en el SPAN
        }
    }

    // 4. Manejar el cierre de sesión
    logoutButton.addEventListener('click', async () => {
        const { error } = await supabase.auth.signOut();

        if (error) {
            console.error('Error al cerrar sesión:', error.message);
            showMessage('Error al cerrar sesión.', 'error');
        } else {
            showMessage('Sesión cerrada exitosamente. Redirigiendo...', 'success');
            setTimeout(() => {
                window.location.href = 'login.html'; // Redirigir a la página de inicio de sesión
            }, 1000);
        }
    });

    // 5. Placeholder para futuras acciones de botones
    document.getElementById('recharge-button').addEventListener('click', () => {
        // Lógica para redirigir a la página de recarga
        showMessage('Redirigiendo a la página de recargas...', 'success');
        setTimeout(() => {
            window.location.href = 'index.html'; // O una página de recarga específica si la creamos
        }, 1000);
    });

    document.getElementById('view-history-button').addEventListener('click', () => {
        // Lógica para redirigir a la página de historial
        showMessage('Funcionalidad de historial en desarrollo.', 'error');
        // window.location.href = 'history.html'; // Crearemos esta página más adelante
    });
});