import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', async () => {

    /* ========================================================= */
    /* LÓGICA PARA EL SELECTOR DE MONEDA PERSONALIZADO           */
    /* ========================================================= */
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const selectedCurrencyDisplay = document.getElementById('selected-currency');
    const currencyOptionsDiv = document.getElementById('currency-options');
    const currencyOptions = currencyOptionsDiv ? currencyOptionsDiv.querySelectorAll('.option') : [];
    
    // Se agregan las nuevas variables para el saldo de KingCoins
    const kingcoinsBalanceContainer = document.querySelector('.kingcoins-balance');
    const kingcoinsDisplay = document.getElementById('kingcoins-display');

    function updateCurrencyDisplay(value, text, imgSrc) {
        if (selectedCurrencyDisplay) {
            // Lógica modificada para manejar la visualización de la nueva moneda KGC
            if (value === 'KGC') {
                selectedCurrencyDisplay.innerHTML = `<img src="${imgSrc}" alt="KingCoins Logo"> <span>${text}</span> <i class="fas fa-chevron-down"></i>`;
            } else {
                selectedCurrencyDisplay.innerHTML = `<img src="${imgSrc}" alt="${text.split(' ')[2] ? text.split(' ')[2].replace(/[()]/g, '') : 'Flag'}"> <span>${text}</span> <i class="fas fa-chevron-down"></i>`;
            }
        }
        localStorage.setItem('selectedCurrency', value);
        window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: value } }));
    }

    const savedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
    let initialText, initialImgSrc;

    // Lógica corregida para el estado inicial de las monedas
    if (savedCurrency === 'USD') {
        initialText = '$ (USD)';
        initialImgSrc = 'images/flag_us.png';
    } else if (savedCurrency === 'KGC') {
        initialText = 'KingCoins (KGC)';
        initialImgSrc = 'images/gamingkings_logo.png';
    } else { // Caso por defecto, que es 'VES'
        initialText = 'Bs. (VES)';
        initialImgSrc = 'images/flag_ve.png';
    }

    updateCurrencyDisplay(savedCurrency, initialText, initialImgSrc);

    if (selectedCurrencyDisplay) {
        selectedCurrencyDisplay.addEventListener('click', (event) => {
            event.stopPropagation();
            if (customCurrencySelector) {
                customCurrencySelector.classList.toggle('show');
            }
        });
    }

    currencyOptions.forEach(option => {
        option.addEventListener('click', () => {
            const value = option.dataset.value;
            const text = option.querySelector('span').textContent;
            const imgSrc = option.querySelector('img').src;
            
            updateCurrencyDisplay(value, text, imgSrc);
            if (customCurrencySelector) {
                customCurrencySelector.classList.remove('show');
            }
        });
    });

    /* ========================================================= */
    /* LÓGICA PARA MOSTRAR SALDO DE KINGCOINS                    */
    /* ========================================================= */

    async function fetchUserKingcoins() {
        const { data: { user } } = await supabase.auth.getUser();

        if (user && kingcoinsBalanceContainer && kingcoinsDisplay) {
            kingcoinsBalanceContainer.classList.remove('hidden');

            try {
                const { data, error } = await supabase
                    .from('user_wallets')
                    .select('balance')
                    .eq('user_id', user.id)
                    .single();

                if (error && error.code !== 'PGRST116') {
                    throw error;
                }

                const balance = data ? parseFloat(data.balance).toFixed(2) : '0.00';
                kingcoinsDisplay.textContent = `${balance} (KGC)`;
            } catch (error) {
                console.error('Error al cargar el saldo de KingCoins:', error.message);
                kingcoinsDisplay.textContent = 'Error';
            }
        } else if (kingcoinsBalanceContainer) {
            kingcoinsBalanceContainer.classList.add('hidden');
        }
    }

    fetchUserKingcoins();

    supabase.auth.onAuthStateChange((event, session) => {
        fetchUserKingcoins();
    });

    /* ========================================================= */
    /* LÓGICA DE LA BARRA DE BÚSQUEDA */
    /* LÓGICA PARA LAS TARJETAS DE JUEGO (CORREGIDA) */
    /* ========================================================= */
    const searchInput = document.querySelector('.search-bar input');
    const gameGrid = document.getElementById('game-grid');
    const gameCards = gameGrid ? gameGrid.querySelectorAll('.game-card') : [];

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const searchTerm = searchInput.value.toLowerCase();
            if (gameGrid) {
                gameCards.forEach(card => {
                    const gameName = card.querySelector('h2').textContent.toLowerCase();
                    if (gameName.includes(searchTerm)) {
                        card.style.display = 'flex';
                    } else {
                        card.style.display = 'none';
                    }
                });
            }
        });
    }

    gameCards.forEach(card => {
        card.addEventListener('click', async (event) => {
            event.preventDefault(); 
            
            const { data: { session } } = await supabase.auth.getSession();
            
            if (session) {
                const pageUrl = card.getAttribute('data-game-page');
                if (pageUrl) {
                    window.location.href = pageUrl;
                }
            } else {
                window.location.href = 'login.html';
            }
        });
    });

    /* ========================================================= */
    /* LÓGICA PARA EL CARRUSEL                                  */
    /* ========================================================= */
    const slides = document.querySelectorAll('.carousel-slide');
    const prevButton = document.querySelector('.carousel-prev');
    const nextButton = document.querySelector('.carousel-next');
    const dotsContainer = document.querySelector('.carousel-dots');
    let currentIndex = 0;
    let intervalId;

    if (slides.length > 0 && prevButton && nextButton && dotsContainer) {
        
        slides.forEach((_, index) => {
            const dot = document.createElement('span');
            dot.classList.add('carousel-dot');
            dot.addEventListener('click', () => {
                goToSlide(index);
                stopCarousel();
                startCarousel();
            });
            dotsContainer.appendChild(dot);
        });

        const dots = dotsContainer.querySelectorAll('.carousel-dot');

        function updateSlidePosition() {
            slides.forEach((slide, i) => {
                slide.classList.toggle('active', i === currentIndex);
            });
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === currentIndex);
            });
        }

        function goToSlide(index) {
            currentIndex = index;
            updateSlidePosition();
        }

        function nextSlide() {
            currentIndex = (currentIndex + 1) % slides.length;
            updateSlidePosition();
        }

        function prevSlide() {
            currentIndex = (currentIndex - 1 + slides.length) % slides.length;
            updateSlidePosition();
        }

        function startCarousel() {
            intervalId = setInterval(nextSlide, 3000);
        }

        function stopCarousel() {
            clearInterval(intervalId);
        }

        prevButton.addEventListener('click', () => {
            stopCarousel();
            prevSlide();
            startCarousel();
        });

        nextButton.addEventListener('click', () => {
            stopCarousel();
            nextSlide();
            startCarousel();
        });

        updateSlidePosition();
        startCarousel();
    }


    /* ========================================================= */
    /* LÓGICA PARA EL AVISO/MODAL DE HORARIO                     */
    /* ========================================================= */
    const noticeOverlay = document.getElementById('horario-notice');
    const closeButton = document.getElementById('close-notice');

    if (noticeOverlay && closeButton) {
        setTimeout(() => {
            noticeOverlay.classList.remove('hidden');
        }, 1000);

        closeButton.addEventListener('click', () => {
            noticeOverlay.classList.add('hidden');
        });

        noticeOverlay.addEventListener('click', (e) => {
            if (e.target === noticeOverlay) {
                noticeOverlay.classList.add('hidden');
            }
        });
    }

    /* ========================================================= */
    /* CIERRA MENÚ DE MONEDA AL HACER CLIC FUERA */
    /* ========================================================= */
    document.addEventListener('click', (event) => {
        if (customCurrencySelector && !customCurrencySelector.contains(event.target)) {
            customCurrencySelector.classList.remove('show');
        }
    });

});