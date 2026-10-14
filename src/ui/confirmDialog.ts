import { el } from './Screen';

export interface ConfirmOptions {
  title: string;
  /** One paragraph per entry. */
  body: string[];
  confirm: string;
  /** The safe choice. Leave it out for a message with a single button. */
  cancel?: string;
  /** Something that cannot be undone: the confirm button is red. */
  danger?: boolean;
}

export interface AnswerOptions extends ConfirmOptions {
  /** The question for the answer box (its label). */
  question: string;
}

let serial = 0;

/**
 * A small modal question. Nothing happens until the confirm button is
 * pressed: the safe choice has the focus, and Escape or a tap outside the
 * box counts as "no". Focus stays inside while it is open and goes back to
 * where it was afterwards. Resolves true only for the confirm button.
 */
export function confirmDialog(parent: HTMLElement, options: ConfirmOptions): Promise<boolean> {
  return openDialog(parent, options, null).then((answer) => answer !== null);
}

/**
 * The same box with a short answer to type (the grown-up check): the answer
 * box has the focus, Enter confirms, and Escape, a tap outside or the
 * cancel button count as "no". Resolves with what was typed, or null.
 */
export function answerDialog(parent: HTMLElement, options: AnswerOptions): Promise<string | null> {
  return openDialog(parent, options, options.question);
}

function openDialog(parent: HTMLElement, options: ConfirmOptions, question: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = el('div', 'confirm');
    const box = el('div', 'confirm__box');
    const id = `confirm-${++serial}`;
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', `${id}-title`);
    box.setAttribute('aria-describedby', `${id}-body`);
    const title = el('h2', 'confirm__title', options.title);
    title.id = `${id}-title`;
    const body = el('div', 'confirm__body');
    body.id = `${id}-body`;
    for (const paragraph of options.body) body.appendChild(el('p', 'confirm__text', paragraph));
    box.append(title, body);

    let input: HTMLInputElement | null = null;
    if (question !== null) {
      const field = el('div', 'confirm__field');
      const label = el('label', 'confirm__label', question);
      label.htmlFor = `${id}-answer`;
      input = el('input', 'confirm__input');
      input.id = `${id}-answer`;
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.maxLength = 3;
      input.spellcheck = false;
      field.append(label, input);
      box.appendChild(field);
    }

    const actions = el('div', 'confirm__actions');
    const ok = el('button', `confirm__button ${options.danger ? 'confirm__button--danger' : 'confirm__button--primary'}`, options.confirm);
    ok.type = 'button';
    const cancel = options.cancel ? el('button', 'confirm__button', options.cancel) : null;
    if (cancel) {
      cancel.type = 'button';
      actions.appendChild(cancel);
    }
    actions.appendChild(ok);
    box.appendChild(actions);
    backdrop.appendChild(box);

    const focusable: HTMLElement[] = [...(input ? [input] : []), ...(cancel ? [cancel] : []), ok];
    const close = (answer: string | null) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      returnFocus?.focus();
      resolve(answer);
    };
    const confirm = () => close(input ? input.value : '');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      } else if (event.key === 'Enter' && input && document.activeElement === input) {
        event.preventDefault();
        confirm();
      } else if (event.key === 'Tab') {
        // Keep the focus on the dialog's own answer box and buttons.
        event.preventDefault();
        const at = focusable.indexOf(document.activeElement as HTMLElement);
        focusable[(at + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length].focus();
      }
    };
    ok.addEventListener('click', confirm);
    cancel?.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(null);
    });
    document.addEventListener('keydown', onKey, true);
    parent.appendChild(backdrop);
    // On a small screen the box scrolls: it opens at the top, so the explanation is read before the question.
    (input ?? cancel ?? ok).focus({ preventScroll: true });
    box.scrollTop = 0;
  });
}
