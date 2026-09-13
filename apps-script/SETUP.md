# Semaine 3 — brancher le tri automatique

Ce guide suppose que le compte Meta est déjà validé et que le tableau de bord
« Œil du Quartier » existe déjà dans votre Google Drive.

## 0. Préparer les deux onglets du tableau de bord

Ouvrez le tableau de bord et vérifiez qu'il a bien ces deux onglets (en bas de
l'écran) :

1. Renommez l'onglet existant en **`Remontées`** (clic droit sur l'onglet →
   Renommer). Ses colonnes doivent être, dans l'ordre : `Date`, `Heure`,
   `Quartier / Village`, `Message`, `Urgence`, `Catégorie`, `Statut`, `Notes`.
2. Cliquez sur le **+** en bas pour créer un second onglet, nommé **`Chefs`**,
   avec 3 colonnes : `Numéro`, `Quartier / Village`, `Nom du chef`. Remplissez
   une ligne par chef de quartier/village, avec son numéro WhatsApp personnel
   (c'est ce numéro qui permettra au système de reconnaître automatiquement
   qui a écrit).

## 1. Obtenir une clé API Anthropic

1. Aller sur **console.anthropic.com**, créer un compte (ou se connecter).
2. Ajouter un petit crédit de facturation (quelques dollars suffisent très
   largement à votre volume).
3. Menu **API Keys** → **Create Key** → copier la clé (elle ne sera montrée
   qu'une fois).

## 2. Récupérer les identifiants WhatsApp (Meta)

Sur **developers.facebook.com**, dans l'app créée en semaine 2 :

1. Onglet **WhatsApp → Configuration de l'API** : noter le
   **Phone number ID** du numéro niveau 1.
2. Générer un **jeton d'accès permanent** (dans les paramètres de l'app côté
   « Utilisateurs système », créer un utilisateur système avec le rôle Admin,
   lui attribuer l'app, puis générer un jeton sans date d'expiration avec les
   permissions `whatsapp_business_messaging` et `whatsapp_business_management`).
   Le jeton temporaire proposé par défaut expire en 24h — il faut celui-là,
   le permanent, pour que le système continue de fonctionner sans y retoucher.

## 3. Créer le script

1. Ouvrez le tableau de bord → menu **Extensions → Apps Script**.
2. Supprimez le contenu par défaut et collez tout le contenu du fichier
   `Code.gs` fourni.
3. Cliquez sur l'icône **⚙️ Paramètres du projet**, puis **Propriétés du
   script → Ajouter une propriété du script**, et créez les 6 propriétés
   listées en haut de `Code.gs` :

   | Propriété | Valeur |
   |---|---|
   | `ANTHROPIC_API_KEY` | la clé obtenue à l'étape 1 |
   | `WHATSAPP_TOKEN` | le jeton permanent obtenu à l'étape 2 |
   | `PHONE_NUMBER_ID` | le Phone number ID obtenu à l'étape 2 |
   | `WEBHOOK_VERIFY_TOKEN` | un mot de passe que vous inventez (ex. `oeilduquartier2026`) |
   | `SHEET_ID` | l'identifiant du tableau de bord (dans son URL, entre `/d/` et `/edit`) |
   | `MAIRIE_WHATSAPP_NUMBER` | le numéro niveau 2, format international sans `+` (ex. `229195978661`) |

## 4. Déployer le script comme site web

1. Bouton **Déployer → Nouveau déploiement**.
2. Type : **Application Web**.
3. Exécuter en tant que : **Moi**. Qui a accès : **Tout le monde**.
4. Cliquer **Déployer**, autoriser les accès demandés, puis copier l'**URL**
   fournie (elle ressemble à `https://script.google.com/macros/s/.../exec`).

## 5. Brancher le webhook côté Meta

1. Dans l'app Meta : **WhatsApp → Configuration → Webhook → Modifier**.
2. Coller l'URL de l'étape 4 dans **URL de rappel**, et le mot de passe
   `WEBHOOK_VERIFY_TOKEN` choisi à l'étape 3 dans **Jeton de vérification**.
3. Valider, puis cocher le champ **messages** dans la liste des abonnements.

## 6. Tester

1. Dans l'éditeur Apps Script, sélectionner la fonction `testAnthropicKey`
   dans le menu déroulant en haut, cliquer **Exécuter**, puis regarder les
   logs (**Affichage → Journaux**) : si un objet avec `urgence` et
   `categorie` s'affiche, la clé Anthropic fonctionne.
2. Depuis un téléphone enregistré dans l'onglet `Chefs`, envoyer un vrai
   message WhatsApp au numéro niveau 1, par exemple :
   *« il y a une fuite d'eau importante rue du marché »*.
3. Vérifier qu'une nouvelle ligne apparaît dans l'onglet `Remontées` du
   tableau de bord en quelques secondes.
4. Envoyer un message clairement critique (ex. *« incendie chez moi
   maintenant »*) et vérifier qu'un message arrive immédiatement sur le
   numéro niveau 2 (mairie).

## 7. Activer la synthèse quotidienne

1. Dans l'éditeur Apps Script, icône **⏰ Déclencheurs** (dans le menu de
   gauche) → **Ajouter un déclencheur**.
2. Fonction à exécuter : `dailySynthesis`. Source de l'événement :
   **Déclencheur horaire**. Type : **Minuteur jour**, à l'heure souhaitée
   (ex. 8h à 9h).
3. Enregistrer.

## En cas de blocage

Notez l'écran exact où ça coince (nom du menu, message d'erreur) et revenez
vers votre accompagnement — la plupart des blocages à ce stade viennent d'une
propriété du script mal recopiée (espace en trop, guillemets copiés) ou du
jeton d'accès temporaire utilisé à la place du permanent.
