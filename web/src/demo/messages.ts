export interface FlaggedTemplate {
  message: string;
  category: string;
  reason: string;
}

export interface PassedTemplate {
  message: string;
  reason: string;
}

export const PASSED_INCOMING = {
  family: [
    { message: 'Tu viens dimanche pour le déjeuner ? Papa fait son gigot.', reason: 'the contact is inviting the user to a family lunch' },
    { message: "N'oublie pas d'appeler Mamie pour son anniversaire", reason: 'the contact is reminding the user of a family birthday' },
    { message: 'Photos du week-end en pièce jointe 😊', reason: 'the contact is sharing holiday photos' },
    { message: 'Tu peux me déposer à la gare demain à 7h ?', reason: 'the contact is asking a favour for a train ride' },
  ],
  friend: [
    { message: 'Ça te dit un ciné jeudi soir ?', reason: 'the contact is proposing a movie night' },
    { message: 'Haha, je suis mort. Envoie-moi le lien !', reason: 'the contact is reacting to something funny' },
    { message: 'Did you see the match last night?? Unreal.', reason: 'the contact is making small talk about sport' },
    { message: 'Je passe te prendre à 19h, ok ?', reason: 'the contact is arranging a pickup time' },
    { message: 'Merci encore pour hier, c’était génial', reason: 'the contact is thanking the user after an evening out' },
    { message: 'Tu as des nouvelles de Nadia ? Elle répond plus depuis lundi.', reason: 'the contact is asking about a mutual friend' },
    { message: 'Brunch samedi chez moi, apporte du jus d’orange', reason: 'the contact is inviting the user to brunch' },
  ],
  colleague: [
    { message: 'Le déploiement est prévu à 16h, on se cale sur le point de 15h30 ?', reason: 'the contact is coordinating a work deployment' },
    { message: 'Can you review my PR before the standup? No rush though.', reason: 'the contact is making a polite work request' },
    { message: 'Je suis en retard de 10 minutes, commencez sans moi', reason: 'the contact is informing the user of a short delay' },
    { message: 'Slides for tomorrow are in the shared drive', reason: 'the contact is sharing a work document' },
    { message: 'Merci pour ton aide sur le bug, ça marche maintenant !', reason: 'the contact is thanking the user for help' },
  ],
  shop: [
    { message: 'Bonjour, votre commande #4821 est prête à être retirée.', reason: 'the contact is notifying the user that an order is ready' },
    { message: 'Facture n°2024-0193 en pièce jointe, merci de votre confiance.', reason: 'the contact is sending an expected invoice' },
    { message: 'Nous fermons exceptionnellement à 17h ce jeudi.', reason: 'the contact is announcing opening hours' },
    { message: 'Le cadre est terminé, vous pouvez passer quand vous voulez.', reason: 'the contact is saying finished work can be collected' },
  ],
  stranger: [
    { message: 'Bonjour, le canapé est toujours disponible ?', reason: 'the contact is asking about an advertised item' },
    { message: 'Ok pour samedi 14h, je serai devant l’immeuble.', reason: 'the contact is confirming a pickup slot' },
    { message: 'Hello, is the bike still for sale?', reason: 'the contact is asking about an advertised item' },
    { message: 'Merci, bonne journée !', reason: 'the contact is closing a polite exchange' },
  ],
  banter: [
    { message: "T'es vraiment nul aux échecs, on dirait un pigeon sur le plateau 😂", reason: 'the contact is teasing the user in a friendly way between long-time friends' },
    { message: 'Tu me dois une bière après ce désastre. Sinon je te déshérite.', reason: 'the contact is joking about owing a drink' },
    { message: "Ta coupe de cheveux est criminelle. Appelle la police de la mode.", reason: 'the contact is joking about a haircut' },
  ],
} satisfies Record<string, PassedTemplate[]>;

export const OUTGOING_REPLIES = [
  'Ok, merci !',
  'Je regarde ça dans la journée.',
  'Yes, sounds good.',
  'Oui, pas de souci 👍',
  'Je te rappelle ce soir.',
  'Parfait, à demain alors.',
  'Haha, bien vu.',
  'Could you send that again?',
  'Merci, bien reçu.',
  'Je suis en réunion, je te réponds après.',
];

export const FLAGGED_INCOMING = {
  spammer: [
    { message: '🔥 MEGA PROMO -70% sur tout le site ! Cliquez ici : https://promo-flash-shop.example/deal', category: 'spam', reason: 'the contact is sending an unsolicited promotional link' },
    { message: 'Gagnez 500€/jour depuis votre téléphone, aucune expérience requise. Répondez OUI pour commencer', category: 'spam', reason: 'the contact is pushing an unsolicited get-rich-quick offer' },
    { message: 'Bonjour ! Découvrez notre formation coaching bien-être, -50% jusqu’à minuit : https://coach-sandrine.example', category: 'spam', reason: 'the contact is advertising a paid course to someone who never asked' },
    { message: 'Vous avez été sélectionné pour un bonus de 100€ ! Réclamez-le : https://mobile-bonus-fr.example/claim', category: 'spam', reason: 'the contact is sending an unsolicited prize link' },
    { message: 'Invest in $COIN now, 10x guaranteed this week. Join the private group: https://t.example/crypto-gains', category: 'spam', reason: 'the contact is promoting a cryptocurrency group unprompted' },
    { message: 'Hello dear, I saw your profile and I have a business opportunity for you', category: 'unwanted_contact', reason: 'the contact is cold-messaging the user with a vague business offer' },
  ],
  scammer: [
    { message: 'Colissimo : votre colis est en attente, frais de livraison 1,99€ à régler sous 24h : https://colis-suivi-fr.example/pay', category: 'scam', reason: 'the contact is impersonating a delivery service to collect a payment' },
    { message: 'Impôts : un remboursement de 312,40€ est disponible. Confirmez vos coordonnées bancaires : https://impots-remb.example', category: 'scam', reason: 'the contact is impersonating a tax authority to collect banking details' },
    { message: 'Banque Horizon : activité suspecte sur votre compte. Appelez immédiatement le 06 39 98 00 99 ou votre carte sera bloquée.', category: 'scam', reason: 'the contact is impersonating a bank to pressure the user into calling' },
    { message: 'Hi, I am recruiting for a remote job paying 300€ per day, just like our page and send a screenshot.', category: 'scam', reason: 'the contact is offering a fake job that matches a known task-scam pattern' },
    { message: 'Dear friend, I am a lawyer in Lagos. A client left 4.5M USD and I need a foreign partner. You keep 40%.', category: 'scam', reason: 'the contact is running an advance-fee inheritance scam' },
    { message: 'Salut maman, c’est mon nouveau numéro, mon téléphone est tombé. Tu peux me faire un virement urgent ?', category: 'scam', reason: 'the contact is impersonating a relative to request an urgent transfer' },
  ],
  harasser: [
    { message: "Tu réponds pas ? Je sais que tu lis mes messages. Réponds ou je viens chez toi.", category: 'harassment', reason: 'the contact is threatening to show up at the user’s home' },
    { message: "Je t'ai dit que tu me devais 600€ de caution. Je vais t'écrire tous les jours jusqu'à ce que tu paies.", category: 'harassment', reason: 'the contact is promising daily messages after being asked to stop' },
    { message: "T'es vraiment qu'un lâche. Tout le monde saura quel genre de personne tu es.", category: 'harassment', reason: 'the contact is insulting the user and threatening to expose them' },
    { message: 'RÉPONDS.', category: 'harassment', reason: 'the contact keeps demanding a reply after the user stopped responding' },
    { message: "Bloque-moi si tu veux, je trouverai un autre moyen de te parler.", category: 'harassment', reason: 'the contact is saying they will evade a block' },
    { message: 'Last chance. Answer me tonight or you will regret it.', category: 'harassment', reason: 'the contact is issuing a veiled threat' },
    { message: "Je sais où tu travailles, tu sais.", category: 'harassment', reason: 'the contact is hinting they know where the user works' },
  ],
  stranger: [
    { message: 'Je te fais 100€ pour le canapé, dernier prix. Réponds !', category: 'unwanted_contact', reason: 'the contact keeps haggling after the user refused the offer' },
    { message: 'Pourquoi tu ne réponds pas ? 120€ c’est déjà généreux.', category: 'unwanted_contact', reason: 'the contact keeps pressuring the user about a refused offer' },
    { message: 'Bonjour, je me permets de vous relancer une énième fois concernant mon offre.', category: 'unwanted_contact', reason: 'the contact keeps chasing the user after being ignored' },
  ],
} satisfies Record<string, FlaggedTemplate[]>;

export const GENERATED_WARNINGS = [
  "Ce message a été supprimé : merci de ne plus m'envoyer de contenu de ce type.",
  "That message was removed for violating this chat's policy. Further messages like this will lead to a block.",
  "Message supprimé. Merci de respecter les règles de cette conversation, sinon vous serez bloqué.",
  'Please stop sending unsolicited offers. This was automatically removed and you may be blocked if it continues.',
  'Ce type de message n’est pas accepté ici. Un nouvel écart entraînera un blocage.',
];

export const CLASSIFIER_ERRORS = ['Ollama request timed out', 'Ollama returned invalid JSON', 'connect ECONNREFUSED 127.0.0.1:11434'];

export const CALL_WARNING_TEMPLATE = 'Please stop calling repeatedly without a reply — this is strike {strikes} of {threshold}. Further calls may result in you being blocked.';
