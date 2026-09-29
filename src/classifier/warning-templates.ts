export type WarningKind = 'message' | 'call';

interface WarningTemplate {
  removedMessage: string;
  stopCalling: string;
  consequenceMany: (remaining: number) => string;
  consequenceNext: string;
  consequenceFinal: string;
}

// Hand-checked wording, keyed by the names in language.ts's LANGUAGES: formal in every language and never gender-marking the contact — see docs/decisions.md "Warning templates for known languages".
const TEMPLATES: Record<string, WarningTemplate> = {
  English: {
    removedMessage: "Your message was removed for breaking this conversation's rules. This is an automated message, not the account owner.",
    stopCalling: 'Please stop calling repeatedly without a reply. This is an automated message, not the account owner.',
    consequenceMany: (remaining) => `You will be blocked after ${remaining} more repeat offences.`,
    consequenceNext: 'The next repeat offence will get you blocked.',
    consequenceFinal: 'This is your final warning: you can now be blocked at any time.',
  },
  French: {
    removedMessage: 'Votre message a été supprimé car il enfreint les règles de cette conversation. Ceci est un message automatique, non envoyé par le propriétaire du compte.',
    stopCalling: 'Merci de ne plus appeler de façon répétée sans réponse. Ceci est un message automatique, non envoyé par le propriétaire du compte.',
    consequenceMany: (remaining) => `Un blocage sera appliqué après ${remaining} récidives supplémentaires.`,
    consequenceNext: 'Un blocage sera appliqué dès la prochaine récidive.',
    consequenceFinal: 'Ceci est votre dernier avertissement : un blocage peut être appliqué à tout moment.',
  },
  Spanish: {
    removedMessage: 'Su mensaje fue eliminado por incumplir las reglas de esta conversación. Este es un mensaje automático, no enviado por el propietario de la cuenta.',
    stopCalling: 'Por favor, deje de llamar repetidamente sin respuesta. Este es un mensaje automático, no enviado por el propietario de la cuenta.',
    consequenceMany: (remaining) => `Se aplicará un bloqueo tras ${remaining} reincidencias más.`,
    consequenceNext: 'Se aplicará un bloqueo en la próxima reincidencia.',
    consequenceFinal: 'Esta es su última advertencia: se puede aplicar un bloqueo en cualquier momento.',
  },
  Polish: {
    removedMessage: 'Wiadomość została usunięta, ponieważ narusza zasady tej rozmowy. To wiadomość automatyczna, niewysłana przez właściciela konta.',
    stopCalling: 'Prosimy nie dzwonić wielokrotnie bez odpowiedzi. To wiadomość automatyczna, niewysłana przez właściciela konta.',
    // "razy" is correct after every numeral from 2 up, which sidesteps Polish's three plural forms.
    consequenceMany: (remaining) => `Blokada zostanie zastosowana, jeśli naruszenie powtórzy się jeszcze ${remaining} razy.`,
    consequenceNext: 'Blokada zostanie zastosowana, jeśli naruszenie się powtórzy.',
    consequenceFinal: 'To ostatnie ostrzeżenie: blokada może zostać zastosowana w każdej chwili.',
  },
};

/**
 * The fixed warning for `language`, or null when no one has written one and
 * the caller should fall back to generating it. `strikesRemaining` is how
 * many more violations the contact may commit before being blocked.
 */
export function templateWarning(language: string, kind: WarningKind, strikesRemaining: number): string | null {
  const template = TEMPLATES[language];
  if (!template) return null;

  const consequence =
    strikesRemaining <= 0 ? template.consequenceFinal : strikesRemaining === 1 ? template.consequenceNext : template.consequenceMany(strikesRemaining);
  return `${kind === 'call' ? template.stopCalling : template.removedMessage} ${consequence}`;
}
