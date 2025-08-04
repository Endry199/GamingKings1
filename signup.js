// register.js
import { supabase } from './supabaseClient.js'; // Asegúrate de que la ruta sea correcta

document.addEventListener('DOMContentLoaded', () => {

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
            
            // Validación de contraseñas
            if (password !== confirmPassword) {
                authMessage.textContent = 'Las contraseñas no coinciden.';
                authMessage.className = 'auth-message error';
                authMessage.classList.remove('hidden');
                return;
            }
            
            authMessage.classList.add('hidden');
            authMessage.classList.remove('success', 'error');

            try {
                // Paso 1: Registrar el usuario en la autenticación de Supabase
                const { user, session, error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                });

                if (authError) {
                    throw authError;
                }
                
                if (user) {
                    // Paso 2: Insertar la información adicional en la tabla de perfiles
                    const { data: profileData, error: profileError } = await supabase
                        .from('profiles')
                        .insert([
                            {
                                id: user.id, // Vincula el perfil al ID del usuario
                                name: name,
                                last_name: lastName,
                                country_code: countryCode,
                                phone: phone,
                                email: email
                            }
                        ]);

                    if (profileError) {
                        throw profileError;
                    }
                    
                    authMessage.textContent = '¡Registro exitoso! Por favor, revisa tu correo electrónico para verificar tu cuenta.';
                    authMessage.classList.add('success');
                    authMessage.classList.remove('hidden');
                    registerForm.reset();
                    
                } else {
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
    }
});