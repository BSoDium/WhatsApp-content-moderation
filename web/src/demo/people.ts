export type PersonKind = 'friend' | 'family' | 'colleague' | 'shop' | 'spammer' | 'scammer' | 'harasser' | 'stranger';

export interface DemoPerson {
  id: string;
  name: string;
  kind: PersonKind;
  monitored: boolean;
  context?: string;
  portraitUrl: string | null;
}

type PortraitGender = 'men' | 'women';

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

const PORTRAIT_BASE_URL = 'https://randomuser.me/api/portraits';
const PORTRAIT_POOL_SIZE = 100;
// Coprime with the pool size, so the nth person of a gender always lands on a distinct face.
const PORTRAIT_STRIDE = 11;
const PORTRAIT_OFFSET = 5;

// Accounts and numbers absent here (shops, scam senders, unsaved numbers) have no photo, as in a real contact list.
const PORTRAIT_GENDER_BY_SUFFIX: Record<number, PortraitGender> = {
  1: 'women', 2: 'men', 3: 'women', 4: 'men', 5: 'women', 6: 'men', 7: 'women', 8: 'men', 9: 'women', 10: 'men', 11: 'women', 14: 'women',
  20: 'men', 21: 'men', 22: 'women', 23: 'men', 32: 'men', 33: 'women', 43: 'women', 44: 'men',
  60: 'men', 61: 'women', 62: 'men', 63: 'women', 64: 'men', 65: 'women', 66: 'men', 67: 'women', 68: 'men', 69: 'women',
};

const portraitCount: Record<PortraitGender, number> = { men: 0, women: 0 };

function portraitUrl(gender: PortraitGender): string {
  const index = (portraitCount[gender]++ * PORTRAIT_STRIDE + PORTRAIT_OFFSET) % PORTRAIT_POOL_SIZE;
  return `${PORTRAIT_BASE_URL}/${gender}/${index}.jpg`;
}

function person(suffix: number, name: string, kind: PersonKind, monitored: boolean, context?: string): DemoPerson {
  const gender = PORTRAIT_GENDER_BY_SUFFIX[suffix];
  return { id: jid(suffix), name, kind, monitored, context, portraitUrl: gender ? portraitUrl(gender) : null };
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
