import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', () => {

    /* ========================================================= */
    /* LÓGICA PARA EL SELECTOR DE MONEDA PERSONALIZADO           */
    /* ========================================================= */
    const customCurrencySelector = document.getElementById('custom-currency-selector');
    const selectedCurrencyDisplay = document.getElementById('selected-currency');
    const currencyOptionsDiv = document.getElementById('currency-options');
    const currencyOptions = currencyOptionsDiv ? currencyOptionsDiv.querySelectorAll('.option') : [];

    function updateCurrencyDisplay(value, text, imgSrc) {
        if (selectedCurrencyDisplay) {
            selectedCurrencyDisplay.innerHTML = `<img src="${imgSrc}" alt="${text.split(' ')[2] ? text.split(' ')[2].replace(/[()]/g, '') : 'Flag'}"> <span>${text}</span> <i class="fas fa-chevron-down"></i>`;
        }
        localStorage.setItem('selectedCurrency', value);
        window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: value } }));
    }

    const savedCurrency = localStorage.getItem('selectedCurrency') || 'VES';
    let initialText = 'Bs. (VES)';
    let initialImgSrc = 'images/flag_ve.png';

    if (savedCurrency === 'USD') {
        initialText = '$ (USD)';
        initialImgSrc = 'images/flag_us.png';
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
    /* LÓGICA DE LA BARRA DE BÚSQUEDA */
    /* LÓGICA PARA LAS TARJETAS DE JUEGO (CORREGIDA) */
    /* ========================================================= */
    const searchInput = document.querySelector('.search-bar input');
    const gameGrid = document.getElementById('game-grid');
    const gameCards = gameGrid ? gameGrid.querySelectorAll('.game-card') : [];

    // Lógica de búsqueda
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

    // Lógica de clic en las tarjetas de juego
    gameCards.forEach(card => {
        card.addEventListener('click', async (event) => {
            event.preventDefault(); 
            
            const { data: { session } } = await supabase.auth.getSession();
            
            if (session) {
                // Si el usuario está logueado, lo redirige a la página del juego
                const pageUrl = card.getAttribute('data-game-page');
                if (pageUrl) {
                    window.location.href = pageUrl;
                }
            } else {
                // Si no, lo redirige a la página de login
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
        
        // Crear puntos de navegación
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
                slide.style.transform = `translateX(-${currentIndex * 100}%)`;
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
            intervalId = setInterval(nextSlide, 3000); // Cambia cada 3 segundos
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

        // Iniciar el carrusel
        updateSlidePosition();
        startCarousel();
    }


    /* ========================================================= */
    /* LÓGICA PARA EL AVISO/MODAL DE HORARIO                     */
    /* ========================================================= */
    const noticeOverlay = document.getElementById('horario-notice');
    const closeButton = document.getElementById('close-notice');

    if (noticeOverlay && closeButton) {
        // Muestra el aviso después de que la página se carga completamente
        setTimeout(() => {
            noticeOverlay.classList.remove('hidden');
        }, 1000); // 1 segundo de retraso

        // Ocultar el aviso al hacer clic en el botón de cerrar
        closeButton.addEventListener('click', () => {
            noticeOverlay.classList.add('hidden');
        });

        // Ocultar el aviso al hacer clic fuera del contenido del modal
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