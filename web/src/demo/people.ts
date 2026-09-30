export type PersonKind = 'friend' | 'family' | 'colleague' | 'shop' | 'spammer' | 'scammer' | 'harasser' | 'stranger';

export interface DemoPerson {
  id: string;
  name: string;
  kind: PersonKind;
  monitored: boolean;
  context?: string;
}

export const SELF_ID = '33639980000@s.whatsapp.net';
export const SELF_NAME = 'Camille';

// Numbers sit in the range ARCEP reserves for fiction (06 39 98 xx xx), so none can reach a real subscriber.
function jid(suffix: number): string {
  return `3363998${String(suffix).padStart(4, '0')}@s.whatsapp.net`;
}

function formattedNumber(suffix: number): string {
  const digits = String(suffix).padStart(4, '0');
  return `+33 6 39 98 ${digits.slice(0, 2)} ${digits.slice(2)}`;
}

function person(suffix: number, name: string, kind: PersonKind, monitored: boolean, context?: string): DemoPerson {
  return { id: jid(suffix), name, kind, monitored, context };
}

export const DEMO_PEOPLE: DemoPerson[] = [
  person(1, 'Mireille Renard', 'family', false),
  person(2, 'Julien Renard', 'family', false),
  person(3, 'Nadia Benali', 'friend', false),
  person(4, 'Thomas Girard', 'friend', false),
  person(5, 'Inès Castellano', 'friend', false),
  person(6, 'Louis Fontaine', 'friend', false),
  person(7, 'Sofia Andersson', 'friend', false),
  person(8, 'Hugo Mercier', 'colleague', false),
  person(9, 'Élodie Brun', 'colleague', false),
  person(10, 'Karim Haddad', 'colleague', false),
  person(11, 'Priya Raman', 'colleague', false),
  person(12, 'Atelier Lumière', 'shop', true, 'Small framing shop. Order numbers, invoice links and pickup reminders from them are expected, not spam.'),
  person(13, 'Boulangerie du Coin', 'shop', false),
  person(14, 'Dr. Pauline Morel', 'stranger', false),
  person(20, 'Valentin Roche', 'harasser', true, 'Ex-flatmate. Keeps reopening the deposit dispute after being asked to stop.'),
  person(21, 'Jordan B.', 'harasser', true),
  person(22, 'Océane Lacroix', 'harasser', true),
  person(23, 'Marc (Leboncoin)', 'stranger', true, 'Buyer of a sofa. Messages about pickup times are fine; repeated price haggling after a refusal is not.'),
  person(30, 'Crypto Gains Team', 'spammer', true),
  person(31, 'Promo Flash -70%', 'spammer', true),
  person(32, 'Lucas Martel', 'spammer', true),
  person(33, 'Coach Sandrine ✨', 'spammer', true),
  person(34, 'Mobile Bonus', 'spammer', true),
  person(40, 'Support Colissimo', 'scammer', true),
  person(41, 'Service Impôts', 'scammer', true),
  person(42, 'Banque Horizon', 'scammer', true),
  person(43, 'Anna (recruiter)', 'scammer', true),
  person(44, 'Mr. Adebayo Okonkwo', 'scammer', true),
  person(50, formattedNumber(50), 'spammer', true),
  person(51, formattedNumber(51), 'stranger', false),
  person(52, formattedNumber(52), 'scammer', true),
  person(60, 'Pierre Delattre', 'friend', true, 'Childhood friend who jokes with very dark humour. Teasing between us is banter, not harassment.'),
  person(61, 'Zoé Marchand', 'friend', true),
  person(62, 'Maxime Vidal', 'colleague', true),
  person(63, 'Yasmine Kadri', 'family', true),
  person(64, 'Alexandre Petit', 'stranger', true),
  person(65, 'Lina Schmitt', 'friend', false),
  person(66, 'Rémi Blanchard', 'friend', false),
  person(67, 'Clara Hoffmann', 'colleague', false),
  person(68, 'Samuel Okafor', 'friend', false),
  person(69, 'Margaux Lefèvre', 'friend', false),
];
