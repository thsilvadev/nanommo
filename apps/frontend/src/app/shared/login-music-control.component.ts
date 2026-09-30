import { Component, inject, Input, OnInit } from '@angular/core';
import { LoginMusicService } from './login-music.service';

@Component({
  selector: 'app-login-music-control',
  standalone: true,
  template: `
    <div class="music-control" [class.auth-control]="variant==='auth'" [class.header-control]="variant==='header'">
      <button type="button" class="music-button" (click)="music.toggleMute()" [attr.aria-label]="music.muted() ? 'Ativar música' : 'Silenciar música'" [title]="music.muted() ? 'Ativar música' : 'Silenciar música'">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm11.5-1.5a1 1 0 0 0-1.4 1.4 4 4 0 0 1 0 5.2 1 1 0 1 0 1.4 1.4 6 6 0 0 0 0-8zm2.8-2.8a1 1 0 1 0-1.4 1.4 8 8 0 0 1 0 11.8 1 1 0 1 0 1.4 1.4 10 10 0 0 0 0-14.6z"/></svg>
      </button>
      <input class="music-slider" type="range" min="0" max="1" step="0.01" [value]="music.volume()" (input)="setVolume($any($event.target).value)" aria-label="Volume da música" />
    </div>
  `,
  styles: [`
    .music-control{display:flex;align-items:center;gap:7px}.music-button{width:25px;height:25px;display:grid;place-items:center;padding:0;border:1px solid #8d6738;border-radius:3px;background:rgba(18,11,7,.38);color:#f0d08b;cursor:pointer}.music-button:hover{background:rgba(164,112,47,.28);color:#ffe3a5}.music-button svg{width:14px;height:14px;fill:currentColor}.music-slider{width:88px;height:3px;accent-color:#d3a14f;cursor:pointer}.auth-control{position:fixed;right:22px;bottom:20px;z-index:20;padding:7px 9px;border:1px solid rgba(193,148,78,.7);border-radius:4px;background:rgba(12,8,5,.32);backdrop-filter:blur(2px);box-shadow:0 3px 14px rgba(0,0,0,.28)}.header-control{margin-left:2px}.header-control .music-button{border-color:#624728;background:transparent}.header-control .music-slider{width:70px}@media(max-width:599px){.auth-control{right:12px;bottom:12px}.auth-control .music-slider{width:72px}.header-control .music-slider{width:52px}}
  `],
})
export class LoginMusicControlComponent implements OnInit {
  @Input() variant: 'auth' | 'header' = 'auth';
  readonly music = inject(LoginMusicService);

  ngOnInit(): void {
    if (this.variant === 'auth') this.music.start();
  }

  setVolume(value: string): void {
    this.music.setVolume(Number(value));
  }
}
