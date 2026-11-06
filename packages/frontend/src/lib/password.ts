export const PASSWORD_MIN_LENGTH = 10;

export interface Strength {
  // 0 = too short, 1 = weak, 2 = fair, 3 = strong
  level: 0 | 1 | 2 | 3;
  label: string;
  hint: string;
}

// A hint for the person typing; the server only enforces the minimum length and a few distinct characters.
export function passwordStrength(password: string): Strength {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { level: 0, label: 'Zu kurz', hint: `Mindestens ${PASSWORD_MIN_LENGTH} Zeichen (noch ${PASSWORD_MIN_LENGTH - password.length}).` };
  }
  const classes = [/[a-zäöüß]/, /[A-ZÄÖÜ]/, /\d/, /[^A-Za-z0-9äöüßÄÖÜ]/].filter((pattern) => pattern.test(password)).length;
  const distinct = new Set(password).size;
  if (distinct < 5 || (classes === 1 && password.length < 14)) {
    return { level: 1, label: 'Schwach', hint: 'Besser: mehrere Wörter, Ziffern oder Sonderzeichen mischen und länger wählen.' };
  }
  if (password.length >= 20 || (password.length >= 14 && classes >= 3)) {
    return { level: 3, label: 'Stark', hint: 'Gute Wahl.' };
  }
  return { level: 2, label: 'Mittel', hint: 'Mit 14 oder mehr Zeichen und gemischten Zeichen wird es stark.' };
}
