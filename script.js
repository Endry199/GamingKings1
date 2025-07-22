document.addEventListener('DOMContentLoaded', () => {
    // ---- Lógica para el nuevo selector de moneda personalizado ----
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const selectedCurrencyDisplay = document.getElementById('selected-currency');
    const currencyOptionsDiv = document.getElementById('currency-options');
    // Asegurarse de que currencyOptionsDiv exista antes de intentar usar querySelectorAll
    const currencyOptions = currencyOptionsDiv ? currencyOptionsDiv.querySelectorAll('.option') : [];

    // Función para actualizar la UI del selector y guardar la moneda
    function updateCurrencyDisplay(value, text, imgSrc) {
        if (selectedCurrencyDisplay) { // Verificar si el elemento existe
            selectedCurrencyDisplay.innerHTML = `<img src="${imgSrc}" alt="${text.split(' ')[2] ? text.split(' ')[2].replace(/[()]/g, '') : 'Flag'}"> <span>${text}</span> <i class="fas fa-chevron-down"></i>`;
        }
        localStorage.setItem('selectedCurrency', value);
        // Dispatch custom event for other pages to listen
        window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: value } }));
    }

    // Inicializar el selector con la moneda guardada o por defecto
    const savedCurrency = localStorage.getItem('selectedCurrency') || 'VES'; // Por defecto VES
    let initialText = 'Bs. (VES)';
    let initialImgSrc = 'images/flag_ve.png';

    if (savedCurrency === 'USD') {
        initialText = '$ (USD)';
        initialImgSrc = 'images/flag_us.png';
    }
    updateCurrencyDisplay(savedCurrency, initialText, initialImgSrc);

    // Toggle para abrir/cerrar el selector
    if (selectedCurrencyDisplay) { // Asegurarse de que el elemento existe
        selectedCurrencyDisplay.addEventListener('click', (event) => {
            event.stopPropagation(); // Evitar que el clic se propague al document
            if (customCurrencySelector) { // Asegurarse de que customCurrencySelector existe
                customCurrencySelector.classList.toggle('show'); 
            }
        });
    }

    // Manejar la selección de una opción
    currencyOptions.forEach(option => {
        option.addEventListener('click', () => {
            const value = option.dataset.value;
            const text = option.querySelector('span').textContent;
            const imgSrc = option.querySelector('img').src;
            
            updateCurrencyDisplay(value, text, imgSrc);
            if (customCurrencySelector) { // Asegurarse de que customCurrencySelector existe
                customCurrencySelector.classList.remove('show'); 
            }
        });
    });

    // Cerrar el selector si se hace clic fuera de él
    document.addEventListener('click', (event) => {
        if (customCurrencySelector && !customCurrencySelector.contains(event.target)) {
            customCurrencySelector.classList.remove('show'); 
        }
    });

    // ---- Lógica de la barra de búsqueda (filtrado en la misma página) ----
    const searchInput = document.querySelector('.search-bar input');
    const gameGrid = document.getElementById('game-grid'); // Obtener el contenedor de la cuadrícula de juegos
    // Asegurarse de que gameCards se obtenga solo si gameGrid existe, para evitar errores en otras páginas.
    const gameCards = gameGrid ? gameGrid.querySelectorAll('.game-card') : []; 

    // Usar el evento 'input' para filtrar en tiempo real a medida que el usuario escribe
    if (searchInput) { // Asegurarse de que el elemento existe
        searchInput.addEventListener('input', () => { 
            const searchTerm = searchInput.value.toLowerCase();

            // Solo ejecutar la lógica de filtrado si estamos en la página que tiene el 'game-grid'
            if (gameGrid) {
                gameCards.forEach(card => {
                    const gameName = card.querySelector('h2').textContent.toLowerCase(); // Obtener el nombre del juego

                    if (gameName.includes(searchTerm)) {
                        card.style.display = 'flex'; // Mostrar la tarjeta si coincide
                    } else {
                        card.style.display = 'none'; // Ocultar la tarjeta si no coincide
                    }
                });
            }
        });
    }

    // NOTA: La lógica de verificación de Nick y envío a Telegram directamente desde el frontend
    // que estaba en el script.js original (para freefire.html) ha sido eliminada de este script global.
    // Ahora, el envío a Telegram se maneja exclusivamente desde payment_details.html
    // a través de la Netlify Function 'recargar.js', que es más seguro y robusto.
    // La verificación de Nick (si se implementa) se haría en una función de Netlify separada
    // y se llamaría desde la página específica del juego.
});