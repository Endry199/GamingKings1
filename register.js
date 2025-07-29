// register.js
import { supabase } from './supabaseClient.js'; // Asegúrate de que la ruta sea correcta

document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('register-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const authMessage = document.getElementById('auth-message');

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailInput.value;
        const password = passwordInput.value;

        authMessage.classList.add('hidden'); // Ocultar mensaje anterior
        authMessage.classList.remove('success', 'error'); // Limpiar clases

        try {
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
            });

            if (error) {
                throw error;
            }

            if (data.user) {
                // Si el registro fue exitoso (user object exists)
                // Supabase Auth crea automáticamente una entrada en auth.users
                // y, si configuraste RLS y default value auth.uid(),
                // debería crear una entrada en 'profiles' y 'user_wallets' también.
                authMessage.textContent = '¡Registro exitoso! Por favor, revisa tu correo electrónico para verificar tu cuenta.';
                authMessage.classList.add('success');
                authMessage.classList.remove('hidden');
                registerForm.reset(); // Limpiar el formulario
            } else {
                // Esto puede ocurrir si el usuario ya existe pero no está confirmado,
                // o si hay algún otro problema no capturado por el error object.
                authMessage.textContent = 'Parece que ya tienes una cuenta o hubo un problema desconocido. Intenta iniciar sesión.';
                authMessage.classList.add('error');
                authMessage.classList.remove('hidden');
            }

        } catch (error) {
            console.error('Error durante el registro:', error.message);
            let errorMessage = 'Ocurrió un error inesperado al registrarse.';
            if (error.message.includes('User already registered')) {
                errorMessage = 'Este correo electrónico ya está registrado. Por favor, inicia sesión.';
            } else if (error.message.includes('Password should be at least 6 characters')) {
                errorMessage = 'La contraseña debe tener al menos 6 caracteres.';
            }
            authMessage.textContent = errorMessage;
            authMessage.classList.add('error');
            authMessage.classList.remove('hidden');
        }
    });
});