import { createClient } from '@supabase/supabase-js';

const $ = id => document.getElementById(id);
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
let supabase;
let user = null;
let profile = null;
let appStarted = false;
let activeMode = 'signup';
let currentRevision = 0;
let writtenRevision = 0;
let saving = false;
let saveTimer;
let pendingSnapshot = null;

function feedback(message, target = 'authFeedback', success = false) {
  const el = $(target);
  el.textContent = message;
  el.classList.toggle('good', success);
}
function show(view) {
  $('entryScreen').classList.toggle('hidden', view !== 'entry');
  $('paywallScreen').classList.toggle('hidden', view !== 'paywall');
  $('appShell').classList.toggle('hidden', view !== 'app');
}
function errorText(error) {
  const message = error?.message || String(error || 'Une erreur est survenue.');
  if (/invalid login credentials/i.test(message)) return 'Adresse e-mail ou mot de passe incorrect.';
  if (/email not confirmed/i.test(message)) return 'Confirmez votre adresse e-mail grâce au message reçu.';
  if (/rate limit|too many requests/i.test(message)) return 'Trop de tentatives. Réessayez plus tard.';
  return message;
}
function accessGranted(p) {
  return !!p && (p.is_admin || ['active', 'trialing'].includes(p.subscription_status) || new Date(p.trial_ends_at).getTime() > Date.now());
}
function daysRemaining(p) {
  return Math.max(0, Math.ceil((new Date(p.trial_ends_at).getTime() - Date.now()) / 86400000));
}
function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('fr-FR');
}
function setSync(text, warning = false) {
  if (!$('syncLabel')) return;
  $('syncLabel').textContent = text;
  $('syncLabel').style.color = warning ? '#ffd29b' : '#a8c6b3';
}
async function functionCall(name, data = {}) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error('Votre session a expiré. Reconnectez-vous.');
  const response = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(data)
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('Erreur de communication avec le serveur.'); }
  if (!response.ok) throw new Error(result.error || 'Opération impossible.');
  return result;
}
async function subscribe() {
  $('subscribeBtn').disabled = true;
  feedback('Ouverture du paiement sécurisé…', 'billingFeedback', true);
  try {
    if (['past_due', 'unpaid'].includes(profile?.subscription_status) && profile?.stripe_customer_id) {
      await portal();
      $('subscribeBtn').disabled = false;
      return;
    }
    const result = await functionCall('create-checkout');
    if (!result.url?.startsWith('https://checkout.stripe.com/')) throw new Error('Lien de paiement invalide.');
    window.location.assign(result.url);
  } catch (err) {
    feedback(errorText(err), 'billingFeedback');
    $('subscribeBtn').disabled = false;
  }
}
async function portal() {
  $('manageBilling').disabled = true;
  try {
    const result = await functionCall('create-portal');
    if (!result.url?.startsWith('https://billing.stripe.com/')) throw new Error('Lien de gestion invalide.');
    window.location.assign(result.url);
  } catch (err) {
    alert(errorText(err));
    $('manageBilling').disabled = false;
  }
}
async function logout() {
  if (saving || currentRevision > writtenRevision) {
    const ok = confirm('Des modifications peuvent être en cours de sauvegarde. Continuer la déconnexion ?');
    if (!ok) return;
  }
  await supabase.auth.signOut();
  window.location.replace('/');
}
function queueSave(snapshot) {
  pendingSnapshot = JSON.parse(JSON.stringify(snapshot));
  currentRevision += 1;
  setSync('Modifications à synchroniser…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 650);
}
async function flushSave() {
  if (saving || !pendingSnapshot || !user) return;
  saving = true;
  const snapshot = pendingSnapshot;
  const revision = currentRevision;
  setSync('Sauvegarde en cours…');
  try {
    const { error } = await supabase.from('app_data').upsert(
      { user_id: user.id, payload: snapshot },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
    writtenRevision = revision;
    if (currentRevision === revision) {
      pendingSnapshot = null;
      setSync('✓ Données sauvegardées en ligne');
    } else {
      setSync('Dernières modifications à synchroniser…');
    }
  } catch (err) {
    setSync('⚠ Sauvegarde impossible — exportez une copie JSON', true);
    console.error('Sauvegarde en ligne impossible', err);
    // Ne jamais effacer les modifications en mémoire lors d'une erreur.
  } finally {
    saving = false;
    if (currentRevision > writtenRevision && navigator.onLine) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSave, 2500);
    }
  }
}
async function loadProfile() {
  const { data, error } = await supabase.from('profiles')
    .select('id, email, trial_ends_at, subscription_status, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, is_admin')
    .eq('id', user.id).single();
  if (error) throw new Error('Profil inaccessible : vérifiez que vous avez exécuté le fichier SQL et activé les règles de sécurité.');
  return data;
}
async function updateAccess() {
  if (activeMode === 'recover') { show('entry'); return; }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) { user = null; show('entry'); return; }
  if (appStarted && user && user.id !== session.user.id) { window.location.reload(); return; }
  user = session.user;
  try {
    profile = await loadProfile();
    if (!accessGranted(profile)) {
      show('paywall');
      $('paywallTitle').textContent = ['past_due', 'unpaid'].includes(profile.subscription_status)
        ? 'Un paiement nécessite votre attention.' : 'Votre période d’essai est terminée.';
      $('subscribeBtn').textContent = ['past_due', 'unpaid'].includes(profile.subscription_status) ? 'Mettre à jour mon paiement' : 'Activer mon abonnement';
      $('paywallText').textContent = 'Vos données restent conservées sur votre compte. Abonnez-vous pour retrouver toutes les fonctions. Si vous avez déjà payé, actualisez votre accès.';
      return;
    }
    if (!appStarted) await startApp();
    else updateAccountDisplay();
    show('app');
  } catch (err) {
    show('entry');
    feedback(errorText(err));
    console.error(err);
  }
}
function updateAccountDisplay() {
  $('accountEmail').textContent = user.email || '';
  $('mobileEmail').textContent = user.email || '';
  const trial = !['active', 'trialing'].includes(profile.subscription_status) && !profile.is_admin;
  $('accessLabel').textContent = profile.is_admin ? 'Compte administrateur' : trial ? `Essai : ${daysRemaining(profile)} jour(s)` : 'Abonnement actif';
  $('manageBilling').textContent = profile.stripe_customer_id ? 'Gérer mon abonnement' : 'Choisir l’abonnement';
  $('manageBilling').hidden = Boolean(profile.is_admin);
  $('mobileBilling').hidden = Boolean(profile.is_admin);
  const banner = $('trialBanner');
  if (trial) {
    banner.classList.remove('hidden');
    banner.textContent = `Essai gratuit : ${daysRemaining(profile)} jour(s) restant(s). Aucune carte bancaire ne sera débitée automatiquement.`;
    const b = document.createElement('button');
    b.textContent = 'Passer à 19 € HT/mois';
    b.type = 'button';
    b.addEventListener('click', subscribe);
    banner.append(b);
  } else if (profile.cancel_at_period_end) {
    banner.classList.remove('hidden');
    banner.textContent = 'Votre abonnement doit s’arrêter à la fin de la période déjà payée. Consultez votre portail de facturation.';
  } else banner.classList.add('hidden');
}
async function startApp() {
  const { data, error } = await supabase.from('app_data').select('payload').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error('Impossible de charger les données de ce compte. Aucune donnée locale ne sera écrasée.');
  window.MargeCloud = {
    initialData: data?.payload || null,
    save: queueSave
  };
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/app.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Erreur de chargement des calculs de MargeResto.'));
    document.body.append(script);
  });
  appStarted = true;
  updateAccountDisplay();
  if (profile.is_admin) {
    const nav = document.querySelector('.nav');
    const btn = document.createElement('button');
    btn.dataset.tab = 'admin';
    btn.type = 'button';
    btn.innerHTML = '<span class="symbol">▣</span> Administration';
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(el => el.classList.toggle('hidden', el.id !== 'tab-admin'));
      document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el === btn));
      loadAdmin();
    });
    nav.append(btn);
  }
}
async function loadAdmin() {
  $('adminMetrics').innerHTML = '<div class="metric">Chargement des chiffres…</div>';
  try {
    const d = await functionCall('admin-stats');
    const cards = [
      ['Comptes créés', d.accounts],
      ['Essais en cours', d.trials],
      ['Abonnés actifs', d.activeSubscribers],
      ['MRR estimé HT', `${d.estimatedMrrHt.toLocaleString('fr-FR')} €`],
      ['Factures payées, 30 j', d.paidInvoices30Days === null ? '—' : `${(d.paidInvoices30Days / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`]
    ];
    $('adminMetrics').innerHTML = cards.map(([k, v]) => `<div class="metric"><div class="cap">${k}</div><div class="value">${v}</div></div>`).join('');
    const body = $('adminTable');
    body.replaceChildren();
    for (const item of d.recent) {
      const row = document.createElement('tr');
      const email = document.createElement('td'); email.textContent = item.email;
      const status = document.createElement('td'); status.textContent = item.status;
      const created = document.createElement('td'); created.textContent = formatDate(item.created_at);
      row.append(email, status, created); body.append(row);
    }
  } catch (err) {
    $('adminMetrics').textContent = errorText(err);
  }
}

async function onSubmitAuth(event) {
  event.preventDefault();
  if (!supabase) return;
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  $('authSubmit').disabled = true;
  feedback('Vérification en cours…', 'authFeedback', true);
  try {
    if (activeMode === 'recover') {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      feedback('Mot de passe modifié. Vous pouvez désormais utiliser votre compte.', 'authFeedback', true);
      activeMode = 'login';
      window.history.replaceState({}, '', '/');
      await updateAccess();
      return;
    }
    const result = activeMode === 'signup'
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (activeMode === 'signup' && !result.data.session) {
      feedback('Compte créé. Confirmez l’adresse e-mail via le lien reçu, puis connectez-vous.', 'authFeedback', true);
      return;
    }
    await updateAccess();
  } catch (err) { feedback(errorText(err)); }
  finally { $('authSubmit').disabled = false; }
}

function initialize() {
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    activeMode = button.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(el => el.classList.toggle('selected', el === button));
    $('authSubmit').textContent = activeMode === 'signup' ? 'Démarrer 14 jours gratuits' : 'Se connecter';
    $('authPassword').autocomplete = activeMode === 'signup' ? 'new-password' : 'current-password';
    feedback('');
  }));
  $('authForm').addEventListener('submit', onSubmitAuth);
  $('forgotBtn').addEventListener('click', async () => {
    if (!supabase) return;
    const email = $('authEmail').value.trim();
    if (!email) { feedback('Indiquez votre adresse e-mail dans le champ ci-dessus.'); return; }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/?reset=1` });
      if (error) throw error;
      feedback('Si cette adresse possède un compte, vous recevrez un lien pour réinitialiser le mot de passe.', 'authFeedback', true);
    } catch (err) { feedback(errorText(err)); }
  });
  $('subscribeBtn').addEventListener('click', subscribe);
  $('refreshAccess').addEventListener('click', updateAccess);
  $('paywallLogout').addEventListener('click', logout);
  $('signOut').addEventListener('click', logout);
  $('manageBilling').addEventListener('click', () => profile?.stripe_customer_id ? portal() : subscribe());
  $('mobileAccount').addEventListener('click', () => $('mobileOverlay').classList.remove('hidden'));
  $('mobileClose').addEventListener('click', () => $('mobileOverlay').classList.add('hidden'));
  $('mobileLogout').addEventListener('click', logout);
  $('mobileBilling').addEventListener('click', () => profile?.stripe_customer_id ? portal() : subscribe());
  $('migrateLocal').addEventListener('click', () => window.MargeResto?.importLegacy());
  window.addEventListener('online', flushSave);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (currentRevision > writtenRevision) flushSave(); updateAccess(); } });
  if (!URL || !KEY) {
    $('setupMessage').textContent = 'Configuration manquante : le propriétaire doit renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sur Netlify puis republier.';
    $('setupMessage').classList.remove('hidden');
    $('authSubmit').disabled = true;
    return;
  }
  // L'ancienne version installait un cache hors-ligne ; il ne doit pas garder la page de connexion en cache.
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
  supabase = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      activeMode = 'recover';
      $('authSubmit').textContent = 'Définir mon nouveau mot de passe';
      $('authPassword').value = '';
      $('authPassword').placeholder = 'Nouveau mot de passe (8 caractères min.)';
      show('entry');
      feedback('Choisissez votre nouveau mot de passe ci-dessus.', 'authFeedback', true);
    }
    if (event === 'SIGNED_OUT') { user = null; if (appStarted) window.location.reload(); else show('entry'); }
    // Éviter les appels réseau synchrones depuis ce callback Supabase.
  });
  updateAccess();
  const params = new URLSearchParams(window.location.search);
  if (params.has('billing')) window.history.replaceState({}, '', window.location.pathname);
}
initialize();
