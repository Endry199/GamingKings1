import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', () => {
    const userMenuContainer = document.querySelector('.user-menu-container');
    const guestMenuContainer = document.querySelector('.guest-menu-container');
    const userDisplayName = document.getElementById('user-display-name');
    const logoutButton = document.getElementById('logout-button');

    const updateAuthUI = (user) => {
        if (user) {
            // Usuario logueado: Muestra el menú de usuario y oculta el de invitado
            if (userMenuContainer) {
                userMenuContainer.classList.remove('hidden');
            }
            if (guestMenuContainer) {
                guestMenuContainer.classList.add('hidden');
                userDisplayName.textContent = session.user.email || 'Usuario';
            }
            // Muestra el email del usuario
            if (userProfileData && userProfileData.name) {
              userDisplayName.textContent = `${userProfileData.name} ${userProfileData.last_name || ''}`;
            }
        } else {
            // Usuario no logueado: Muestra el menú de invitado y oculta el de usuario
            if (userMenuContainer) {
                userMenuContainer.classList.add('hidden');
            }
            if (guestMenuContainer) {
                guestMenuContainer.classList.remove('hidden');
            }
        }
    };

    // Escuchar cambios en el estado de la autenticación
    supabase.auth.onAuthStateChange((event, session) => {
        const user = session?.user || null;
        updateAuthUI(user);

        // Lógica de redirección
        const currentPage = window.location.pathname;

        if (event === 'SIGNED_IN' && currentPage.includes('login.html')) {
            // Si el usuario acaba de iniciar sesión y está en la página de login, redirige al index
            window.location.href = 'index.html';
        }

        if (event === 'SIGNED_OUT' && !currentPage.includes('index.html')) {
            // Si el usuario acaba de cerrar sesión y NO está en el index, redirige al index
            window.location.href = 'index.html';
        }
    });

    if (logoutButton) {
        logoutButton.addEventListener('click', async (e) => {
            e.preventDefault();
            const { error } = await supabase.auth.signOut();
            if (error) {
                console.error('Error al cerrar sesión:', error.message);
                alert('Hubo un error al cerrar sesión. Por favor, inténtalo de nuevo.');
            } else {
                // SOLUCIÓN PARA EL BOTÓN DE GOOGLE
                // Desactiva la selección automática del usuario en el cliente de Google.
                if (window.google && window.google.accounts.id) {
                    window.google.accounts.id.disableAutoSelect();
                }

                // Redirigir al usuario a la página principal
                window.location.href = 'index.html';
            }
        });
    }

    // Actualiza el UI al cargar la página si ya hay una sesión activa
    supabase.auth.getSession().then(({ data: { session } }) => {
        const user = session?.user || null;
        updateAuthUI(user);
    });
});