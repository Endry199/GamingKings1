// signup.js
import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', () => {

    // --- Lógica para el selector de código de país ---
    const countryCodeSelect = document.getElementById('country-code');
    
    if (countryCodeSelect) {
        const originalOptionsText = {};
        for (const option of countryCodeSelect.options) {
            if (option.value) {
                originalOptionsText[option.value] = option.textContent;
            }
        }

        function updateSelectedOptionDisplay() {
            const selectedOption = countryCodeSelect.options[countryCodeSelect.selectedIndex];
            if (selectedOption && selectedOption.value) {
                const fullText = originalOptionsText[selectedOption.value];
                const match = fullText.match(/\+\d+/);
                selectedOption.textContent = match ? match[0] : selectedOption.value;
            }
        }

        function restoreAllOptionsText() {
            for (const option of countryCodeSelect.options) {
                if (option.value && originalOptionsText[option.value]) {
                    option.textContent = originalOptionsText[option.value];
                }
            }
        }

        countryCodeSelect.addEventListener('change', updateSelectedOptionDisplay);
        countryCodeSelect.addEventListener('focus', restoreAllOptionsText);
        countryCodeSelect.addEventListener('mousedown', restoreAllOptionsText);
        countryCodeSelect.addEventListener('blur', updateSelectedOptionDisplay);

        updateSelectedOptionDisplay();
    }
    
    // --- Lógica del formulario de registro con correo y contraseña ---
    const registerForm = document.getElementById('register-form');
    const authMessage = document.getElementById('auth-message');

    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('name').value;
            const lastName = document.getElementById('last-name').value;
            const countryCode = document.getElementById('country-code').value;
            const phone = document.getElementById('phone').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            
            if (password !== confirmPassword) {
                authMessage.textContent = 'Las contraseñas no coinciden.';
                authMessage.className = 'auth-message error';
                authMessage.classList.remove('hidden');
                return;
            }
            
            authMessage.classList.add('hidden');
            authMessage.classList.remove('success', 'error');
            
            try {
                const { data, error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: { name, last_name: lastName, country_code: countryCode, phone },
                        // Redirige al usuario a esta página después de verificar su correo
                        emailRedirectTo: 'https://gamingkings.netlify.app/verification-success.html' 
                    }
                });

                if (authError) {
                    throw authError;
                }
                
                // Redirige inmediatamente a la página de verificación pendiente
                window.location.href = 'verify-email.html';

            } catch (error) {
                console.error('Error durante el registro:', error.message);
                let errorMessage = 'Ocurrió un error inesperado al registrarse.';
                if (error.message.includes('User already registered')) {
                    errorMessage = 'Este correo electrónico ya está registrado. Por favor, inicia sesión.';
                } else if (error.message.includes('Password should be at least 6 characters')) {
                    errorMessage = 'La contraseña debe tener al menos 6 caracteres.';
                } else {
                    errorMessage = `Error de Supabase: ${error.message}`;
                }
                
                authMessage.textContent = errorMessage;
                authMessage.classList.add('error');
                authMessage.classList.remove('hidden');
            }
        });
    }

    // --- Lógica para el inicio de sesión con Google ---
    // Esta función es llamada por el SDK de Google cuando el usuario se autentica
    window.handleCredentialResponse = async (response) => {
        console.log("ID Token recibido:", response.credential);

        try {
            const { data, error } = await supabase.auth.signInWithIdToken({
                provider: 'google',
                token: response.credential,
                options: {
                    // La redirección después del inicio de sesión se gestiona aquí.
                    // Supabase automáticamente guarda el correo y el nombre del usuario de Google.
                    redirectTo: 'https://gamingkings.netlify.app/index.html'
                }
            });

            if (error) throw error;

            console.log('Usuario autenticado con Google:', data);
            
            // Redirige al usuario a la página principal
            // La redirección `redirectTo` de Supabase es la forma recomendada,
            // pero esta línea asegura la redirección si por alguna razón falla.
            window.location.href = 'index.html';
            
        } catch (error) {
            console.error('Error al autenticar con Supabase:', error.message);
            const messageDiv = document.getElementById('auth-message');
            messageDiv.className = 'auth-message error';
            messageDiv.textContent = `Error al iniciar sesión con Google: ${error.message}`;
            messageDiv.classList.remove('hidden');
        }
    };
});