import { supabaseAdmin, json, options, readBody, hash } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  let stage = 'request';
  try {
    const { email, code, password } = readBody(event);
    if (!email || !/^\d{6}$/.test(code || '') || !password || password.length < 8) return json(400, { error: 'Escribe un correo, código válido y contraseña de 8 caracteres o más.' });
    const normalizedEmail = email.trim().toLowerCase();
    console.info('[reset-password] request received', { emailDomain: normalizedEmail.split('@')[1] || null, passwordLength: password.length });
    stage = 'verify_code';
    const { data: verification, error: verificationError } = await supabaseAdmin.from('email_verification_codes').select('id').eq('email', normalizedEmail).eq('purpose', 'reset').eq('code_hash', hash(code)).gt('expires_at', new Date().toISOString()).is('used_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (verificationError) throw verificationError;
    if (!verification) return json(400, { error: 'El código es incorrecto o ya expiró.' });
    console.info('[reset-password] code verified');
    stage = 'find_user';
    const { data: users, error: userError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 100 });
    if (userError) throw userError;
    const user = users.users.find(item => item.email?.toLowerCase() === normalizedEmail);
    if (!user) return json(400, { error: 'No existe una cuenta con ese correo.' });
    console.info('[reset-password] user found', { userId: user.id });
    stage = 'update_password';
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password });
    if (updateError) throw updateError;
    console.info('[reset-password] password updated');
    stage = 'mark_code_used';
    const { error: usedError } = await supabaseAdmin.from('email_verification_codes').update({ used_at: new Date().toISOString() }).eq('id', verification.id);
    if (usedError) throw usedError;
    console.info('[reset-password] code marked as used');
    return json(200, { ok: true });
  } catch (error) {
    console.error('[reset-password]', { stage, name: error?.name, code: error?.code, message: error?.message });
    return json(500, { error: `No se pudo restablecer la contraseña (${stage}). ${error?.message || 'Error interno.'}` });
  }
}
