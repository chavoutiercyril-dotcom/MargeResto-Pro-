import { authenticated, onError, respond, siteUrl, stripeClient } from '../lib/server.mjs';

export default async function handler(request) {
  try {
    const { profile } = await authenticated(request);
    if (!profile.stripe_customer_id) return respond({ error: 'Aucun abonnement n’est associé à ce compte.' }, 404);
    const session = await stripeClient().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl()}/?billing=portal`,
    });
    return respond({ url: session.url });
  } catch (err) { return onError(err); }
}
