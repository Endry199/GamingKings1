// netlify/functions/get-site-config.js (CORRECCIÓN FINAL + LOGS DETALLADOS)

const { createClient } = require('@supabase/supabase-js');

// 🟢 MAPEO: Definimos la relación entre la columna de la DB y la variable CSS
const DB_TO_CSS_MAP = {
    'dark_bg': '--bg-color', 
    'card_bg': '--card-bg',
    'primary_blue': '--primary-blue',
    'accent_green': '--accent-green',
    'text_color': '--text-color',
    'secondary_text': '--secondary-text',
    'input_bg': '--input-bg',
    'button_gradient': '--button-gradient',
    'hover_blue': '--hover-blue',
    'selected_item_gradient': '--selected-item-gradient',
    'shadow_dark': '--shadow-dark',
    'border_color': '--border-color',
    'shadow_light': '--shadow-light',
    'button_text_color': '--button-text-color', 
    'tasa_dolar': '--tasa-dolar', 
    // 🎯 CLAVES DEL CARRUSEL
    'img1': '--carousel-img1', 
    'img2': '--carousel-img2', 
    'img3': '--carousel-img3', 
    'img4': '--carousel-img4',
    // Asegúrate de que esta lista sea idéntica a las columnas de tu tabla
};

// 🚨 Nueva constante para identificar rápidamente las columnas de imagen
const IMAGE_DB_KEYS = ['img1', 'img2', 'img3', 'img4'];

exports.handler = async function(event, context) {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }
    
    // --- 1. Setup ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 
    
    // ... (omito el chequeo de credenciales por brevedad, asumiendo que ya funciona) ...

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // --- 2. Consulta a Supabase ---
        const { data: rows, error } = await supabase
            .from('configuracion_sitio') 
            .select('*') 
            .eq('id', 1) 
            .limit(1); 
        
        if (error) {
            console.error(`[NETLIFY] ERROR EN DB: ${error.message}`);
            throw new Error(error.message); 
        }
        
        const config = (rows && rows.length > 0) ? rows[0] : null;
        
        console.log("[NETLIFY] LOG: Array de filas retornado por Supabase:", JSON.stringify(rows));
        console.log("[NETLIFY] LOG: Fila de configuración extraída (config):", JSON.stringify(config));
            
        // --- 3. Manejo de la No Existencia (0 Filas) ---
        if (!config) {
            console.warn(`[NETLIFY] Advertencia: No se encontró la fila con ID=1. Devolviendo configuración vacía.`);

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}), 
            };
        }

        // --- 4. Mapeo de Claves (Deg DB a CSS) ---
        const cssConfig = {};
        
        for (const [dbKey, value] of Object.entries(config)) {
            const cssKey = DB_TO_CSS_MAP[dbKey];
            
            if (cssKey) {
                // 1. Evitar valores nulos/vacíos
                if (value !== null && value !== undefined && value !== '') { 
                    let finalValue = value;
                    
                    // 🚨 CORRECCIÓN: Si es una clave de imagen, envuelve el valor en url('')
                    if (IMAGE_DB_KEYS.includes(dbKey)) {
                        finalValue = `url('${value}')`;
                    }

                    cssConfig[cssKey] = finalValue;
                }
            }
        }
        
        console.log("[NETLIFY] LOG: Datos finales (CSS names) enviados:", JSON.stringify(cssConfig));

        // --- 5. Éxito ---
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cssConfig),
        };

    } catch (error) {
        console.error("[NETLIFY] Error FATAL en la función get-site-config (Catch Block):", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor.", details: error.message }),
        };
    }
};