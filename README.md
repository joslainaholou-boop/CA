# Œil du Quartier

Système d'alerte communautaire par WhatsApp pour la remontée et le tri des
signalements des chefs de quartier/village vers l'arrondissement et la
mairie, pour les 13 arrondissements de la commune de Ouidah.

- Proposition complète (architecture, grille de classification, tableau de
  bord, escalade, budget) : voir le document partagé avec le porteur du
  projet.
- Implémentation du tri automatique (semaine 3) : [`apps-script/Code.gs`](apps-script/Code.gs)
  et son guide d'installation [`apps-script/SETUP.md`](apps-script/SETUP.md).
- Données de référence (arrondissements, quartiers/villages, gabarit de
  l'onglet « Chefs ») : [`data/`](data/).

## Architecture en bref

13 numéros WhatsApp dédiés (niveau 1, un par arrondissement, tenus par
chaque secrétariat d'arrondissement) reçoivent les messages des chefs de
quartier/village. Un script Google Apps Script partagé les classe
automatiquement par urgence (Faible / À surveiller / Critique) et par
catégorie (Sécurité, Sinistre, Social, Infrastructure, Autre) via l'API
Claude, les enregistre dans un tableau de bord Google Sheets commun, et
alerte immédiatement un numéro niveau 2 partagé (secrétariat de mairie) en
cas d'urgence critique.

Le pilote (arrondissement OUIDAH III) a été le premier branché ; les 12
autres arrondissements suivent le même circuit, avec un déploiement
progressif recommandé (voir `apps-script/SETUP.md`).
