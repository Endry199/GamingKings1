import { supabaseAdmin, headers, json, options, readBody, code, hash, mailer, otpEmail } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  let stage = 'request';
  const runtime = {
    method: event.httpMethod,
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    smtpHost: process.env.SMTP_HOST || null,
    smtpPort: process.env.SMTP_PORT || '587',
    hasSmtpUser: Boolean(process.env.SMTP_USER),
    smtpUserLength: process.env.SMTP_USER?.length || 0,
    hasSmtpPass: Boolean(process.env.SMTP_PASS),
    smtpPassLength: process.env.SMTP_PASS?.length || 0,
    hasSmtpFrom: Boolean(process.env.SMTP_FROM),
    siteUrl: process.env.SITE_URL || null
  };
  console.info('[register-account] request received', runtime);
  try {
    const { email, password, firstName, lastName } = readBody(event);
    console.info('[register-account] payload validated', { hasEmail: Boolean(email), emailDomain: email?.split('@')[1] || null, passwordLength: password?.length || 0, hasFirstName: Boolean(firstName), hasLastName: Boolean(lastName) });
    if (!email || !password || password.length < 8 || !firstName || !lastName) return json(400, { error: 'Completa todos los campos y usa una contraseña de 8 caracteres o más.' });
    stage = 'auth_user';
    console.info('[register-account] creating Supabase Auth user');
    const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}` } });
    if (error) { console.error('[register-account] auth_user failed', { name: error.name, code: error.code, status: error.status, message: error.message }); return json(400, { error: error.message }); }
    console.info('[register-account] Supabase Auth user created', { userId: data.user.id });
    const verificationCode = code();
    stage = 'otp_database';
    console.info('[register-account] inserting OTP record');
    const { error: otpError } = await supabaseAdmin.from('email_verification_codes').insert({ email: email.toLowerCase(), code_hash: hash(verificationCode), purpose: 'register', expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    if (otpError) throw otpError;
    console.info('[register-account] OTP record inserted');
    stage = 'smtp';
    const smtpTransport = mailer();
    console.info('[register-account] checking SMTP connection');
    await smtpTransport.verify();
    console.info('[register-account] SMTP connection verified');
    await smtpTransport.sendMail(otpEmail(email, verificationCode, 'register'));
    console.info('[register-account] OTP email sent');
    return json(200, { ok: true, userId: data.user.id });
  } catch (error) {
    console.error('[register-account]', { stage, name: error?.name, code: error?.code, message: error?.message });
    return json(500, { error: `No se pudo completar el registro (${stage}). ${error?.message || 'Error interno.'}` });
  }
}
