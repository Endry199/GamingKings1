// signup.js
import { supabase } from './supabaseClient.js';

// --- Lógica para el inicio de sesión con Google (en el ámbito global) ---
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

        console.log('¡Registro con Google exitoso!');
        
        // Redirección manual, ya que confirmaste que este método funciona
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
            authMessage.textContent = `Error al registrarse con Google: ${error.message}`;
            authMessage.classList.remove('hidden');
        }
    }
};


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
                        emailRedirectTo: 'https://gamingkings.netlify.app/verification-success.html' 
                    }
                });

                if (authError) {
                    throw authError;
                }
                
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
});