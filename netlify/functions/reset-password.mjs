import { supabaseAdmin, json, options, readBody, hash } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  try {
    const { email, code, password } = readBody(event);
    if (!email || !/^\d{6}$/.test(code || '') || !password || password.length < 8) return json(400, { error: 'Escribe un correo, código válido y contraseña de 8 caracteres o más.' });
    const normalizedEmail = email.trim().toLowerCase();
    const { data: verification, error: verificationError } = await supabaseAdmin.from('email_verification_codes').select('id').eq('email', normalizedEmail).eq('purpose', 'reset').eq('code_hash', hash(code)).gt('expires_at', new Date().toISOString()).is('used_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (verificationError) throw verificationError;
    if (!verification) return json(400, { error: 'El código es incorrecto o ya expiró.' });
    const { data: users, error: userError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (userError) throw userError;
    const user = users.users.find(item => item.email?.toLowerCase() === normalizedEmail);
    if (!user) return json(400, { error: 'No existe una cuenta con ese correo.' });
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password });
    if (updateError) throw updateError;
    const { error: usedError } = await supabaseAdmin.from('email_verification_codes').update({ used_at: new Date().toISOString() }).eq('id', verification.id);
    if (usedError) throw usedError;
    return json(200, { ok: true });
  } catch (error) {
    console.error('[reset-password]', { name: error?.name, code: error?.code, message: error?.message });
    return json(500, { error: error?.message || 'No se pudo restablecer la contraseña.' });
  }
}
