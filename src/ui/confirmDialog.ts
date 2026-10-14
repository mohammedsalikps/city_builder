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

let serial = 0;

/**
 * A small modal question. Nothing happens until the confirm button is
 * pressed: the safe choice has the focus, and Escape or a tap outside the
 * box counts as "no". Focus stays inside while it is open and goes back to
 * where it was afterwards. Resolves true only for the confirm button.
 */
export function confirmDialog(parent: HTMLElement, options: ConfirmOptions): Promise<boolean> {
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
    const actions = el('div', 'confirm__actions');
    const ok = el('button', `confirm__button ${options.danger ? 'confirm__button--danger' : 'confirm__button--primary'}`, options.confirm);
    ok.type = 'button';
    const cancel = options.cancel ? el('button', 'confirm__button', options.cancel) : null;
    if (cancel) {
      cancel.type = 'button';
      actions.appendChild(cancel);
    }
    actions.appendChild(ok);
    box.append(title, body, actions);
    backdrop.appendChild(box);

    const buttons = cancel ? [cancel, ok] : [ok];
    const close = (answer: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      returnFocus?.focus();
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      } else if (event.key === 'Tab') {
        // Keep the focus on the dialog's own buttons.
        event.preventDefault();
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(at + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
      }
    };
    ok.addEventListener('click', () => close(true));
    cancel?.addEventListener('click', () => close(false));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKey, true);
    parent.appendChild(backdrop);
    (cancel ?? ok).focus();
  });
}
