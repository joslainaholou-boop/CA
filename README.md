# Œil du Quartier

Système d'alerte communautaire par WhatsApp pour la remontée et le tri des
signalements des chefs de quartier/village vers l'arrondissement et la mairie.

- Proposition complète (architecture, grille de classification, tableau de
  bord, escalade, budget) : voir le document partagé avec le porteur du
  projet.
- Implémentation du tri automatique (semaine 3) : [`apps-script/Code.gs`](apps-script/Code.gs)
  et son guide d'installation [`apps-script/SETUP.md`](apps-script/SETUP.md).

## Architecture en bref

Un numéro WhatsApp dédié (niveau 1, tenu par le secrétariat d'arrondissement)
reçoit les messages des chefs de quartier/village. Un script Google Apps
Script les classe automatiquement par urgence (Faible / À surveiller /
Critique) et par catégorie (Sécurité, Sinistre, Social, Infrastructure,
Autre) via l'API Claude, les enregistre dans un tableau de bord Google
Sheets, et alerte immédiatement un second numéro (niveau 2, secrétariat de
mairie) en cas d'urgence critique.
