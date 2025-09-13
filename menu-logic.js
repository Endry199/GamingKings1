// menu-logic.js
document.addEventListener('DOMContentLoaded', () => {
    const userMenuButton = document.querySelector('.user-menu-button');
    const userMenuDropdown = document.querySelector('.user-menu-dropdown');
    
    const guestMenuButton = document.querySelector('.guest-menu-button');
    const guestMenuDropdown = document.querySelector('.guest-menu-dropdown');

    // Función para alternar la visibilidad de un menú desplegable
    function toggleDropdown(dropdown) {
        if (dropdown) {
            dropdown.classList.toggle('hidden');
        }
    }

    if (userMenuButton) {
        userMenuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown(userMenuDropdown);
            // Asegura que el otro menú esté cerrado
            if (guestMenuDropdown && !guestMenuDropdown.classList.contains('hidden')) {
                guestMenuDropdown.classList.add('hidden');
            }
        });
    }

    if (guestMenuButton) {
        guestMenuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown(guestMenuDropdown);
            // Asegura que el otro menú esté cerrado
            if (userMenuDropdown && !userMenuDropdown.classList.contains('hidden')) {
                userMenuDropdown.classList.add('hidden');
            }
        });
    }

    // Ocultar todos los menús si se hace clic en cualquier otro lugar de la página
    window.addEventListener('click', () => {
        if (userMenuDropdown && !userMenuDropdown.classList.contains('hidden')) {
            userMenuDropdown.classList.add('hidden');
        }
        if (guestMenuDropdown && !guestMenuDropdown.classList.contains('hidden')) {
            guestMenuDropdown.classList.add('hidden');
        }
    });
});