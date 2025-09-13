// login.js
import { supabase } from './supabaseClient.js';

// Manejador para el inicio de sesión con Google.
// Se llama automáticamente cuando el usuario hace clic en el botón de Google.
window.handleCredentialResponse = async (response) => {
    const authMessage = document.getElementById('auth-message');
    authMessage.classList.add('hidden');
    authMessage.classList.remove('success', 'error');

    try {
        const { error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: response.credential,
        });

        if (error) {
            throw error;
        }

        // Si no hay errores, muestra un mensaje de éxito y redirige.
        authMessage.textContent = '¡Inicio de sesión con Google exitoso! Redirigiendo...';
        authMessage.classList.add('success');
        authMessage.classList.remove('hidden');
        window.location.href = 'index.html';

    } catch (error) {
        console.error('Error durante el inicio de sesión con Google:', error.message);
        authMessage.textContent = 'Ocurrió un error al iniciar sesión con Google.';
        authMessage.classList.add('error');
        authMessage.classList.remove('hidden');
    }
};