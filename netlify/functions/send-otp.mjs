import { supabaseAdmin, json, options, readBody, code, hash, mailer, otpEmail } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  try {
    const { email, purpose = 'login' } = readBody(event);
    if (!email) return json(400, { error: 'Falta el correo.' });
    const verificationCode = code();
    const { error } = await supabaseAdmin.from('email_verification_codes').insert({ email: email.toLowerCase(), code_hash: hash(verificationCode), purpose, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    if (error) throw error;
    await mailer().sendMail(otpEmail(email, verificationCode, purpose));
    return json(200, { ok: true });
  } catch (error) { return json(500, { error: error.message }); }
}
