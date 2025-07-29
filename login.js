// login.js
import { supabase } from './supabaseClient.js'; // Asegúrate de que la ruta sea correcta

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const authMessage = document.getElementById('auth-message');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailInput.value;
        const password = passwordInput.value;

        authMessage.classList.add('hidden'); // Ocultar mensaje anterior
        authMessage.classList.remove('success', 'error'); // Limpiar clases

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) {
                throw error;
            }

            if (data.user) {
                authMessage.textContent = '¡Inicio de sesión exitoso! Redirigiendo al dashboard...';
                authMessage.classList.add('success');
                authMessage.classList.remove('hidden');

                // Redirigir al usuario a una página protegida (ej. dashboard.html)
                // Crearemos esta página en el siguiente paso
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1500); // Pequeño retraso para que el usuario vea el mensaje
            } else {
                // Esto es poco probable si no hay un error, pero como fallback
                authMessage.textContent = 'Credenciales incorrectas o usuario no verificado.';
                authMessage.classList.add('error');
                authMessage.classList.remove('hidden');
            }

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
});