import { adminDb, env, onError, respond, stripeClient } from '../lib/server.mjs';

async function updateSubscription(db, stripe, input) {
  let sub = input;
  // Toujours lire l'état le plus récent pour limiter les événements arrivés hors ordre.
  try { sub = await stripe.subscriptions.retrieve(input.id); }
  catch (err) { if (err?.statusCode !== 404) throw err; }
  const userId = sub.metadata?.user_id || input.metadata?.user_id;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  let profileId = userId;
  if (!profileId && customerId) {
    const { data } = await db.from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle();
    profileId = data?.id;
  }
  if (!profileId) throw new Error(`Impossible de relier l'abonnement Stripe ${sub.id} à un utilisateur.`);
  const periodEnd = sub.items?.data?.map(item => item.current_period_end).filter(Boolean).sort((a, b) => b - a)[0]
    || sub.current_period_end || null;
  const { error } = await db.from('profiles').update({
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    stripe_current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  }).eq('id', profileId);
  if (error) throw error;
}

export default async function handler(request) {
  if (request.method !== 'POST') return respond({ error: 'Méthode refusée.' }, 405);
  const signature = request.headers.get('stripe-signature');
  if (!signature) return respond({ error: 'Signature Stripe absente.' }, 400);
  let event;
  let stripe;
  try {
    stripe = stripeClient();
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, signature, env('STRIPE_WEBHOOK_SECRET'));
  } catch (err) {
    console.error('Signature Stripe invalide', err?.message);
    return respond({ error: 'Signature invalide.' }, 400);
  }
  try {
    const db = adminDb();
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode !== 'subscription') return respond({ received: true });
      const userId = session.client_reference_id || session.metadata?.user_id;
      if (!userId) throw new Error('Session Stripe non reliée à un utilisateur.');
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const { error } = await db.from('profiles').update({ stripe_customer_id: customerId })
        .eq('id', userId);
      if (error) throw error;
      if (subscriptionId) await updateSubscription(db, stripe, { id: subscriptionId, customer: customerId, metadata: { user_id: userId } });
    }
    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      await updateSubscription(db, stripe, event.data.object);
    }
    return respond({ received: true });
  } catch (err) { return onError(err); }
}
