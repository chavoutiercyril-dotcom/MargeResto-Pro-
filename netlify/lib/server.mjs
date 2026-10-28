import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export function respond(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Configuration manquante : ${name}`);
  return value;
}
export function adminDb() {
  return createClient(env('VITE_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
export function stripeClient() {
  return new Stripe(env('STRIPE_SECRET_KEY'));
}
export function siteUrl() {
  const url = new URL(env('SITE_URL'));
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('SITE_URL doit utiliser HTTPS.');
  }
  return url.origin;
}
export async function authenticated(request) {
  if (request.method !== 'POST') throw Object.assign(new Error('Méthode refusée.'), { status: 405 });
  const match = /^Bearer ([a-zA-Z0-9_\-.]+)$/.exec(request.headers.get('authorization') || '');
  if (!match) throw Object.assign(new Error('Connexion nécessaire.'), { status: 401 });
  const db = adminDb();
  const { data: { user }, error } = await db.auth.getUser(match[1]);
  if (error || !user) throw Object.assign(new Error('Session invalide ou expirée.'), { status: 401 });
  const { data: profile, error: profileError } = await db.from('profiles')
    .select('*').eq('id', user.id).single();
  if (profileError || !profile) throw Object.assign(new Error('Profil client introuvable.'), { status: 403 });
  return { db, user, profile };
}
export function onError(err) {
  console.error('[MargeResto backend]', err);
  const status = err?.status || 500;
  // Ne pas renvoyer de clés ou la configuration interne au client.
  const visible = status >= 500 ? 'Service temporairement indisponible. Contactez le support si le problème persiste.' : err.message;
  return respond({ error: visible }, status);
}
export async function verifiedPrice(stripe) {
  const price = await stripe.prices.retrieve(env('STRIPE_PRICE_ID'));
  if (!price.active || price.unit_amount !== 1900 || price.currency !== 'eur' ||
      price.recurring?.interval !== 'month' || price.recurring?.interval_count !== 1 ||
      price.tax_behavior !== 'exclusive') {
    throw new Error('Le tarif Stripe doit être actif, mensuel, à 19,00 € HT (tax_behavior=exclusive).');
  }
  return price.id;
}
