// supabaseClient.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// *** IMPORTANTE: Reemplaza estos valores con los de tu proyecto Supabase ***
// Puedes encontrarlos en tu Dashboard de Supabase:
// Configuración del proyecto > API > Project URL y Project API key (anon)
const supabaseUrl = 'https://oznmqczxpywvdmefermv.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96bm1xY3p4cHl3dmRtZWZlcm12Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MzIwODc3NywiZXhwIjoyMDY4Nzg0Nzc3fQ.shFt2SQvNAjKyK2RLsz2NBf0EyHyJuw_Z1tGOVuWzjY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);