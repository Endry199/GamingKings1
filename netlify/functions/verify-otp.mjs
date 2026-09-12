import { supabaseAdmin, json, options, readBody, hash } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  try {
    const { email, code, purpose = 'login' } = readBody(event);
    if (!email || !/^\d{6}$/.test(code || '')) return json(400, { error: 'Código inválido.' });
    const { data, error } = await supabaseAdmin.from('email_verification_codes').select('id').eq('email', email.toLowerCase()).eq('purpose', purpose).eq('code_hash', hash(code)).gt('expires_at', new Date().toISOString()).is('used_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return json(400, { error: 'El código es incorrecto o ya expiró.' });
    await supabaseAdmin.from('email_verification_codes').update({ used_at: new Date().toISOString() }).eq('id', data.id);
    return json(200, { ok: true });
  } catch (error) { return json(500, { error: error.message }); }
}
