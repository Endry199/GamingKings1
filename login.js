// login.js
import { supabase } from './supabaseClient.js';

// Manejador para el inicio de sesión con Google
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

        // Redirección inmediata al iniciar sesión con Google
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

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const authMessage = document.getElementById('auth-message');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = emailInput.value;
            const password = passwordInput.value;

            authMessage.classList.add('hidden');
            authMessage.classList.remove('success', 'error');

            try {
                const { error } = await supabase.auth.signInWithPassword({ email, password });

                if (error) {
                    throw error;
                }

                // Redirección inmediata al iniciar sesión con correo/contraseña
                authMessage.textContent = '¡Inicio de sesión exitoso! Redirigiendo a la página principal...';
                authMessage.classList.add('success');
                authMessage.classList.remove('hidden');
                window.location.href = 'index.html';

            } catch (error) {
                console.error('Error durante el inicio de sesión:', error.message);
                let errorMessage = 'Ocurrió un error inesperado al iniciar sesión.';
                if (error.message.includes('Invalid login credentials')) {
                    errorMessage = 'Correo electrónico o contraseña incorrectos.';
                } else if (error.message.includes('Email not confirmed')) {
                    errorMessage = 'Tu correo electrónico no ha sido confirmado. Por favor, revisa tu bandeja de entrada.';
                }
                authMessage.textContent = errorMessage;
                authMessage.classList.add('error');
                authMessage.classList.remove('hidden');
            }
        });
    }
});