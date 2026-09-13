/**
 * Œil du Quartier — agent de tri automatique (semaine 3)
 *
 * Reçoit les messages WhatsApp du numéro niveau 1 (secrétariat d'arrondissement),
 * les classe avec l'IA (urgence + catégorie), les enregistre dans le tableau de
 * bord, et alerte immédiatement le numéro niveau 2 (secrétariat de mairie) en cas
 * d'urgence critique.
 *
 * CONFIGURATION (une seule fois, voir SETUP.md pour le détail écran par écran) :
 * Dans l'éditeur Apps Script : icône ⚙️ "Paramètres du projet" > "Propriétés du
 * script" > "Ajouter une propriété du script", et créer ces 6 propriétés :
 *
 *   ANTHROPIC_API_KEY      clé API Anthropic (console.anthropic.com)
 *   WHATSAPP_TOKEN         jeton d'accès permanent WhatsApp (Meta for Developers)
 *   PHONE_NUMBER_ID        identifiant du numéro niveau 1 (Meta > WhatsApp > Configuration de l'API)
 *   WEBHOOK_VERIFY_TOKEN   un mot de passe inventé par vous, resaisi côté Meta
 *   SHEET_ID               identifiant du tableau de bord (dans son URL, entre /d/ et /edit)
 *   MAIRIE_WHATSAPP_NUMBER numéro niveau 2, format international sans "+" (ex. 229XXXXXXXXX)
 *
 * Le tableau de bord doit avoir deux onglets :
 *   "Remontées" : Date, Heure, Quartier / Village, Message, Urgence, Catégorie, Statut, Notes
 *   "Chefs"     : Numéro, Quartier / Village, Nom du chef
 */

var SHEET_TAB_REMONTEES = 'Remontées';
var SHEET_TAB_CHEFS = 'Chefs';
var RECURRENCE_FENETRE_JOURS = 7;
var RECURRENCE_SEUIL = 3;

function getProp_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error('Propriété manquante : ' + key + '. Voir les instructions en haut du fichier.');
  return value;
}

/** Meta appelle cette fonction une seule fois pour vérifier le webhook. */
function doGet(e) {
  var mode = e.parameter['hub.mode'];
  var token = e.parameter['hub.verify_token'];
  var challenge = e.parameter['hub.challenge'];
  if (mode === 'subscribe' && token === getProp_('WEBHOOK_VERIFY_TOKEN')) {
    return ContentService.createTextOutput(challenge);
  }
  return ContentService.createTextOutput('Jeton de vérification invalide');
}

/** Meta appelle cette fonction à chaque message WhatsApp reçu sur le numéro niveau 1. */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var change = payload.entry && payload.entry[0] && payload.entry[0].changes && payload.entry[0].changes[0];
    var value = change && change.value;
    var message = value && value.messages && value.messages[0];

    if (!message) {
      // Accusé de statut (livré / lu) ou autre notification : rien à faire.
      return ContentService.createTextOutput('ok');
    }

    if (message.type !== 'text') {
      // Note vocale, image, etc. : non gérées dans cette première version.
      sendWhatsAppMessage_(message.from,
        "Merci. Pour l'instant, seuls les messages écrits sont pris en compte automatiquement — pourriez-vous retaper l'essentiel en texte ?");
      return ContentService.createTextOutput('ok');
    }

    handleIncomingMessage_(message.from, message.text.body);
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput('ok');
}

function handleIncomingMessage_(fromWaId, text) {
  var quartier = lookupQuartier_(fromWaId);
  var historique = getRecentHistory_(quartier);
  var classification = classifyMessage_(text, quartier, historique);

  appendToSheet_(new Date(), quartier, text, classification);

  if (classification.urgence === 'Critique') {
    sendWhatsAppMessage_(getProp_('MAIRIE_WHATSAPP_NUMBER'),
      '🔴 ALERTE CRITIQUE\nQuartier/Village : ' + quartier +
      '\nHeure : ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm') +
      '\nRésumé : ' + classification.resume);
    sendWhatsAppMessage_(fromWaId, '🔴 Message reçu et classé CRITIQUE — transmis immédiatement à la mairie.');
  } else if (classification.recurrent) {
    sendWhatsAppMessage_(fromWaId,
      '⚠️ À noter : ceci est au moins le ' + classification.occurences + 'e signalement pour « ' +
      classification.categorie + ' » à ' + quartier + ' en ' + RECURRENCE_FENETRE_JOURS + ' jours.');
  }
}

/** Retrouve le quartier/village à partir du numéro WhatsApp de l'expéditeur (onglet "Chefs"). */
function lookupQuartier_(waId) {
  var sheet = SpreadsheetApp.openById(getProp_('SHEET_ID')).getSheetByName(SHEET_TAB_CHEFS);
  var data = sheet.getDataRange().getValues(); // Numéro, Quartier / Village, Nom du chef
  var cleanWaId = String(waId).replace(/\D/g, '');
  for (var i = 1; i < data.length; i++) {
    var rowNumber = String(data[i][0]).replace(/\D/g, '');
    if (rowNumber && cleanWaId.slice(-8) === rowNumber.slice(-8)) {
      return data[i][1];
    }
  }
  return 'Numéro inconnu (' + waId + ')';
}

/** Lit les signalements des N derniers jours pour ce quartier, pour repérer les répétitions. */
function getRecentHistory_(quartier) {
  var sheet = SpreadsheetApp.openById(getProp_('SHEET_ID')).getSheetByName(SHEET_TAB_REMONTEES);
  var data = sheet.getDataRange().getValues(); // Date, Heure, Quartier, Message, Urgence, Catégorie, Statut, Notes
  var limite = new Date(Date.now() - RECURRENCE_FENETRE_JOURS * 24 * 60 * 60 * 1000);
  var recent = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowDate = new Date(row[0]);
    if (row[2] === quartier && rowDate >= limite) {
      recent.push({ categorie: row[5], urgence: row[4] });
    }
  }
  return recent;
}

/** Appelle Claude pour classer le message (urgence + catégorie) et renvoie un objet JS. */
function classifyMessage_(text, quartier, historique) {
  var categoriesRecentes = historique.map(function (h) { return h.categorie; }).join(', ') || 'aucune';

  var systemPrompt = [
    "Tu es l'agent de tri d'un système d'alerte communautaire au Bénin.",
    "Tu reçois un message écrit en français courant par un chef de quartier ou de village, souvent avec des fautes ou très court.",
    "Classe-le selon cette grille, sans jamais poser de question :",
    "",
    "URGENCE (choisis-en une seule) :",
    "- Faible : fait à noter, sans risque immédiat.",
    "- À surveiller : pourrait s'aggraver ou se répéter.",
    "- Critique : danger réel, besoin d'une décision rapide (incendie, inondation, agression, décès, effondrement...).",
    "",
    "CATÉGORIE (choisis-en une seule) : Sécurité, Sinistre, Social, Infrastructure, Autre.",
    "",
    "Réponds UNIQUEMENT avec un objet JSON, sans texte autour, sans balises markdown, au format exact :",
    '{"urgence": "...", "categorie": "...", "resume": "résumé en une phrase courte"}'
  ].join('\n');

  var userPrompt = 'Quartier/village : ' + quartier +
    '\nCatégories déjà signalées ces ' + RECURRENCE_FENETRE_JOURS + ' derniers jours pour ce quartier : ' + categoriesRecentes +
    '\nMessage reçu : "' + text + '"';

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getProp_('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: 'claude-opus-5', // Pour réduire encore le coût : "claude-haiku-4-5" fonctionne aussi pour cette tâche simple.
      max_tokens: 300,
      system: systemPrompt,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: userPrompt }]
    }),
    muteHttpExceptions: true
  });

  var body = JSON.parse(response.getContentText());
  var textBlock = body.content && body.content.filter(function (b) { return b.type === 'text'; })[0];

  if (!textBlock) {
    console.error('Réponse IA inattendue : ' + response.getContentText());
    return { urgence: 'À surveiller', categorie: 'Autre', resume: text, recurrent: false, occurences: 0 };
  }

  var parsed = JSON.parse(textBlock.text);
  var occurences = historique.filter(function (h) { return h.categorie === parsed.categorie; }).length + 1;
  parsed.recurrent = occurences >= RECURRENCE_SEUIL;
  parsed.occurences = occurences;
  return parsed;
}

function appendToSheet_(date, quartier, message, classification) {
  var sheet = SpreadsheetApp.openById(getProp_('SHEET_ID')).getSheetByName(SHEET_TAB_REMONTEES);
  var notes = classification.recurrent
    ? classification.occurences + 'e signalement en ' + RECURRENCE_FENETRE_JOURS + ' jours pour « ' + classification.categorie + ' »'
    : '';
  sheet.appendRow([
    Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(date, Session.getScriptTimeZone(), 'HH:mm'),
    quartier,
    message,
    classification.urgence,
    classification.categorie,
    'Nouveau',
    notes
  ]);
}

function sendWhatsAppMessage_(toWaId, body) {
  UrlFetchApp.fetch('https://graph.facebook.com/v20.0/' + getProp_('PHONE_NUMBER_ID') + '/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getProp_('WHATSAPP_TOKEN') },
    payload: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toWaId,
      type: 'text',
      text: { body: body }
    }),
    muteHttpExceptions: true
  });
}

/**
 * Synthèse quotidienne envoyée au secrétariat de mairie (niveau 2).
 * À brancher sur un déclencheur horaire quotidien — voir SETUP.md.
 */
function dailySynthesis() {
  var sheet = SpreadsheetApp.openById(getProp_('SHEET_ID')).getSheetByName(SHEET_TAB_REMONTEES);
  var data = sheet.getDataRange().getValues();
  var tz = Session.getScriptTimeZone();
  var hier = Utilities.formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000), tz, 'yyyy-MM-dd');

  var rows = data.slice(1).filter(function (r) {
    return Utilities.formatDate(new Date(r[0]), tz, 'yyyy-MM-dd') === hier;
  });
  if (!rows.length) return;

  var parNiveau = { 'Faible': 0, 'À surveiller': 0, 'Critique': 0 };
  rows.forEach(function (r) { parNiveau[r[4]] = (parNiveau[r[4]] || 0) + 1; });

  sendWhatsAppMessage_(getProp_('MAIRIE_WHATSAPP_NUMBER'),
    'Synthèse du ' + hier + ' :\n' + rows.length + ' signalement(s) — ' +
    parNiveau['Critique'] + ' critique(s), ' + parNiveau['À surveiller'] + ' à surveiller, ' +
    parNiveau['Faible'] + ' faible(s).\nDétail dans le tableau de bord.');
}

/** À exécuter une seule fois, manuellement, pour vérifier que la clé Anthropic fonctionne. */
function testAnthropicKey() {
  var result = classifyMessage_('il ya un feu derriere le marche', 'Quartier Test', []);
  Logger.log(result);
}
