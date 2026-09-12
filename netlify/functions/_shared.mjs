import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';

export const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
export const headers = { 'Access-Control-Allow-Origin': process.env.SITE_URL || '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
export const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
export const options = () => ({ statusCode: 204, headers });
export const readBody = event => JSON.parse(event.body || '{}');
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const code = () => String(crypto.randomInt(100000, 1000000));

export function mailer() {
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}

export function otpEmail(value, verificationCode, purpose) {
  const title = purpose === 'register' ? 'Bienvenido a Niunx Play' : 'Tu código de acceso';
  return { from: process.env.SMTP_FROM || process.env.SMTP_USER, to: value, subject: `${verificationCode} · ${title}`, text: `Tu código de Niunx Play es ${verificationCode}. Expira en 10 minutos. Si no lo ves, revisa también la carpeta de spam.`, html: `<div style="margin:0;background:#070b1a;padding:38px 18px;font-family:Arial,sans-serif;color:#f6f8ff"><div style="max-width:520px;margin:auto;background:#101a35;border:1px solid #304d82;border-radius:18px;padding:36px;box-shadow:0 20px 60px #020510"><div style="font-size:12px;font-weight:bold;letter-spacing:3px;color:#2be3ff">NIUNX PLAY</div><h1 style="font-size:28px;margin:24px 0 10px;color:#fff">${title}</h1><p style="color:#a6b8da;line-height:1.6">Usa este código para continuar. Nunca lo compartas con nadie.</p><div style="margin:28px 0;padding:20px;text-align:center;border:1px solid #466ba9;border-radius:12px;background:#0a142d;color:#2be3ff;font-size:36px;font-weight:bold;letter-spacing:10px">${verificationCode}</div><p style="color:#7187ac;font-size:12px">Este código expira en 10 minutos. Si no aparece, revisa también la carpeta de spam. Si no solicitaste este correo, puedes ignorarlo.</p><div style="margin-top:30px;color:#637698;font-size:11px">© 2026 Niunx Play · Servicios digitales y recargas</div></div></div>` };
}
