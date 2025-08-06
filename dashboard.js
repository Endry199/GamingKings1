// dashboard.js
import { supabase } from './supabaseClient.js'; // Asegúrate de que la ruta sea correcta

document.addEventListener('DOMContentLoaded', async () => {
    const welcomeMessage = document.getElementById('welcome-message');
    const userBalanceElement = document.getElementById('balance-value');
    const logoutButton = document.getElementById('logout-button');
    const dashboardMessage = document.getElementById('dashboard-message');
    const dashboardLogoutButton = document.getElementById('dashboard-logout-button');

    // Lógica del selector de moneda
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const currencyOptions = document.getElementById('currency-options');
    const selectedCurrencyDisplay = document.querySelector('#selected-currency span');
    const selectedCurrencyIcon = document.querySelector('#selected-currency img');
    
    // Obtiene la moneda guardada en localStorage o usa un valor por defecto
    let currentCurrency = localStorage.getItem('selectedCurrency') || 'VES';

    function updateCurrencyDisplay(currency) {
        if (currency === 'VES') {
            selectedCurrencyDisplay.textContent = 'Bs. (VES)';
            selectedCurrencyIcon.src = 'images/flag_ve.png';
        } else {
            selectedCurrencyDisplay.textContent = '$ (USD)';
            selectedCurrencyIcon.src = 'images/flag_us.png';
        }
        // Nota: Si quieres actualizar el saldo con la conversión,
        // tendrías que añadir esa lógica aquí.
        console.log('Moneda seleccionada:', currency);
    }

    // Actualiza la interfaz con la moneda guardada al cargar la página
    updateCurrencyDisplay(currentCurrency);

    // Event listener para abrir/cerrar el selector de moneda
    customCurrencySelector.addEventListener('click', (e) => {
        e.stopPropagation();
        customCurrencySelector.classList.toggle('show');
    });

    // Event listener para seleccionar una nueva moneda
    currencyOptions.addEventListener('click', (e) => {
        const option = e.target.closest('.option');
        if (option) {
            const newCurrency = option.dataset.value;
            if (newCurrency !== currentCurrency) {
                currentCurrency = newCurrency;
                localStorage.setItem('selectedCurrency', currentCurrency);
                updateCurrencyDisplay(currentCurrency);
            }
        }
    });

    // Cierra el selector de moneda si se hace clic fuera
    window.addEventListener('click', () => {
        if (customCurrencySelector) customCurrencySelector.classList.remove('show');
    });

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
        window.location.href = 'login.html';
        return;
    }

    // 2. Obtener el nombre de usuario del perfil
    let displayName = user.email;
    try {
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single();

        if (profileError && profileError.code !== 'PGRST116') {
            console.error('Error al obtener el perfil del usuario:', profileError.message);
        } else if (profile && profile.username) {
            displayName = profile.username;
        }
    } catch (profileCatchError) {
        console.error('Error inesperado al obtener el perfil:', profileCatchError.message);
    }

    // 3. Mostrar mensaje de bienvenida y balance
    welcomeMessage.textContent = `Bienvenido, ${displayName}!`;
    await fetchUserBalance(user.id);

    // Función para obtener el balance del usuario
    async function fetchUserBalance(userId) {
        try {
            const { data, error } = await supabase
                .from('user_wallets')
                .select('balance')
                .eq('user_id', userId)
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    console.warn('No se encontró billetera para este usuario. Creando una nueva.');
                    const { data: newWallet, error: newWalletError } = await supabase
                        .from('user_wallets')
                        .insert([{ user_id: userId, balance: 0 }]);
                    if (newWalletError) {
                        throw newWalletError;
                    }
                    userBalanceElement.textContent = `0.00`;
                } else {
                    throw error;
                }
            } else if (data) {
                userBalanceElement.textContent = `${parseFloat(data.balance).toFixed(2)}`;
            }
        } catch (error) {
            console.error('Error al cargar el balance del usuario:', error.message);
            showMessage('Error al cargar tu balance.', 'error');
            userBalanceElement.textContent = 'Error';
        }
    }

    // 4. Manejar el cierre de sesión
    const handleLogout = async () => {
        const { error } = await supabase.auth.signOut();

        if (error) {
            console.error('Error al cerrar sesión:', error.message);
            showMessage('Error al cerrar sesión.', 'error');
        } else {
            showMessage('Sesión cerrada exitosamente. Redirigiendo...', 'success');
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 1000);
        }
    };
    
    // Asocia la función de cierre de sesión a ambos botones
    if (logoutButton) logoutButton.addEventListener('click', handleLogout);
    if (dashboardLogoutButton) dashboardLogoutButton.addEventListener('click', handleLogout);

    // 5. Placeholder para futuras acciones de botones
    document.getElementById('recharge-button').addEventListener('click', () => {
        showMessage('Redirigiendo a la página de recargas...', 'success');
        setTimeout(() => {
            window.location.href = 'buy_kingcoins.html';
        }, 1000);
    });

    document.getElementById('view-history-button').addEventListener('click', () => {
        showMessage('Funcionalidad de historial en desarrollo.', 'error');
    });
});