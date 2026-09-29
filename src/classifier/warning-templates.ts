export type WarningKind = 'message' | 'call';

interface WarningTemplate {
  removedMessage: string;
  stopCalling: string;
  consequenceMany: (remaining: number) => string;
  consequenceNext: string;
  consequenceFinal: string;
}

// Keyed by the names in language.ts's LANGUAGES. Each language is wording someone who reads it has checked: a small model's grammar in these languages was not good enough to send (see docs/decisions.md), so adding one means writing these five strings, nothing else.
const TEMPLATES: Record<string, WarningTemplate> = {
  English: {
    removedMessage: "Your message was removed for breaking this conversation's rules. This is an automated message, not the account owner.",
    stopCalling: 'Please stop calling repeatedly without a reply. This is an automated message, not the account owner.',
    consequenceMany: (remaining) => `You will be blocked after ${remaining} more repeat offences.`,
    consequenceNext: 'The next repeat offence will get you blocked.',
    consequenceFinal: 'This is your final warning: you can now be blocked at any time.',
  },
  French: {
    removedMessage: 'Votre message a été supprimé car il enfreint les règles de cette conversation. Ceci est un message automatique, pas du propriétaire du compte.',
    stopCalling: 'Merci de ne plus appeler de façon répétée sans réponse. Ceci est un message automatique, pas du propriétaire du compte.',
    consequenceMany: (remaining) => `Après ${remaining} récidives supplémentaires, vous serez bloqué.`,
    consequenceNext: 'À la prochaine récidive, vous serez bloqué.',
    consequenceFinal: 'Ceci est votre dernier avertissement : vous pouvez être bloqué à tout moment.',
  },
  Spanish: {
    removedMessage: 'Tu mensaje fue eliminado por incumplir las reglas de esta conversación. Este es un mensaje automático, no del propietario de la cuenta.',
    stopCalling: 'Por favor, deja de llamar repetidamente sin respuesta. Este es un mensaje automático, no del propietario de la cuenta.',
    consequenceMany: (remaining) => `Serás bloqueado tras ${remaining} reincidencias más.`,
    consequenceNext: 'La próxima reincidencia supondrá tu bloqueo.',
    consequenceFinal: 'Esta es tu última advertencia: puedes ser bloqueado en cualquier momento.',
  },
  Polish: {
    removedMessage: 'Twoja wiadomość została usunięta, ponieważ łamie zasady tej rozmowy. To wiadomość automatyczna, nie od właściciela konta.',
    stopCalling: 'Przestań dzwonić wielokrotnie bez odpowiedzi. To wiadomość automatyczna, nie od właściciela konta.',
    // "razy" is correct after every numeral from 2 up, which sidesteps Polish's three plural forms.
    consequenceMany: (remaining) => `Zostaniesz zablokowany, jeśli powtórzy się to jeszcze ${remaining} razy.`,
    consequenceNext: 'Jeśli to się powtórzy, zostaniesz zablokowany.',
    consequenceFinal: 'To ostatnie ostrzeżenie: możesz zostać zablokowany w każdej chwili.',
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
