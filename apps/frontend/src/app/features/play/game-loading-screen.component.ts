import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { LocaleService } from '../../core/locale.service';

/** Full-screen "Loading…" with a progress bar, shown until the 3D assets are ready. */
@Component({
  selector: 'app-game-loading-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="loading-screen" role="status" aria-live="polite">
      <img class="logo" src="/assets/lords-transparent.png" alt="Lords">
      <p>{{ locale.t('Loading…') }}</p>
      <div class="bar"><div class="fill" [style.width.%]="progress() * 100"></div></div>
    </div>
  `,
  styles: [`
    .loading-screen { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #15110e; color: #e9dcc6; font-size: 1.1rem; }
    .logo { width: min(280px, 60vw); }
    .bar { width: min(360px, 70vw); height: 8px; border-radius: 4px; background: #2e2620; overflow: hidden; }
    .fill { height: 100%; background: linear-gradient(90deg, #b8862b, #f0c75e); transition: width 0.2s ease-out; }
  `],
})
export class GameLoadingScreenComponent {
  readonly progress = input(0);
  readonly locale = inject(LocaleService);
}
