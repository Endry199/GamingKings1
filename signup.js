// signup.js
import { supabase } from './supabaseClient.js';

// Manejador para el inicio de sesión/registro con Google.
// Esta función se llama automáticamente por el botón de Google.
window.handleCredentialResponse = async (response) => {
    const authMessage = document.getElementById('auth-message');
    
    // Ocultar mensajes previos y mostrar el de proceso
    if (authMessage) {
        authMessage.classList.add('hidden');
        authMessage.classList.remove('success', 'error');
        authMessage.textContent = 'Iniciando sesión con Google...';
        authMessage.className = 'auth-message success';
        authMessage.classList.remove('hidden');
    }

    try {
        const { error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: response.credential,
        });

        if (error) {
            throw error;
        }

        console.log('¡Registro/Inicio de sesión con Google exitoso!');
        
        // Redirección inmediata
        if (authMessage) {
            authMessage.textContent = 'Redirigiendo a la página principal...';
            authMessage.classList.add('success');
            authMessage.classList.remove('hidden');
        }
        window.location.href = 'index.html';
        
    } catch (error) {
        console.error('Error al autenticar con Supabase:', error.message);
        if (authMessage) {
            authMessage.className = 'auth-message error';
            authMessage.textContent = `Error al registrarse/iniciar sesión con Google: ${error.message}`;
            authMessage.classList.remove('hidden');
        }
    }
};