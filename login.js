// login.js
import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const authMessage = document.getElementById('auth-message');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailInput.value;
        const password = passwordInput.value;

        // Oculta mensajes anteriores antes de la nueva petición
        authMessage.classList.add('hidden');
        authMessage.classList.remove('success', 'error');

        try {
            // Llama al método de inicio de sesión de Supabase
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) {
                // Si hay un error, lo lanza para que sea capturado por el bloque catch
                throw error;
            }

            if (data.user) {
                // Si el inicio de sesión es exitoso, muestra un mensaje y redirige
                authMessage.textContent = '¡Inicio de sesión exitoso! Redirigiendo a la página principal...';
                authMessage.classList.add('success');
                authMessage.classList.remove('hidden');

                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 1500);
            } else {
                // Manejo de un caso inesperado donde no hay error pero tampoco hay usuario
                authMessage.textContent = 'Credenciales incorrectas o usuario no verificado.';
                authMessage.classList.add('error');
                authMessage.classList.remove('hidden');
            }

        } catch (error) {
            console.error('Error durante el inicio de sesión:', error.message);
            let errorMessage = 'Ocurrió un error inesperado al iniciar sesión.';

            // Maneja errores específicos para mostrar mensajes más claros al usuario
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