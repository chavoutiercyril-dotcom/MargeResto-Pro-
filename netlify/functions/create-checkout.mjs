import { authenticated, env, onError, respond, siteUrl, stripeClient, verifiedPrice } from '../lib/server.mjs';

export default async function handler(request) {
  try {
    const { user, profile } = await authenticated(request);
    if (['active', 'trialing', 'past_due', 'unpaid'].includes(profile.subscription_status)) {
      return respond({ error: 'Un abonnement existe déjà sur votre compte. Utilisez le portail de facturation.' }, 409);
    }
    const stripe = stripeClient();
    const price = await verifiedPrice(stripe);
    const customer = profile.stripe_customer_id || undefined;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ...(customer ? { customer } : { customer_email: user.email }),
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      metadata: { user_id: user.id },
      subscription_data: { metadata: { user_id: user.id } },
      ...(process.env.STRIPE_AUTOMATIC_TAX === 'true' ? { automatic_tax: { enabled: true } } : {}),
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      success_url: `${siteUrl()}/?billing=success`,
      cancel_url: `${siteUrl()}/?billing=cancel`,
    }, { idempotencyKey: `checkout-${user.id}-${Math.floor(Date.now() / 30000)}` });
    if (!session.url) throw new Error('Stripe n’a pas retourné d’URL de paiement.');
    return respond({ url: session.url });
  } catch (err) { return onError(err); }
}
