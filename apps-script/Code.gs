/**
 * Œil du Quartier — agent de tri automatique (semaine 3 + notes vocales)
 * Version commune de Ouidah : 10 numéros niveau 1 (un par arrondissement),
 * qui partagent le même tableau de bord et le même numéro niveau 2 (mairie).
 *
 * Chaque arrondissement a son propre numéro WhatsApp, mais tous pointent vers
 * ce même script (même URL de webhook déployée une seule fois). Le script
 * reconnaît automatiquement quel numéro a reçu le message (fourni par Meta
 * dans chaque appel) pour répondre depuis le bon numéro.
 *
 * Messages écrits ET notes vocales sont pris en charge. Une note vocale est
 * transcrite automatiquement (français fiable ; fon expérimental — voir
 * SETUP.md) avant de passer par le même agent de tri que le texte. L'audio
 * original est toujours conservé dans Drive et lié depuis le tableau de bord,
 * pour qu'un secrétariat puisse réécouter en cas de doute sur la transcription.
 *
 * CONFIGURATION (une seule fois, voir SETUP.md) :
 * Dans l'éditeur Apps Script : icône ⚙️ "Paramètres du projet" > "Propriétés
 * du script" > "Ajouter une propriété du script", et créer ces 6 propriétés :
 *
 *   ANTHROPIC_API_KEY      clé API Anthropic (console.anthropic.com) — classification du texte
 *   OPENAI_API_KEY         clé API OpenAI (platform.openai.com) — transcription des notes vocales
 *   WHATSAPP_TOKEN         jeton d'accès permanent WhatsApp, valable pour les 10 numéros (Meta for Developers)
 *   WEBHOOK_VERIFY_TOKEN   un mot de passe inventé par vous, resaisi côté Meta
 *   SHEET_ID               identifiant du tableau de bord (dans son URL, entre /d/ et /edit)
 *   MAIRIE_WHATSAPP_NUMBER numéro niveau 2 (mairie), format international sans "+" (ex. 229XXXXXXXXX)
 *
 * Le tableau de bord doit avoir deux onglets :
 *   "Remontées" : Date, Heure, Arrondissement, Quartier / Village, Message, Urgence, Catégorie, Statut, Notes
 *   "Chefs"     : Numéro, Arrondissement, Quartier / Village, Nom du chef
 *                 (voir data/chefs_template.csv pour un point de départ avec les 10
 *                  arrondissements et leurs quartiers/villages déjà remplis)
 */

var SHEET_TAB_REMONTEES = 'Remontées';
var SHEET_TAB_CHEFS = 'Chefs';
var RECURRENCE_FENETRE_JOURS = 7;
var RECURRENCE_SEUIL = 3;
var AUDIO_DRIVE_FOLDER = 'Œil du Quartier — Audios reçus';

function getProp_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error('Propriété manquante : ' + key + '. Voir les instructions en haut du fichier.');
  return value;
}

/** Meta appelle cette fonction une seule fois par numéro pour vérifier le webhook. */
function doGet(e) {
  var mode = e.parameter['hub.mode'];
  var token = e.parameter['hub.verify_token'];
  var challenge = e.parameter['hub.challenge'];
  if (mode === 'subscribe' && token === getProp_('WEBHOOK_VERIFY_TOKEN')) {
    return ContentService.createTextOutput(challenge);
  }
  return ContentService.createTextOutput('Jeton de vérification invalide');
}

/** Meta appelle cette fonction à chaque message WhatsApp reçu, quel que soit celui des 10 numéros. */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var change = payload.entry && payload.entry[0] && payload.entry[0].changes && payload.entry[0].changes[0];
    var value = change && change.value;
    var message = value && value.messages && value.messages[0];
    // Numéro qui a effectivement reçu ce message (un des 10) — sert à répondre depuis le bon numéro.
    var receivingPhoneNumberId = value && value.metadata && value.metadata.phone_number_id;

    if (!message) {
      // Accusé de statut (livré / lu) ou autre notification : rien à faire.
      return ContentService.createTextOutput('ok');
    }

    if (receivingPhoneNumberId) {
      // Mémorisé pour que dailySynthesis() ait un numéro valide depuis lequel écrire à la mairie.
      PropertiesService.getScriptProperties().setProperty('LAST_PHONE_NUMBER_ID', receivingPhoneNumberId);
    }

    if (message.type === 'audio') {
      handleIncomingAudio_(receivingPhoneNumberId, message.from, message.audio.id);
    } else if (message.type === 'text') {
      processMessage_(receivingPhoneNumberId, message.from, message.text.body, '');
    } else {
      // Image, position, etc. : non gérées dans cette version.
      sendWhatsAppMessage_(receivingPhoneNumberId, message.from,
        "Merci. Seuls les messages écrits et les notes vocales sont pris en compte automatiquement pour l'instant.");
    }
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput('ok');
}

/** Note vocale : transcription, puis même parcours qu'un message écrit. */
function handleIncomingAudio_(receivingPhoneNumberId, fromWaId, mediaId) {
  var audioBlob = downloadWhatsAppMedia_(mediaId);
  var audioUrl = saveAudioToDrive_(audioBlob, fromWaId, new Date());
  var transcription = transcribeAudio_(audioBlob);

  var sourceNote = transcription.language === 'french' || transcription.language === 'fr'
    ? '🎙️ Transcrit automatiquement (audio) — écouter : ' + audioUrl
    : '⚠️ Transcription incertaine (langue détectée : ' + (transcription.language || 'inconnue') +
      ') — à vérifier à l\'oreille : ' + audioUrl;

  if (!transcription.text) {
    // Transcription vide/échouée : on prévient sans deviner, plutôt que de classer du vide.
    sendWhatsAppMessage_(receivingPhoneNumberId, fromWaId,
      "Votre note vocale est bien arrivée mais n'a pas pu être transcrite automatiquement — un agent va l'écouter directement. Vous pouvez aussi retaper l'essentiel en texte si c'est urgent.");
    var sheet = SpreadsheetApp.openById(getProp_('SHEET_ID')).getSheetByName(SHEET_TAB_REMONTEES);
    var chefInconnu = lookupChef_(fromWaId);
    sheet.appendRow([
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm'),
      chefInconnu.arrondissement, chefInconnu.quartier,
      '(note vocale non transcrite)', 'À surveiller', 'Autre', 'À vérifier',
      '⚠️ Échec de transcription — écouter : ' + audioUrl
    ]);
    return;
  }

  processMessage_(receivingPhoneNumberId, fromWaId, transcription.text, sourceNote);
}

/** Cœur du tri, partagé par le texte et les notes vocales transcrites. */
function processMessage_(receivingPhoneNumberId, fromWaId, text, sourceNote) {
  var chef = lookupChef_(fromWaId);
  var historique = getRecentHistory_(chef.arrondissement, chef.quartier);
  var classification = classifyMessage_(text, chef, historique);

  appendToSheet_(new Date(), chef, text, classification, sourceNote);

  if (classification.urgence === 'Critique') {
    sendWhatsAppMessage_(receivingPhoneNumberId, getProp_('MAIRIE_WHATSAPP_NUMBER'),
      '🔴 ALERTE CRITIQUE\nArrondissement : ' + chef.arrondissement +
      '\nQuartier/Village : ' + chef.quartier +
      '\nHeure : ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm') +
      '\nRésumé : ' + classification.resume);
    sendWhatsAppMessage_(receivingPhoneNumberId, fromWaId, '🔴 Message reçu et classé CRITIQUE — transmis immédiatement à la mairie.');
  } else if (classification.recurrent) {
    sendWhatsAppMessage_(receivingPhoneNumberId, fromWaId,
      '⚠️ À noter : ceci est au moins le ' + classification.occurences + 'e signalement pour « ' +
      classification.categorie + ' » à ' + chef.quartier + ' en ' + RECURRENCE_FENETRE_JOURS + ' jours.');
  }
}

/** Retrouve l'arrondissement et le quartier/village à partir du numéro WhatsApp de l'expéditeur. */
function lookupChef_(waId) {
  var sheet = SpreadsheetApp.openById(getProp_('SHEET_ID')).getSheetByName(SHEET_TAB_CHEFS);
  var data = sheet.getDataRange().getValues(); // Numéro, Arrondissement, Quartier / Village, Nom du chef
  var cleanWaId = String(waId).replace(/\D/g, '');
  for (var i = 1; i < data.length; i++) {
    var rowNumber = String(data[i][0]).replace(/\D/g, '');
    if (rowNumber && cleanWaId.slice(-8) === rowNumber.slice(-8)) {
      return { arrondissement: data[i][1], quartier: data[i][2] };
    }
  }
  return { arrondissement: 'Inconnu', quartier: 'Numéro inconnu (' + waId + ')' };
}

/** Lit les signalements des N derniers jours pour ce quartier précis, pour repérer les répétitions. */
function getRecentHistory_(arrondissement, quartier) {
  var sheet = SpreadsheetApp.openById(getProp_('SHEET_ID')).getSheetByName(SHEET_TAB_REMONTEES);
  var data = sheet.getDataRange().getValues(); // Date, Heure, Arrondissement, Quartier, Message, Urgence, Catégorie, Statut, Notes
  var limite = new Date(Date.now() - RECURRENCE_FENETRE_JOURS * 24 * 60 * 60 * 1000);
  var recent = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowDate = new Date(row[0]);
    if (row[2] === arrondissement && row[3] === quartier && rowDate >= limite) {
      recent.push({ categorie: row[6], urgence: row[5] });
    }
  }
  return recent;
}

/** Appelle Claude pour classer le message (urgence + catégorie) et renvoie un objet JS. */
function classifyMessage_(text, chef, historique) {
  var categoriesRecentes = historique.map(function (h) { return h.categorie; }).join(', ') || 'aucune';

  var systemPrompt = [
    "Tu es l'agent de tri d'un système d'alerte communautaire au Bénin.",
    "Tu reçois un message écrit en français courant par un chef de quartier ou de village, souvent avec des fautes ou très court — parfois issu de la transcription automatique d'une note vocale (donc parfois approximatif ou mêlé de fon).",
    "Classe-le selon cette grille, sans jamais poser de question :",
    "",
    "URGENCE (choisis-en une seule) :",
    "- Faible : fait à noter, sans risque immédiat.",
    "- À surveiller : pourrait s'aggraver ou se répéter.",
    "- Critique : danger réel, besoin d'une décision rapide (incendie, inondation, agression, décès, effondrement...).",
    "",
    "CATÉGORIE (choisis-en une seule) : Sécurité, Sinistre, Social, Infrastructure, Autre.",
    "",
    "Si le message est trop confus ou incomplet pour être compris avec certitude, classe-le \"À surveiller\" par prudence plutôt que \"Faible\".",
    "",
    "Réponds UNIQUEMENT avec un objet JSON, sans texte autour, sans balises markdown, au format exact :",
    '{"urgence": "...", "categorie": "...", "resume": "résumé en une phrase courte"}'
  ].join('\n');

  var userPrompt = 'Arrondissement : ' + chef.arrondissement + ' — Quartier/village : ' + chef.quartier +
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

function appendToSheet_(date, chef, message, classification, sourceNote) {
  var sheet = SpreadsheetApp.openById(getProp_('SHEET_ID')).getSheetByName(SHEET_TAB_REMONTEES);
  var recurNote = classification.recurrent
    ? classification.occurences + 'e signalement en ' + RECURRENCE_FENETRE_JOURS + ' jours pour « ' + classification.categorie + ' »'
    : '';
  var notes = [sourceNote, recurNote].filter(function (n) { return n; }).join(' — ');
  sheet.appendRow([
    Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(date, Session.getScriptTimeZone(), 'HH:mm'),
    chef.arrondissement,
    chef.quartier,
    message,
    classification.urgence,
    classification.categorie,
    'Nouveau',
    notes
  ]);
}

/** Envoie un message WhatsApp en utilisant le numéro (des 10) donné par fromPhoneNumberId. */
function sendWhatsAppMessage_(fromPhoneNumberId, toWaId, body) {
  UrlFetchApp.fetch('https://graph.facebook.com/v20.0/' + fromPhoneNumberId + '/messages', {
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

/** Télécharge le fichier audio d'une note vocale WhatsApp (deux étapes : URL temporaire, puis fichier). */
function downloadWhatsAppMedia_(mediaId) {
  var metaResponse = UrlFetchApp.fetch('https://graph.facebook.com/v20.0/' + mediaId, {
    headers: { Authorization: 'Bearer ' + getProp_('WHATSAPP_TOKEN') },
    muteHttpExceptions: true
  });
  var meta = JSON.parse(metaResponse.getContentText());

  var fileResponse = UrlFetchApp.fetch(meta.url, {
    headers: { Authorization: 'Bearer ' + getProp_('WHATSAPP_TOKEN') },
    muteHttpExceptions: true
  });
  var blob = fileResponse.getBlob();
  var ext = (meta.mime_type || '').indexOf('ogg') !== -1 ? 'ogg' : 'oga';
  return blob.setName('note_vocale.' + ext);
}

/** Sauvegarde l'audio dans Drive et renvoie un lien pour l'écouter plus tard (partagez le dossier avec les secrétariats). */
function saveAudioToDrive_(audioBlob, fromWaId, date) {
  var folders = DriveApp.getFoldersByName(AUDIO_DRIVE_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(AUDIO_DRIVE_FOLDER);
  var filename = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm') + '_' + fromWaId + '.' + audioBlob.getName().split('.').pop();
  var file = folder.createFile(audioBlob.copyBlob().setName(filename));
  return file.getUrl();
}

/** Envoie l'audio à l'API de transcription (Whisper) et renvoie {text, language}. */
function transcribeAudio_(audioBlob) {
  var response = UrlFetchApp.fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + getProp_('OPENAI_API_KEY') },
    payload: {
      file: audioBlob,
      model: 'whisper-1',
      response_format: 'verbose_json'
      // Pas de paramètre "language" imposé : on laisse la détection automatique,
      // pour repérer les cas où ce n'est probablement pas du français (donc à vérifier).
    },
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
  if (!result || typeof result.text !== 'string') {
    console.error('Échec de transcription : ' + response.getContentText());
    return { text: '', language: null };
  }
  return { text: result.text.trim(), language: result.language };
}

/**
 * Synthèse quotidienne envoyée au secrétariat de mairie (niveau 2), pour les 10 arrondissements.
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
  var parArrondissement = {};
  rows.forEach(function (r) {
    parNiveau[r[5]] = (parNiveau[r[5]] || 0) + 1;
    parArrondissement[r[2]] = (parArrondissement[r[2]] || 0) + 1;
  });

  var detailArrondissements = Object.keys(parArrondissement)
    .map(function (a) { return '- ' + a + ' : ' + parArrondissement[a]; })
    .join('\n');

  // Envoyée depuis le premier numéro connu du système (peu importe lequel, c'est un message vers la mairie).
  var unNumero = getFirstPhoneNumberId_();
  sendWhatsAppMessage_(unNumero, getProp_('MAIRIE_WHATSAPP_NUMBER'),
    'Synthèse du ' + hier + ' — commune de Ouidah :\n' + rows.length + ' signalement(s) — ' +
    parNiveau['Critique'] + ' critique(s), ' + parNiveau['À surveiller'] + ' à surveiller, ' +
    parNiveau['Faible'] + ' faible(s).\nPar arrondissement :\n' + detailArrondissements +
    '\nDétail complet dans le tableau de bord.');
}

/** Utilisé uniquement pour la synthèse quotidienne : renvoie un numéro niveau 1 déjà utilisé récemment. */
function getFirstPhoneNumberId_() {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty('LAST_PHONE_NUMBER_ID');
  if (!stored) throw new Error('Aucun message reçu pour le moment : LAST_PHONE_NUMBER_ID est vide.');
  return stored;
}

/** À exécuter une seule fois, manuellement, pour vérifier que la clé Anthropic fonctionne. */
function testAnthropicKey() {
  var result = classifyMessage_('il ya un feu derriere le marche', { arrondissement: 'Test', quartier: 'Quartier Test' }, []);
  Logger.log(result);
}
