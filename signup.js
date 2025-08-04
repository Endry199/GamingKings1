// register.js
import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', () => {

    // ... (El resto de tu código para el select de país) ...

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
                // CORRECTO: La respuesta de signUp devuelve un objeto 'data' y 'error'
                const { data, error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password
                });

                if (authError) {
                    throw authError;
                }
                
                // Ahora, el objeto del usuario se encuentra en data.user
                const user = data.user;

                if (user) {
                    // Paso 2: Insertar la información adicional en la tabla de perfiles
                    const { data: profileData, error: profileError } = await supabase
                        .from('profiles')
                        .insert([
                            {
                                id: user.id,
                                name: name,
                                last_name: lastName,
                                country_code: countryCode,
                                phone: phone,
                                email: email
                            }
                        ]);

                    if (profileError) {
                        // Si falla la inserción del perfil, podemos eliminar el usuario recién creado
                        // aunque esto es opcional, es una buena práctica.
                        console.error('Error al insertar perfil, eliminando usuario...', profileError);
                        await supabase.auth.signOut(); // Esto solo cierra la sesión, no elimina. Habría que usar una función de Admin.
                        throw profileError;
                    }
                    
                    authMessage.textContent = '¡Registro exitoso! Por favor, revisa tu correo electrónico para verificar tu cuenta.';
                    authMessage.classList.add('success');
                    authMessage.classList.remove('hidden');
                    registerForm.reset();
                    
                } else {
                    // Este bloque ahora no debería ser alcanzable si no hay un error
                    // pero lo dejamos como fallback por si acaso.
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