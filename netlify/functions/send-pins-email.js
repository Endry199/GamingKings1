// netlify/functions/send-pins-email.js
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

exports.handler = async function(event, context) {
    console.log("--- INICIO DE FUNCIÓN send-pins-email ---");
    
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ message: "Method Not Allowed" }) };
    }

    // 1. Configuración de Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
        console.error("Faltan variables de entorno de Supabase.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ message: "Error de configuración del servidor." }) 
        };
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Obtener y verificar el token de sesión
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log("❌ ERROR 401: Falta el token Bearer.");
        return { 
            statusCode: 401, 
            body: JSON.stringify({ message: "No autorizado. Falta el token de sesión." }) 
        };
    }

    const sessionToken = authHeader.substring(7);

    // 3. Obtener el cuerpo de la solicitud
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ message: "Formato de cuerpo inválido." }) };
    }

    const { pins, quantity, packageName, totalCost, transactionId } = body;

    if (!pins || pins.length === 0) {
        return { 
            statusCode: 400, 
            body: JSON.stringify({ message: "No hay PINs para enviar." }) 
        };
    }

    try {
        // 4. Verificar usuario autenticado y obtener email
        const { data: userData, error: authError } = await supabase
            .from('usuarios')
            .select('google_id, nombre, email')
            .eq('session_token', sessionToken)
            .maybeSingle();

        if (authError || !userData) {
            console.error("❌ ERROR 401: Token de sesión inválido.", authError);
            return { 
                statusCode: 401, 
                body: JSON.stringify({ message: "Sesión inválida. Por favor, inicia sesión de nuevo." }) 
            };
        }

        const userEmail = userData.email;
        const userName = userData.nombre || 'Cliente';

        if (!userEmail) {
            console.error("❌ ERROR: Usuario sin email registrado.");
            return { 
                statusCode: 400, 
                body: JSON.stringify({ message: "El usuario no tiene un email registrado." }) 
            };
        }

        console.log(`📧 Enviando PINs a: ${userEmail}`);

        // 5. Configurar Nodemailer
        const SMTP_HOST = process.env.SMTP_HOST;
        const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10);
        const SMTP_USER = process.env.SMTP_USER;
        const SMTP_PASS = process.env.SMTP_PASS;

        if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
            console.error("Faltan variables de entorno de correo.");
            return { 
                statusCode: 500, 
                body: JSON.stringify({ message: "Error de configuración del servidor de correo." }) 
            };
        }

        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_PORT === 465,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        // 6. Generar el HTML con los PINs
        let pinsHtml = pins.map((pin, index) => {
            const pinCode = pin.code || pin.pin || pin;
            return `
                <div style="background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #a72885;">
                    <p style="margin: 0; font-weight: bold;">PIN #${index + 1}:</p>
                    <p style="margin: 5px 0 0 0; font-size: 1.2em; font-family: monospace; color: #2ecc71; word-break: break-all;">
                        ${pinCode}
                    </p>
                </div>
            `;
        }).join('');

        // Generar el ID de transacción o usar el proporcionado
        const transactionIdFinal = transactionId || `GAMING-${Date.now()}`;

        // 7. Construir el correo
        const emailSubject = `🎮 ¡Tus PINs de Free Fire - GamingKings! (Transacción #${transactionIdFinal})`;
        
        const emailBody = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Tus PINs de Free Fire</title>
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9;">
                <div style="background: white; border-radius: 15px; padding: 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                    
                    <div style="text-align: center; margin-bottom: 25px;">
                        <img src="https://gamingkings.com/images/gamingkings_logo.png" alt="GamingKings" style="max-width: 150px;">
                    </div>
                    
                    <h1 style="color: #a72885; text-align: center; font-size: 1.8em; margin-bottom: 10px;">
                        🎮 ¡Tus PINs de Free Fire están listos!
                    </h1>
                    
                    <p style="text-align: center; font-size: 1.1em; color: #555;">
                        Hola <strong>${userName}</strong>,
                    </p>
                    
                    <p style="text-align: center; color: #555;">
                        Has comprado <strong>${quantity}</strong> PIN(s) de <strong>${packageName}</strong> 
                        por un total de <strong>$${totalCost.toFixed(2)}</strong>.
                    </p>
                    
                    <hr style="border: none; border-top: 2px solid #eee; margin: 25px 0;">
                    
                    <h2 style="color: #a72885; text-align: center;">🔑 Tus PINs</h2>
                    
                    <div style="margin: 20px 0;">
                        ${pinsHtml}
                    </div>
                    
                    <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #ffc107;">
                        <p style="margin: 0; color: #856404; font-size: 0.95em;">
                            <strong>📌 Instrucciones:</strong> Ingresa los PINs en la tienda de Free Fire para canjear tus diamantes. 
                            Cada PIN es de un solo uso.
                        </p>
                    </div>
                    
                    <hr style="border: none; border-top: 2px solid #eee; margin: 25px 0;">
                    
                    <div style="text-align: center; color: #888; font-size: 0.9em;">
                        <p style="margin: 5px 0;">
                            <strong>ID de Transacción:</strong> ${transactionIdFinal}
                        </p>
                        <p style="margin: 5px 0;">
                            Fecha: ${new Date().toLocaleString('es-ES', { timeZone: 'America/Caracas' })}
                        </p>
                        <p style="margin: 20px 0 5px 0;">
                            📧 Este correo fue enviado automáticamente por <strong>GamingKings</strong>.
                        </p>
                        <p style="margin: 5px 0;">
                            Si tienes alguna pregunta, contáctanos en 
                            <a href="https://wa.me/584226763229" style="color: #a72885; text-decoration: none;">WhatsApp</a>
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `;

        // 8. Enviar el correo
        const mailOptions = {
            from: SMTP_USER,
            to: userEmail,
            subject: emailSubject,
            html: emailBody
        };

        console.log(`📤 Enviando correo con ${pins.length} PINs a ${userEmail}...`);

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log(`✅ Correo enviado con éxito. Message ID: ${info.messageId}`);
            
            // 9. Registrar en la base de datos que se envió el correo
            // Buscar la transacción por google_id y actualizarla
            const { error: updateError } = await supabase
                .from('transactions')
                .update({ 
                    email_enviado: true,
                    email_enviado_at: new Date().toISOString()
                })
                .eq('id_transaccion', transactionIdFinal);

            if (updateError) {
                console.error("Error al actualizar estado de email en transacción:", updateError);
                // No es crítico, continuamos
            }

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    success: true,
                    message: "Correo enviado exitosamente.",
                    email: userEmail
                })
            };

        } catch (emailError) {
            console.error("❌ Error al enviar correo:", emailError.message);
            if (emailError.response) {
                console.error("Detalles SMTP:", emailError.response);
            }
            
            return {
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    message: "Error al enviar el correo: " + emailError.message
                })
            };
        }

    } catch (error) {
        console.error("❌ Error FATAL en send-pins-email:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                message: "Error interno del servidor.", 
                error: error.message 
            })
        };
    }
};