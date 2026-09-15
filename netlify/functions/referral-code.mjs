import crypto from 'node:crypto';
import { json, options, readBody, supabaseAdmin } from './_shared.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return options();
  try {
    const authorization = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { error: 'Debes iniciar sesión.' });

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) return json(401, { error: 'La sesión no es válida.' });

    const body = readBody(event);
    const action = String(body.action || 'get');

    // Obtener, crear o rotar código de colaborador
    if (action === 'get' || action === 'create' || action === 'rotate') {
      console.info('[referral-code] action', { action, userId: authData.user.id });
      // Buscar código existente
      const { data: existing } = await supabaseAdmin.from('colaboradores').select('id,code').eq('user_id', authData.user.id).maybeSingle();
      const site = process.env.SITE_URL || '';
      if (existing && action === 'get') {
        const code = existing.code;
        return json(200, { ok: true, code, link: site ? `${site}?ref=${encodeURIComponent(code)}` : null });
      }

      // Generar código nuevo
      const code = `REF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      if (existing && action === 'rotate') {
        console.info('[referral-code] rotating code', { userId: authData.user.id, old: existing.code });
        const { error: updateError } = await supabaseAdmin.from('colaboradores').update({ code }).eq('id', existing.id);
        if (updateError) throw updateError;
        console.info('[referral-code] rotated code', { userId: authData.user.id, new: code });
        return json(200, { ok: true, code, link: site ? `${site}?ref=${encodeURIComponent(code)}` : null });
      }

      // Crear nuevo si no existe o si piden crear
      const { data: inserted, error: insertError } = await supabaseAdmin.from('colaboradores').insert({ user_id: authData.user.id, code }).select('*').single();
      if (insertError) throw insertError;
      return json(200, { ok: true, code: inserted.code, link: site ? `${site}?ref=${encodeURIComponent(inserted.code)}` : null });
    }

    if (action === 'earnings' || action === 'list') {
      console.info('[referral-code] listing earnings', { userId: authData.user.id });
      // Listar ganancias del colaborador
      const { data: earnings } = await supabaseAdmin.from('referral_earnings').select('id, referred_user_id, transaction_id, profit, credited_amount, created_at').eq('referrer_user_id', authData.user.id).order('created_at', { ascending: false }).limit(200);
      // Recuperar datos de usuarios referidos
      const referredIds = [...new Set((earnings || []).map(r => r.referred_user_id).filter(Boolean))];
      let users = [];
      if (referredIds.length) {
        const { data: u } = await supabaseAdmin.from('usuarios').select('google_id,nombre,email').in('google_id', referredIds);
        users = u || [];
      }
      // Mapear
      const mapped = (earnings || []).map(e => ({ ...e, referred: users.find(u => u.google_id === e.referred_user_id) || null }));
      const total = (earnings || []).reduce((s, r) => s + Number(r.credited_amount || 0), 0);
      return json(200, { ok: true, total: Number(total.toFixed(2)), earnings: mapped });
    }

    return json(400, { error: 'Acción desconocida.' });
  } catch (err) {
    console.error('[referral-code] error', err?.message || err);
    return json(500, { error: err?.message || 'Error del servidor.' });
  }
}
