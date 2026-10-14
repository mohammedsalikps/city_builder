/**
 * A grown-up check in front of a setting a child should not change alone:
 * a multiplication to type (6 x 6 up to 9 x 9). It slows a young child down;
 * it does not prove who is answering, and it is not parental consent.
 * A wrong answer ends the attempt (the next one asks something new), so it
 * cannot be passed by trying number after number in one go.
 */
export interface GrownUpQuestion {
  /** Read out and shown, e.g. "What is 7 × 8?" */
  text: string;
  answer: number;
}

export function grownUpQuestion(random: () => number = Math.random): GrownUpQuestion {
  const pick = () => 6 + Math.min(3, Math.floor(random() * 4));
  const a = pick();
  const b = pick();
  return { text: `What is ${a} × ${b}?`, answer: a * b };
}

/** Whether what was typed is the answer (spaces ignored; digits only). */
export function isGrownUpAnswer(question: GrownUpQuestion, typed: string | null): boolean {
  if (typed === null) return false;
  const digits = typed.trim();
  return /^\d{1,3}$/.test(digits) && Number(digits) === question.answer;
}
