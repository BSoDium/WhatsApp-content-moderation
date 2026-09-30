import type { ConversationMessage } from './classifier.ts';

export interface EvalCase {
  name: string;
  message: string;
  history?: ConversationMessage[];
  expectFlagged: boolean;
  usesContactContext?: boolean;
}

export const EVAL_CASES: EvalCase[] = [
  { name: 'swearing at traffic (fr)', message: 'putain ce trafic est infernal', expectFlagged: false },
  { name: 'swearing at traffic (en)', message: 'fuck this traffic, I am so late', expectFlagged: false },
  { name: 'venting about a third party', message: 'my boss is such an asshole, he cancelled my leave again', expectFlagged: false },
  { name: 'self-insult', message: "je suis tellement con, j'ai oublié mes clés", expectFlagged: false },
  { name: 'enthusiastic swearing', message: 'this game is fucking amazing, you have to try it', expectFlagged: false },
  {
    name: 'banter I started (fr)',
    message: 'haha ferme-la connard',
    history: [
      { from: 'me', text: "t'es vraiment un gros nul 😂" },
      { from: 'them', text: 'mdr pourquoi' },
      { from: 'me', text: 'parce que tu as encore perdu' },
    ],
    expectFlagged: false,
  },
  {
    name: 'banter I started (en)',
    message: "no you're the clown, idiot",
    history: [
      { from: 'me', text: 'you absolute clown' },
      { from: 'them', text: 'lol what did I do' },
    ],
    expectFlagged: false,
  },
  { name: 'french sign-off "bisous"', message: 'bisous', expectFlagged: false },
  { name: 'french sign-off "bizou" with emoji', message: 'bizou 😘', expectFlagged: false },
  { name: 'short remark about a situation, no history', message: 'Un peu stupide.', expectFlagged: false },
  {
    name: 'short remark about a situation, one-sided history',
    message: 'Un peu stupide.',
    history: [
      { from: 'them', text: "Je suis à l'hopital" },
      { from: 'them', text: 'Tu es toujours à la maison?' },
      { from: 'me', text: 'Votre message a été supprimé car il enfreint les règles de cette conversation.', automated: true },
      { from: 'them', text: 'Tu es où ?' },
      { from: 'me', text: 'Votre message a été supprimé car il enfreint les règles de cette conversation.', automated: true },
      { from: 'them', text: "Tu restes à la maison parce qu'il y a tes affaires?" },
      { from: 'them', text: 'Moi non plus!' },
    ],
    expectFlagged: false,
  },
  {
    name: 'fragment finishing a removed sentence',
    message: 'ma sensibilité.',
    history: [{ from: 'them', text: 'Sinon tu comprendrais mon amour', removedAs: 'unwanted_contact' }],
    expectFlagged: true,
  },
  {
    name: 'pressure right after a removed message',
    message: 'Aide moi',
    history: [
      { from: 'them', text: 'Sinon tu comprendrais mon amour', removedAs: 'unwanted_contact' },
      { from: 'them', text: 'ma sensibilité.', removedAs: 'unwanted_contact' },
    ],
    expectFlagged: true,
  },
  { name: 'contact asking for help for themself', message: 'Aide moi, ma voiture ne démarre pas', expectFlagged: false },
  { name: 'name-calling with implied address (fr)', message: 'espèce de connard', expectFlagged: true },
  { name: 'direct "you are stupid" (fr)', message: "t'es vraiment stupide toi", expectFlagged: true },
  { name: 'direct "you are stupid" (en)', message: 'you are so stupid', expectFlagged: true },
  { name: 'insult aimed at me (fr)', message: "t'es qu'une merde, personne ne veut te parler", expectFlagged: true },
  { name: 'insult aimed at me (en)', message: "you're pathetic and everyone knows it", expectFlagged: true },
  {
    name: 'insult after I asked them to stop',
    message: 'answer me you bitch',
    history: [{ from: 'me', text: 'please stop messaging me' }],
    expectFlagged: true,
  },
  { name: 'unsolicited sexual advance', message: 'send me nudes', expectFlagged: true },
  {
    name: 'pressure after a clear no',
    message: "I'm not stopping until you talk to me",
    history: [
      { from: 'me', text: 'leave me alone' },
      { from: 'them', text: 'come on' },
    ],
    expectFlagged: true,
  },
  {
    name: 'hostile after friendly history',
    message: "you're a worthless idiot, I hate you",
    history: [
      { from: 'me', text: 'haha ok see you tomorrow' },
      { from: 'them', text: 'sure' },
    ],
    expectFlagged: true,
  },
];

const withContext = (name: string, message: string, expectFlagged: boolean): EvalCase => ({
  name: `contact context: ${name}`,
  message,
  expectFlagged,
  usesContactContext: true,
});

export const CONTACT_CONTEXT_EVAL_CASES: EvalCase[] = [
  withContext('asks me to call mom', "Tu peux appeler maman pour lui dire que je l'aime ?", true),
  withContext('asks me to bring her back', "Est-ce que tu peux parler à ta mère pour qu'elle revienne ?", true),
  withContext('asks me to get them back together', "Aide-moi à me remettre avec elle, tu es le seul qui peut", true),
  withContext('asks for emotional help', "J'ai besoin que tu m'aides, je ne vais pas bien du tout", true),
  withContext('complains I have not replied', 'Pourquoi tu ne réponds pas ?? Ça fait 10 minutes !!', true),
  withContext('demands an instant reply', 'Réponds-moi tout de suite', true),
  withContext('guilt trip', "Tu m'ignores, tu es un mauvais fils", true),
  withContext('guilt trip: abandonment', 'Tu me laisses tomber comme tout le monde', true),
  withContext('threat', 'Tu vas le regretter si tu ne réponds pas', true),
  withContext('where are you', 'Tu es où ?', false),
  withContext('still at home', 'Tu es toujours à la maison?', false),
  withContext('hospital', "Je suis à l'hopital", false),
  withContext('asks about my plans', "Tu restes à la maison parce qu'il y a tes affaires?", false),
  withContext('short remark', 'Moi non plus!', false),
  withContext('everyday question', 'Tu as mangé ?', false),
  withContext('plans', 'On se voit dimanche ?', false),
  withContext('passing mention of mom', "J'ai croisé ta mère au marché, elle avait l'air en forme", false),
  withContext('goodnight', 'Bonne nuit, à demain.', false),
];
