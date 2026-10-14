import { Screen, el } from '../Screen';
import type { GameState } from '@/state/GameState';
import type { RealWorldScreen } from './RealWorldScreen';

/**
 * RealWorld Explorer's place in the UI. Its real screen, styles, landmark
 * content and 3D models are a separate download (see RealWorldHost), so this
 * shows a short "getting ready" card while they arrive and then hands over to
 * RealWorldScreen. If the download fails it says so plainly and offers to try
 * again or go back home: a child is never left on an empty screen.
 */
export class RealWorldLoaderScreen extends Screen {
  readonly id = 'realworld';

  private inner: RealWorldScreen | null = null;
  private loading: HTMLElement | null = null;
  private latest: GameState | null = null;
  private token = 0;

  protected build(): HTMLElement {
    // `display: contents`: the real screen lays out exactly as if it were mounted directly.
    const root = el('div', 'rw-host');
    this.loading = el('div', 'screen rw-loading');
    root.appendChild(this.loading);
    this.load();
    return root;
  }

  update(state: GameState): void {
    this.latest = state;
    this.inner?.update(state);
  }

  frame(): void {
    this.inner?.frame();
  }

  protected onUnmount(): void {
    this.token++;
    this.inner?.unmount();
    this.inner = null;
    this.loading = null;
  }

  private load(): void {
    const token = ++this.token;
    this.showMessage('Getting RealWorld Explorer ready...', false);
    Promise.all([this.context.realWorld.load(), import('./RealWorldScreen')]).then(
      ([scene, module]) => {
        if (token !== this.token || !this.root) return;
        this.loading?.remove();
        this.loading = null;
        const screen = new module.RealWorldScreen(this.context, scene);
        this.inner = screen;
        if (this.latest) screen.mount(this.root, this.latest);
      },
      () => {
        if (token !== this.token || !this.root) return;
        this.showMessage('RealWorld Explorer could not be loaded. Check the internet connection and try again.', true);
      },
    );
  }

  private showMessage(text: string, failed: boolean): void {
    const host = this.loading;
    if (!host) return;
    const card = el('div', `rw-loading__card${failed ? ' rw-loading__card--failed' : ''}`);
    card.setAttribute('role', failed ? 'alert' : 'status');
    if (!failed) card.appendChild(el('span', 'rw-loading__spinner'));
    card.appendChild(el('p', 'rw-loading__text', text));
    if (failed) {
      const actions = el('div', 'rw-loading__actions');
      const retry = el('button', 'rw-loading__button rw-loading__button--primary', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => this.load());
      const home = el('button', 'rw-loading__button', 'Back to Home');
      home.type = 'button';
      home.addEventListener('click', () => this.context.actions.exitRealWorld());
      actions.append(retry, home);
      card.appendChild(actions);
    }
    host.replaceChildren(card);
    if (failed) card.querySelector<HTMLButtonElement>('button')?.focus();
  }
}
