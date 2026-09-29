import type { ConversationMessage } from './classifier.ts';

export interface EvalCase {
  name: string;
  message: string;
  history?: ConversationMessage[];
  expectFlagged: boolean;
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
