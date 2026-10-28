# MargeResto Payant — Guide de mise en ligne

## Ce qui est livré

- Votre outil de fiches techniques, calcul de coût matière, marge et simulation de saison.
- Connexion par e-mail et mot de passe (Supabase Auth).
- 14 jours gratuits dès l'inscription, **sans saisie de carte bancaire**.
- Après les 14 jours : le compte est bloqué tant que le client n'achète pas volontairement un abonnement **19 € HT/mois** ; **aucun prélèvement automatique** n'a lieu à la fin de l'essai sans achat du client.
- Paiement sécurisé et résiliation via Stripe Checkout / Stripe Customer Portal.
- Sauvegarde des données par utilisateur dans Supabase, avec politiques RLS.
- Administration réservée au propriétaire : nombre de comptes, abonnés actifs, MRR théorique, factures Stripe payées (aperçu partiel), liste des comptes récents.
- Import manuel d'anciennes données locales sur **le même domaine et navigateur** (ou import du fichier JSON existant).

**IMPORTANT :** le code est prêt à configurer, mais il n'est PAS encore relié à vos comptes réels. Ne le présentez pas comme un site capable d'encaisser tant que les étapes ci-dessous ne sont pas faites et testées.

## Étape 1 — Créer Supabase

1. Ouvrir https://supabase.com et créer un projet.
2. Aller dans **SQL Editor**, coller et exécuter `sql/01_supabase_setup.sql`.
3. Dans **Project Settings > API Keys**, récupérer l'URL du projet et la clé **publishable/anon** (publique), ainsi que la clé **service_role** (secrète). Les noms des menus peuvent évoluer.
4. Dans **Authentication > URL Configuration**, déclarer **Site URL** `https://marge-resto.netlify.app` et ajouter cette adresse aux redirections autorisées.
5. Dans **Authentication > Providers > Email**, conserver la vérification de l'adresse e-mail. Pour la vraie production, configurer un SMTP adapté à l'envoi d'e-mails.
6. Choisir la région d'hébergement et configurer la politique de conservation et les sauvegardes selon vos obligations.

## Étape 2 — Créer Stripe

1. Ouvrir https://dashboard.stripe.com, commencer en **mode test**.
2. Créer un produit nommé `MargeResto Pro` avec **un prix récurrent : 19,00 EUR / mois, hors taxes (tax_behavior = exclusive)**. Copier son identifiant `price_...`.
3. Dans Stripe, configurer le **portail client** pour permettre aux clients de gérer/annuler leur abonnement.
4. Créer un endpoint Webhook à l'adresse :
   `https://marge-resto.netlify.app/.netlify/functions/stripe-webhook`
   Événements à écouter :
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
5. Copier la **clé secrète** Stripe `sk_test_...` et la clé de signature `whsec_...`.
6. Avant d'encaisser des clients réels : terminer la vérification d'entreprise Stripe et les réglages TVA/facturation. Pour la TVA automatisée, activer et configurer Stripe Tax puis définir `STRIPE_AUTOMATIC_TAX=true` ; sinon la facturation des taxes doit être étudiée et configurée selon votre situation.

## Étape 3 — Publier sur votre site Netlify

Le **ZIP de cette version n'est pas un simple site statique** : il inclut des fonctions serveur pour contrôler les paiements. Ne pas remplacer le site en glissant seulement le dossier `dist` ou un ancien ZIP statique.

**Méthode recommandée sur ordinateur (plus simple et fiable)** :

1. Décompresser ce ZIP sur l'ordinateur.
2. Créer un dépôt **PRIVÉ** sur https://github.com/new et y transférer **tous les fichiers** et dossiers (avec leur arborescence). Ne pas transférer de `.env` rempli de secrets. On peut utiliser GitHub Desktop ou l'interface web.
3. Aller dans votre compte Netlify, ouvrir le projet **marge-resto**, puis connecter un dépôt Git dans **Project configuration > Build & deploy > Continuous deployment** (les menus peuvent varier). Sélectionner le dépôt créé.
4. Dans Netlify **Environment variables**, créer les variables ci-dessous en reprenant les vraies valeurs :

    - `VITE_SUPABASE_URL` (publique)
    - `VITE_SUPABASE_ANON_KEY` (publique)
    - `SUPABASE_SERVICE_ROLE_KEY` (**secrète, côté serveur uniquement**)
    - `STRIPE_SECRET_KEY` (**secrète**)
    - `STRIPE_PRICE_ID` (identifiant du tarif mensuel)
    - `STRIPE_WEBHOOK_SECRET` (**secrète**)
    - `SITE_URL` = `https://marge-resto.netlify.app`
    - `STRIPE_AUTOMATIC_TAX` = `false` tant que Stripe Tax n'est pas configuré.

5. Déclencher un nouveau déploiement. Netlify exécutera `npm run build` et déploiera automatiquement les fonctions du dossier `netlify/functions`.
6. Vérifier que les fonctions sont visibles dans la section **Functions** de Netlify et que l'URL publique affiche « Créer mon compte ».
7. Remplacer les clés Stripe de test par les clés **live** après avoir validé tous les tests. Recréer le webhook live et son `whsec_...` : les clés de test et live sont différentes.

**Ne jamais publier :** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, un fichier `.env` rempli, ou une capture montrant vos clés.

## Étape 4 — Devenir administrateur

1. Sur l'application publiée, créer votre propre compte puis confirmer votre e-mail.
2. Dans Supabase > SQL Editor, exécuter ce SQL en remplaçant l'e-mail :

```sql
update public.profiles set is_admin = true where email = 'VOTRE_EMAIL@EXEMPLE.FR';
```

3. Se reconnecter. Un onglet **Administration** apparaît.
4. Vous pouvez voir l'évolution des comptes. Le MRR = `19 € × abonnés actifs` est une estimation HT, et les factures 30 jours sont limitées aux 100 dernières et n'incluent pas les remboursements/frais Stripe.

## Étape 5 — Test obligatoire avant la commercialisation

- Inscription → confirmation e-mail → connexion.
- Une fiche recette et une simulation créées → déconnexion → reconnexion → données conservées.
- Vérifier que deux utilisateurs **ne voient jamais les recettes de l'autre**.
- Dans SQL Editor, terminer artificiellement **le compte test** (`trial_ends_at = now() - interval '1 day'`) → l'écran de paiement apparaît.
- Paiement Stripe en **mode test** (carte de test 4242 4242 4242 4242, date future, CVC quelconque) → le Webhook donne accès au compte.
- Vérifier que le portail de facturation permet l'annulation ; confirmer le comportement à la fin de la période.
- Vérifier une tentative de paiement échoué et les conditions d'accès.
- Vérifier le bouton de sauvegarde JSON et la restauration.
- Vérifier le fonctionnement sur Android et ordinateur.

## Avant les vrais clients

**Obligatoire :** compléter les mentions légales/CGV/confidentialité dans `public/legal.html`, renseigner une adresse e-mail d'assistance, valider la fiscalité et la TVA applicables, organiser la gestion des demandes RGPD et des sauvegardes, vérifier les clauses d'abonnement et de résiliation. La conformité ne peut pas être validée par ce code seul.

## Développement local (facultatif)

Installez Node.js 22 puis dans le dossier :

```bash
npm install
npm run check
npm run build
```

Pour exécuter les fonctions localement avec leurs variables, utiliser Netlify CLI (`netlify dev`) et un fichier `.env` local jamais commité. Le simple `npm run dev` lance l'interface Vite, pas les fonctions Netlify.

Si vous voyez encore l'ancienne version après mise à jour : actualisez Chrome, supprimez si besoin l'ancienne installation de l'écran d'accueil, et effacez le cache du site. La nouvelle version désactive le précédent service worker hors ligne.

## Questions fréquentes

**Un client est-il débité dès qu'il crée un compte ?** Non, il a 14 jours gratuits sans carte. Il paie uniquement s'il clique sur « Activer mon abonnement » et confirme sur Stripe.

**Que deviennent les recettes après 14 jours sans paiement ?** Elles restent en base de données ; elles ne sont plus accessibles via l'application tant que le compte n'a pas repris un droit d'accès. La durée effective de conservation doit être prévue aux conditions contractuelles.

**Puis-je supprimer votre ancien site Netlify ?** Non : vous pouvez conserver `marge-resto.netlify.app`, connectez simplement cette nouvelle version à votre **site Netlify existant**.

**Le ZIP suffit-il pour encaisser ?** Non. Il faut un projet Supabase, un compte Stripe, les clés et webhook configurés sur Netlify et des tests réussis.

**Mes recettes restent-elles dans le téléphone ?** Non : une fois connecté à la version payante, elles sont envoyées sur Supabase. Les anciens contenus locaux ne sont importés qu'avec un choix explicite (même domaine/navigateur, ou via JSON).
