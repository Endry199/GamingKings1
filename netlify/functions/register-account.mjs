import { supabaseAdmin, headers, json, options, readBody, code, hash, mailer, otpEmail } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  let stage = 'request';
  try {
    const { email, password, firstName, lastName } = readBody(event);
    if (!email || !password || password.length < 8 || !firstName || !lastName) return json(400, { error: 'Completa todos los campos y usa una contraseña de 8 caracteres o más.' });
    stage = 'auth_user';
    const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}` } });
    if (error) return json(400, { error: error.message });
    const verificationCode = code();
    stage = 'otp_database';
    const { error: otpError } = await supabaseAdmin.from('email_verification_codes').insert({ email: email.toLowerCase(), code_hash: hash(verificationCode), purpose: 'register', expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    if (otpError) throw otpError;
    stage = 'smtp';
    await mailer().sendMail(otpEmail(email, verificationCode, 'register'));
    return json(200, { ok: true, userId: data.user.id });
  } catch (error) {
    console.error('[register-account]', { stage, name: error?.name, code: error?.code, message: error?.message });
    return json(500, { error: `No se pudo completar el registro (${stage}). ${error?.message || 'Error interno.'}` });
  }
}
