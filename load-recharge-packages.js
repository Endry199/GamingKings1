// load-recharge-packages.js (CON MONTO PERSONALIZADO)

// =========================================================================
// === UTILITY: Obtener Google ID desde localStorage ===
// =========================================================================

/**
 * Utilidad para obtener el google_id del usuario desde localStorage.
 * @returns {string|null} El google_id si existe, o null.
 */
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
// === LÓGICA PRINCIPAL DE PAQUETES ===
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
    const packageGrid = document.getElementById('recharge-package-options-grid');
    const rechargeForm = document.getElementById('recharge-wallet-form');
    const selectButton = document.getElementById('select-package-btn');
    const customAmountInput = document.getElementById('custom-amount-input');
    const customCurrencySymbol = document.getElementById('custom-currency-symbol');
    
    let selectedPackageData = null;
    let isCustomAmountSelected = false;

    // Paquetes de saldo predefinidos (ahora con valores más variados)
    const RECHARGE_PACKAGES = [
        { name: 'Saldo $10 GKUSD', usd: '10.00' },
        { name: 'Saldo $15 GKUSD', usd: '15.00' },
        { name: 'Saldo $25 GKUSD', usd: '25.00' },
        { name: 'Saldo $50 GKUSD', usd: '50.00' },
        { name: 'Saldo $100 GKUSD', usd: '100.00' },
        { name: 'Saldo $200 GKUSD', usd: '200.00' }
    ];

    /**
     * Obtiene la tasa de cambio del Dólar desde la configuración CSS.
     */
    function getExchangeRate() {
        const rootStyle = getComputedStyle(document.documentElement);
        let rate = rootStyle.getPropertyValue('--tasa-dolar')?.trim().replace(/['"]/g, ''); 
        return parseFloat(rate) || 38.00; 
    }

    /**
     * Actualiza el símbolo de moneda en el input personalizado
     */
    function updateCustomCurrencySymbol() {
        const currentCurrency = window.getCurrentCurrency ? window.getCurrentCurrency() : 'USD';
        const symbol = currentCurrency === 'USD' ? '$' : 'Bs.';
        if (customCurrencySymbol) {
            customCurrencySymbol.textContent = symbol;
        }
    }

    /**
     * Renderiza los paquetes predefinidos
     */
    function renderPackages() {
        if (!packageGrid) return;
        
        packageGrid.innerHTML = '';
        
        const currentCurrency = window.getCurrentCurrency ? window.getCurrentCurrency() : 'USD';
        const exchangeRate = getExchangeRate();
        updateCustomCurrencySymbol();
        
        // Habilitar el input personalizado
        if (customAmountInput) {
            customAmountInput.disabled = false;
            customAmountInput.value = '';
            customAmountInput.placeholder = currentCurrency === 'USD' ? 'Ej: 25' : 'Ej: 950';
        }
        
        RECHARGE_PACKAGES.forEach((pkg) => {
            const usdPrice = parseFloat(pkg.usd);
            const calculatedVesPrice = (usdPrice * exchangeRate).toFixed(2);
            
            const priceValue = currentCurrency === 'USD' ? usdPrice.toFixed(2) : calculatedVesPrice;
            const priceSymbol = currentCurrency === 'USD' ? '$' : 'Bs.';
            const price = `${priceSymbol} ${priceValue}`;

            const packageHtml = document.createElement('div');
            packageHtml.className = 'package-option';
            packageHtml.dataset.packageName = pkg.name;
            packageHtml.dataset.priceUsd = pkg.usd;
            packageHtml.dataset.priceVes = calculatedVesPrice; 

            packageHtml.innerHTML = `
                <p class="package-name">${pkg.name.replace('Saldo ', '')}</p>
                <p class="package-price">${price}</p>
            `;
            
            packageGrid.appendChild(packageHtml);
        });

        attachPackageEventListeners();
        updateButtonState();
    }

    /**
     * Attaches click listeners to the package options.
     */
    function attachPackageEventListeners() {
        const packageOptions = document.querySelectorAll('.package-option');
        
        packageOptions.forEach(opt => {
            opt.addEventListener('click', function() {
                // Deseleccionar todos los paquetes
                packageOptions.forEach(o => o.classList.remove('selected'));
                
                // Seleccionar el actual
                this.classList.add('selected');
                
                // Limpiar el input personalizado
                if (customAmountInput) {
                    customAmountInput.value = '';
                    isCustomAmountSelected = false;
                }
                
                // Actualizar datos seleccionados
                selectedPackageData = {
                    name: this.dataset.packageName,
                    usd: this.dataset.priceUsd,
                    ves: this.dataset.priceVes,
                    isCustom: false
                };
                
                updateButtonState();
            });
        });
    }

    /**
     * Maneja el cambio en el input de monto personalizado
     */
    function handleCustomAmountChange() {
        if (!customAmountInput) return;
        
        const value = customAmountInput.value.trim();
        
        // Si el campo está vacío, deseleccionar todo
        if (value === '') {
            // Deseleccionar paquetes
            document.querySelectorAll('.package-option').forEach(o => o.classList.remove('selected'));
            selectedPackageData = null;
            isCustomAmountSelected = false;
            updateButtonState();
            return;
        }
        
        const amount = parseFloat(value);
        const currentCurrency = window.getCurrentCurrency ? window.getCurrentCurrency() : 'USD';
        
        // Validar: mínimo 10, sin decimales
        if (isNaN(amount) || amount < 10 || !Number.isInteger(amount)) {
            // Si es inválido, deseleccionar
            document.querySelectorAll('.package-option').forEach(o => o.classList.remove('selected'));
            selectedPackageData = null;
            isCustomAmountSelected = false;
            updateButtonState();
            return;
        }
        
        // Deseleccionar paquetes predefinidos
        document.querySelectorAll('.package-option').forEach(o => o.classList.remove('selected'));
        
        // Calcular el precio en la moneda actual
        let usdAmount = amount;
        let vesAmount = amount;
        
        if (currentCurrency === 'VES') {
            const exchangeRate = getExchangeRate();
            usdAmount = (amount / exchangeRate);
            vesAmount = amount;
        } else {
            usdAmount = amount;
            vesAmount = amount * getExchangeRate();
        }
        
        // Crear el objeto de paquete personalizado
        const packageName = currentCurrency === 'USD' 
            ? `Saldo $${amount} GKUSD` 
            : `Saldo Bs. ${amount} GKUSD`;
        
        selectedPackageData = {
            name: packageName,
            usd: usdAmount.toFixed(2),
            ves: vesAmount.toFixed(2),
            isCustom: true,
            customAmount: amount
        };
        
        isCustomAmountSelected = true;
        updateButtonState();
    }

    /**
     * Actualiza el estado del botón de continuar
     */
    function updateButtonState() {
        if (selectedPackageData) {
            selectButton.disabled = false;
            const displayName = selectedPackageData.isCustom 
                ? selectedPackageData.name 
                : selectedPackageData.name;
            selectButton.textContent = `Pagar Recarga de ${displayName}`;
        } else {
            selectButton.disabled = true;
            selectButton.textContent = 'Continuar al Pago';
        }
    }

    /**
     * Escucha el evento de cambio de moneda
     */
    window.addEventListener('currencyChanged', () => {
        renderPackages();
        // Si había un monto personalizado, limpiarlo
        if (customAmountInput) {
            customAmountInput.value = '';
        }
        selectedPackageData = null;
        isCustomAmountSelected = false;
        updateButtonState();
    });
    
    document.addEventListener('siteConfigLoaded', renderPackages, { once: true });

    // 🎯 Event listeners para el input personalizado
    if (customAmountInput) {
        customAmountInput.addEventListener('input', handleCustomAmountChange);
        customAmountInput.addEventListener('blur', function() {
            // Si el valor es inválido, limpiar
            const value = parseFloat(this.value);
            if (!isNaN(value) && (value < 10 || !Number.isInteger(value))) {
                this.value = '';
                handleCustomAmountChange();
            }
        });
    }

    // 🎯 Lógica de Pago Directo al enviar el formulario
    rechargeForm.addEventListener('submit', (e) => { 
        e.preventDefault();

        if (!selectedPackageData) {
            alert('Por favor, selecciona un paquete o ingresa un monto válido (mínimo $10 USD).');
            return;
        }
        
        const googleId = getUserId();
        
        if (!googleId) {
            alert('Error: No se encontró la sesión o el ID de usuario. Por favor, inicia sesión para recargar.');
            return;
        }

        // Crear el objeto de transacción
        const transactionItem = {
            id: 'WALLET_RECHARGE_' + Date.now(), 
            game: 'Recarga de Saldo',
            playerId: 'N/A',
            packageName: selectedPackageData.name,
            priceUSD: selectedPackageData.usd, 
            priceVES: selectedPackageData.ves, 
            requiresAssistance: false,
            google_id: googleId,
            isCustom: selectedPackageData.isCustom || false,
            customAmount: selectedPackageData.customAmount || null
        };

        localStorage.setItem('transactionDetails', JSON.stringify([transactionItem]));
        window.location.href = 'payment.html';
    });

    // Renderizado inicial
    renderPackages();
});