# Semaine 3 — brancher le tri automatique (10 arrondissements)

Ce guide suppose que le compte Meta est déjà validé (arrondissement pilote
OUIDAH III) et que le tableau de bord « Œil du Quartier » existe déjà dans
votre Google Drive. Le déploiement couvre désormais les 10 arrondissements de
la commune de Ouidah : 10 numéros niveau 1 (un par arrondissement) partagent
le même tableau de bord, le même script et le même numéro niveau 2 (mairie).

## 0. Préparer les deux onglets du tableau de bord

1. Renommez l'onglet existant en **`Remontées`** (clic droit sur l'onglet →
   Renommer). Ses colonnes doivent être, dans l'ordre : `Date`, `Heure`,
   `Arrondissement`, `Quartier / Village`, `Message`, `Urgence`, `Catégorie`,
   `Statut`, `Notes`.
2. Cliquez sur le **+** en bas pour créer un second onglet, nommé **`Chefs`**,
   avec 4 colonnes : `Numéro`, `Arrondissement`, `Quartier / Village`,
   `Nom du chef`. Le fichier `data/chefs_template.csv` fourni contient déjà
   les 10 arrondissements et leurs 77 quartiers/villages — copiez-collez son
   contenu dans cet onglet, puis complétez au fur et à mesure les colonnes
   `Numéro` et `Nom du chef` pour chaque chef réel (pas besoin d'avoir les 77
   avant de démarrer : un quartier sans numéro renseigné n'est simplement pas
   encore actif dans le système).

## 1. Obtenir une clé API Anthropic

1. Aller sur **console.anthropic.com**, créer un compte (ou se connecter).
2. Ajouter un crédit de facturation (à l'échelle des 10 arrondissements,
   quelques dizaines de dollars par an suffisent largement — voir le budget
   mis à jour dans la proposition).
3. Menu **API Keys** → **Create Key** → copier la clé (elle ne sera montrée
   qu'une fois).

## 2. Récupérer les identifiants WhatsApp (Meta) — pour les 10 numéros

Sur **developers.facebook.com**, dans l'app créée en semaine 2 :

1. Onglet **WhatsApp → Configuration de l'API** : le numéro OUIDAH III y
   figure déjà. Ajoutez les 9 autres numéros niveau 1 un par un
   (**Ajouter un numéro de téléphone**), en suivant pour chacun la même
   procédure de vérification par SMS/appel que pour le premier (semaine 2).
2. Générer **un seul jeton d'accès permanent** valable pour les 10 numéros
   (utilisateur système avec le rôle Admin, app attribuée, permissions
   `whatsapp_business_messaging` et `whatsapp_business_management`). Pas
   besoin d'un jeton par numéro.

## 3. Créer le script

1. Ouvrez le tableau de bord → menu **Extensions → Apps Script**.
2. Supprimez le contenu par défaut et collez tout le contenu du fichier
   `Code.gs` fourni.
3. Icône **⚙️ Paramètres du projet** → **Propriétés du script → Ajouter une
   propriété du script**, et créez les 5 propriétés listées en haut de
   `Code.gs` :

   | Propriété | Valeur |
   |---|---|
   | `ANTHROPIC_API_KEY` | la clé obtenue à l'étape 1 |
   | `WHATSAPP_TOKEN` | le jeton permanent obtenu à l'étape 2 (valable pour les 10 numéros) |
   | `WEBHOOK_VERIFY_TOKEN` | un mot de passe que vous inventez (ex. `oeilduquartier2026`) |
   | `SHEET_ID` | l'identifiant du tableau de bord (dans son URL, entre `/d/` et `/edit`) |
   | `MAIRIE_WHATSAPP_NUMBER` | le numéro niveau 2 (mairie), format international sans `+` |

   Contrairement à la version pilote, il n'y a **pas** de propriété
   `PHONE_NUMBER_ID` : le script reconnaît automatiquement, à chaque
   message, lequel des 10 numéros l'a reçu.

## 4. Déployer le script comme site web (une seule fois pour les 10 numéros)

1. Bouton **Déployer → Nouveau déploiement**.
2. Type : **Application Web**.
3. Exécuter en tant que : **Moi**. Qui a accès : **Tout le monde**.
4. Cliquer **Déployer**, autoriser les accès demandés, puis copier l'**URL**
   fournie (elle ressemble à `https://script.google.com/macros/s/.../exec`).

## 5. Brancher le webhook côté Meta — pour chacun des 10 numéros

1. Dans l'app Meta : **WhatsApp → Configuration → Webhook → Modifier**.
2. Coller **la même URL** de l'étape 4 et **le même** `WEBHOOK_VERIFY_TOKEN`.
3. Valider, puis cocher **messages**. Ce réglage de webhook est partagé par
   les 10 numéros de l'app — pas besoin de le refaire pour chacun.

## 6. Tester

1. Dans l'éditeur Apps Script, sélectionner `testAnthropicKey`, cliquer
   **Exécuter**, puis regarder les logs (**Affichage → Journaux**) : si un
   objet avec `urgence` et `categorie` s'affiche, la clé Anthropic fonctionne.
2. Depuis un téléphone dont le numéro est renseigné dans l'onglet `Chefs`,
   envoyer un vrai message WhatsApp au numéro niveau 1 correspondant à son
   arrondissement, par exemple : *« il y a une fuite d'eau importante rue du
   marché »*.
3. Vérifier qu'une nouvelle ligne apparaît dans l'onglet `Remontées`, avec le
   bon arrondissement et le bon quartier.
4. Envoyer un message clairement critique (ex. *« incendie chez moi
   maintenant »*) et vérifier qu'un message arrive immédiatement sur le
   numéro niveau 2 (mairie).
5. Répéter le test pour 2 ou 3 autres arrondissements avant d'ouvrir aux 10.

## 7. Activer la synthèse quotidienne

1. Icône **⏰ Déclencheurs** → **Ajouter un déclencheur**.
2. Fonction à exécuter : `dailySynthesis`. Source de l'événement :
   **Déclencheur horaire**. Type : **Minuteur jour**, à l'heure souhaitée
   (ex. 8h à 9h).
3. Enregistrer. La synthèse envoyée à la mairie regroupe désormais les 10
   arrondissements, avec un décompte par arrondissement.

## Recommandation de déploiement progressif

Avec 10 arrondissements et 77 quartiers/villages, mieux vaut ne pas ouvrir
les 10 numéros le même jour : activez et testez OUIDAH III seul (déjà fait),
puis ajoutez 2 à 3 arrondissements par semaine, le temps de collecter les
vrais numéros des chefs de quartier/village dans `data/chefs_template.csv`
pour chacun.

## En cas de blocage

Notez l'écran exact où ça coince (nom du menu, message d'erreur, numéro de
téléphone concerné) et revenez vers votre accompagnement — la plupart des
blocages viennent d'une propriété du script mal recopiée, d'un jeton
temporaire utilisé à la place du permanent, ou d'un numéro de chef mal
formaté dans l'onglet `Chefs`.
