// netlify/functions/get-site-config.js (VERSIÓN FINAL CON COLORES, TASA E IMÁGENES)

const { createClient } = require('@supabase/supabase-js');

// 🟢 MAPEO: Definimos la relación entre la columna de la DB y la variable/clave de retorno (CSS o nombre de imagen)
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
    // Tasa de cambio
    'tasa_dolar': '--tasa-dolar', 
    
    // 🎯 NUEVO: Claves para las URLs de las imágenes (se mapean a sí mismas)
    'img1': 'img1', 
    'img2': 'img2', 
    'img3': 'img3', 
    'img4': 'img4', 
    // Asegúrate de que esta lista sea idéntica a las columnas de tu tabla
};

exports.handler = async function(event, context) {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }
    
    // --- 1. Setup ---
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; 
    
    // Nota: El chequeo de credenciales debe ir aquí si se requiere
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // --- 2. Consulta a Supabase ---
        const { data: rows, error } = await supabase
            .from('configuracion_sitio') 
            .select('*') // Consulta todas las columnas (incluyendo las nuevas img)
            .eq('id', 1) 
            .limit(1); // Traeremos 0 o 1 fila
        
        if (error) {
            console.error(`[NETLIFY] ERROR EN DB: ${error.message}`);
            throw new Error(error.message); 
        }
        
        // Extraemos la fila de la matriz si existe.
        const config = (rows && rows.length > 0) ? rows[0] : null;
        
        console.log("[NETLIFY] LOG: Array de filas retornado por Supabase:", JSON.stringify(rows));
        console.log("[NETLIFY] LOG: Fila de configuración extraída (config):", JSON.stringify(config));
            
        // --- 3. Manejo de la No Existencia (0 Filas) ---
        if (!config) {
            console.warn(`[NETLIFY] Advertencia: No se encontró la fila con ID=1. Devolviendo configuración vacía.`);

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}), // Devuelve objeto vacío
            };
        }

        // --- 4. Mapeo de Claves (Deg DB a JSON/CSS) ---
        const siteConfig = {};
        // Usamos Object.entries para iterar sobre las columnas de la DB y sus valores
        for (const [dbKey, value] of Object.entries(config)) {
            // La clave de salida puede ser una variable CSS (ej: '--bg-color') o la clave de imagen (ej: 'img1')
            const outputKey = DB_TO_CSS_MAP[dbKey]; 
            
            if (outputKey) {
                // Solo incluimos valores que no son null o undefined
                if (value !== null && value !== undefined) { 
                    siteConfig[outputKey] = value;
                }
            }
        }
        
        console.log("[NETLIFY] LOG: Datos finales (incluyendo imágenes) enviados:", JSON.stringify(siteConfig));

        // --- 5. Éxito ---
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(siteConfig),
        };

    } catch (error) {
        console.error("[NETLIFY] Error FATAL en la función get-site-config (Catch Block):", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor.", details: error.message }),
        };
    }
};