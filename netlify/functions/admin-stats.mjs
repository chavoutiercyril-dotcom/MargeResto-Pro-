import { authenticated, onError, respond, stripeClient } from '../lib/server.mjs';

export default async function handler(request) {
  try {
    const { db, profile } = await authenticated(request);
    if (!profile.is_admin) return respond({ error: 'Accès réservé à l’administrateur.' }, 403);
    const all = [];
    for (let i = 0; i < 10; i++) {
      const { data, error } = await db.from('profiles')
        .select('email, trial_ends_at, subscription_status, created_at, cancel_at_period_end, is_admin, stripe_customer_id')
        .order('created_at', { ascending: false }).range(i * 1000, (i + 1) * 1000 - 1);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
    }
    const now = Date.now();
    const active = all.filter(p => p.subscription_status === 'active');
    const trials = all.filter(p => !p.is_admin && !['active', 'trialing'].includes(p.subscription_status) && new Date(p.trial_ends_at).getTime() > now);
    let paidInvoices30Days = null;
    let invoiceListTruncated = false;
    try {
      const since = Math.floor((now - 30 * 86400000) / 1000);
      const invoices = await stripeClient().invoices.list({ created: { gte: since }, limit: 100 });
      // Somme limitée aux 100 factures de la page ; pour un grand volume, exporter les données de Stripe.
      const customerIds = new Set(all.map(p => p.stripe_customer_id).filter(Boolean));
      invoiceListTruncated = invoices.has_more;
      paidInvoices30Days = invoices.data.filter(i => i.status === 'paid' && customerIds.has(typeof i.customer === 'string' ? i.customer : i.customer?.id)).reduce((sum, i) => sum + (i.amount_paid || 0), 0);
    } catch (err) { console.warn('Facturation indisponible', err?.message); }
    return respond({
      accounts: all.length,
      trials: trials.length,
      activeSubscribers: active.length,
      estimatedMrrHt: active.length * 19,
      paidInvoices30Days,
      invoiceListTruncated,
      recent: all.slice(0, 25).map(p => ({
        email: p.email,
        created_at: p.created_at,
        status: p.is_admin ? 'Administrateur' : p.subscription_status === 'active' ? 'Abonné' :
          p.subscription_status === 'past_due' ? 'Paiement en retard' :
          new Date(p.trial_ends_at).getTime() > now ? 'Essai gratuit' : 'Inactif',
      }))
    });
  } catch (err) { return onError(err); }
}
