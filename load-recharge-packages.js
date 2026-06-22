// load-recharge-packages.js (SOLO INPUT PERSONALIZADO)

// =========================================================================
// === UTILITY: Obtener Google ID desde localStorage ===
// =========================================================================

function getUserId() {
    const userDataJson = localStorage.getItem('userData');
    if (userDataJson) {
        try {
            const userData = JSON.parse(userDataJson);
            return userData.google_id || null; 
        } catch (e) {
            console.error("Error al parsear userData de localStorage:", e);
            return null;
        }
    }
    return null;
}

// =========================================================================
// === LÓGICA PRINCIPAL ===
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
    const rechargeForm = document.getElementById('recharge-wallet-form');
    const selectButton = document.getElementById('select-package-btn');
    const customAmountInput = document.getElementById('custom-amount-input');
    const customCurrencySymbol = document.getElementById('custom-currency-symbol');
    const currencyLabel = document.getElementById('currency-label');
    const errorMessage = document.getElementById('error-message');
    const validMessage = document.getElementById('valid-message');
    
    let isValidAmount = false;
    let currentAmount = null;
    let currentCurrency = 'USD';

    /**
     * Obtiene la tasa de cambio del Dólar desde la configuración CSS.
     */
    function getExchangeRate() {
        const rootStyle = getComputedStyle(document.documentElement);
        let rate = rootStyle.getPropertyValue('--tasa-dolar')?.trim().replace(/['"]/g, ''); 
        return parseFloat(rate) || 38.00; 
    }

    /**
     * Actualiza el símbolo de moneda y el label
     */
    function updateCurrencyDisplay() {
        const selectedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
        currentCurrency = selectedCurrency;
        
        const symbol = selectedCurrency === 'USD' ? '$' : 'Bs.';
        const label = selectedCurrency === 'USD' ? 'USD' : 'VES';
        
        if (customCurrencySymbol) {
            customCurrencySymbol.textContent = symbol;
        }
        
        if (currencyLabel) {
            currencyLabel.textContent = label;
        }
        
        // Actualizar placeholder
        if (customAmountInput) {
            customAmountInput.placeholder = selectedCurrency === 'USD' ? 'Ej: 25' : 'Ej: 950';
            customAmountInput.min = selectedCurrency === 'USD' ? 10 : 10 * getExchangeRate();
            
            // Si hay un valor, revalidar
            if (customAmountInput.value) {
                validateAmount(customAmountInput.value);
            }
        }
        
        // Actualizar el texto del monto mínimo
        const minAmountElement = document.querySelector('.min-amount');
        if (minAmountElement) {
            const minValue = selectedCurrency === 'USD' ? 10 : (10 * getExchangeRate()).toFixed(0);
            minAmountElement.textContent = `${symbol}${minValue} ${label}`;
        }
    }

    /**
     * Valida el monto ingresado
     */
    function validateAmount(value) {
        // Limpiar caracteres no numéricos
        const cleanValue = value.replace(/[^0-9]/g, '');
        
        if (cleanValue === '') {
            errorMessage.classList.remove('visible');
            validMessage.classList.remove('visible');
            selectButton.disabled = true;
            selectButton.textContent = 'Continuar al Pago';
            isValidAmount = false;
            currentAmount = null;
            return false;
        }
        
        const amount = parseInt(cleanValue, 10);
        
        // Verificar que sea un número entero positivo
        if (isNaN(amount) || amount < 10) {
            errorMessage.classList.add('visible');
            validMessage.classList.remove('visible');
            selectButton.disabled = true;
            selectButton.textContent = 'Continuar al Pago';
            isValidAmount = false;
            currentAmount = null;
            return false;
        }
        
        // Monto válido
        errorMessage.classList.remove('visible');
        validMessage.classList.add('visible');
        selectButton.disabled = false;
        
        const symbol = currentCurrency === 'USD' ? '$' : 'Bs.';
        selectButton.textContent = `Pagar Recarga de ${symbol}${amount} ${currentCurrency}`;
        
        isValidAmount = true;
        currentAmount = amount;
        return true;
    }

    /**
     * Maneja el cambio en el input
     */
    function handleInputChange() {
        if (!customAmountInput) return;
        
        const value = customAmountInput.value;
        
        // Solo permitir números (eliminar cualquier otro carácter)
        const numericValue = value.replace(/[^0-9]/g, '');
        if (numericValue !== value) {
            customAmountInput.value = numericValue;
        }
        
        validateAmount(numericValue);
    }

    /**
     * Maneja cuando el input pierde el foco
     */
    function handleBlur() {
        if (!customAmountInput) return;
        
        const value = customAmountInput.value;
        if (value !== '') {
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue) && numValue >= 10) {
                // Mostrar el monto formateado
                customAmountInput.value = numValue.toString();
                validateAmount(numValue.toString());
            }
        }
    }

    /**
     * Previene la entrada de puntos y comas
     */
    function handleKeyDown(e) {
        // Prevenir puntos y comas
        if (e.key === '.' || e.key === ',' || e.key === 'e' || e.key === '-') {
            e.preventDefault();
        }
    }

    // Escuchar eventos
    window.addEventListener('currencyChanged', () => {
        updateCurrencyDisplay();
        // Limpiar el input y el estado
        if (customAmountInput) {
            customAmountInput.value = '';
        }
        isValidAmount = false;
        currentAmount = null;
        selectButton.disabled = true;
        selectButton.textContent = 'Continuar al Pago';
        errorMessage.classList.remove('visible');
        validMessage.classList.remove('visible');
    });
    
    document.addEventListener('siteConfigLoaded', updateCurrencyDisplay, { once: true });

    // Event listeners del input
    if (customAmountInput) {
        customAmountInput.addEventListener('input', handleInputChange);
        customAmountInput.addEventListener('blur', handleBlur);
        customAmountInput.addEventListener('keydown', handleKeyDown);
        
        // Enfocar el input al cargar la página
        setTimeout(() => {
            customAmountInput.focus();
        }, 500);
    }

    // 🎯 Lógica de Pago
    rechargeForm.addEventListener('submit', (e) => { 
        e.preventDefault();

        if (!isValidAmount || !currentAmount) {
            alert('Por favor, ingresa un monto válido (mínimo 10 USD, solo números enteros).');
            return;
        }
        
        const googleId = getUserId();
        
        if (!googleId) {
            alert('Error: No se encontró la sesión o el ID de usuario. Por favor, inicia sesión para recargar.');
            return;
        }

        // Calcular los precios en ambas monedas
        const exchangeRate = getExchangeRate();
        let usdAmount, vesAmount;
        
        if (currentCurrency === 'USD') {
            usdAmount = currentAmount;
            vesAmount = currentAmount * exchangeRate;
        } else {
            vesAmount = currentAmount;
            usdAmount = currentAmount / exchangeRate;
        }

        const packageName = currentCurrency === 'USD' 
            ? `Saldo $${currentAmount} GKUSD` 
            : `Saldo Bs. ${currentAmount} GKUSD`;

        // Crear el objeto de transacción
        const transactionItem = {
            id: 'WALLET_RECHARGE_' + Date.now(), 
            game: 'Recarga de Saldo',
            playerId: 'N/A',
            packageName: packageName,
            priceUSD: usdAmount.toFixed(2), 
            priceVES: vesAmount.toFixed(2), 
            requiresAssistance: false,
            google_id: googleId,
            isCustom: true,
            customAmount: currentAmount,
            currency: currentCurrency
        };

        localStorage.setItem('transactionDetails', JSON.stringify([transactionItem]));
        window.location.href = 'payment.html';
    });

    // Inicializar
    updateCurrencyDisplay();
});