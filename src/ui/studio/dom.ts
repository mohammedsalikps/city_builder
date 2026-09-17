import { el } from '../Screen';
import { icon } from './icons';

/** A round, labelled World Studio button: icon on top, one short word beneath. */
export function actionButton(iconName: string, label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
  const button = el('button', `st-action ${extraClass}`.trim());
  button.type = 'button';
  const face = el('span', 'st-action__face');
  face.appendChild(icon(iconName));
  button.appendChild(face);
  button.appendChild(el('span', 'st-action__label', label));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/** A pill button with an icon and a label side by side. */
export function pillButton(iconName: string, label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
  const button = el('button', `st-pill ${extraClass}`.trim());
  button.type = 'button';
  button.appendChild(icon(iconName));
  button.appendChild(el('span', 'st-pill__label', label));
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/** An image slot that fills in when its 3D thumbnail is ready (with a soft shimmer until then). */
export function thumbnail(source: Promise<string>, className = 'st-thumb'): HTMLElement {
  const frame = el('span', `${className} st-thumb--loading`);
  const image = document.createElement('img');
  image.alt = '';
  image.decoding = 'async';
  frame.appendChild(image);
  void source.then((url) => {
    if (!url) return;
    image.src = url;
    frame.classList.remove('st-thumb--loading');
  });
  return frame;
}

/** Show or hide with the CSS enter/leave transition (`st-hidden` toggles display after fading). */
export function setShown(element: HTMLElement, shown: boolean): void {
  if (shown) {
    if (element.hidden) {
      element.hidden = false;
      // Force a frame so the entry transition runs from the hidden style.
      void element.offsetWidth;
    }
    element.classList.add('st-shown');
  } else {
    element.classList.remove('st-shown');
    element.hidden = true;
  }
}
