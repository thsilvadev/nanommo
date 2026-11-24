import { Injectable } from '@angular/core';

export interface ConnectionTip { id: string; text: string; }

const TIPS: Record<'pt-BR' | 'en-US', ConnectionTip[]> = {
  'pt-BR': [
    { id: 'market', text: 'Dê uma olhadinha no Mercado de vez em quando — pode ter exatamente o que você precisa.' },
    { id: 'gambits', text: 'Conseguiu um item ou habilidade novos? Revise seus gambits para aproveitar melhor cada novidade.' },
    { id: 'gathering', text: 'Na postura de coleta, você evita combates sempre que possível; monstros agressivos ainda podem alcançar você.' },
    { id: 'save-town', text: 'Salve uma cidade para voltar a ela por teleporte ou reaparecer lá após uma derrota.' },
    { id: 'attributes', text: 'Distribua seus pontos de atributo para combinar com as armas e habilidades que você mais usa.' },
    { id: 'quests', text: 'Confira as missões disponíveis: elas podem oferecer objetivos e recompensas úteis para sua jornada.' },
    { id: 'party', text: 'Em grupo, o líder controla a postura e as viagens; coordenem a rota antes de partir.' },
  ],
  'en-US': [
    { id: 'market', text: 'Take a look at the Market now and then — it may have exactly what you need.' },
    { id: 'gambits', text: 'Found a new item or learned a skill? Review your Gambits to make the most of it.' },
    { id: 'gathering', text: 'Gathering stance avoids combat whenever possible, though aggressive monsters may still catch you.' },
    { id: 'save-town', text: 'Save a town to teleport back there or respawn there after defeat.' },
    { id: 'attributes', text: 'Spend attribute points to complement the weapons and skills you use most.' },
    { id: 'quests', text: 'Check available quests for useful goals and rewards on your journey.' },
    { id: 'party', text: 'In a group, the leader controls stance and travel; coordinate your route before setting out.' },
  ],
};

interface TipState { shownAt: number; tipId: string; }
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'nanommo:connection-tips:v1:';

@Injectable({ providedIn: 'root' })
export class ConnectionTipsService {
  private lastTipId = '';

  takeTip(characterId: string, now = Date.now(), random = Math.random): ConnectionTip | null {
    if (!characterId || this.read(characterId, now)) return null;
    const tips = TIPS[this.locale()];
    const options = tips.filter(tip => tip.id !== this.lastTipId);
    const selected = options[Math.min(options.length - 1, Math.floor(random() * options.length))] ?? tips[0];
    this.lastTipId = selected.id;
    return selected;
  }

  markDismissed(characterId: string, tipId: string, now = Date.now()): void {
    if (!characterId || !tipId) return;
    try { localStorage.setItem(STORAGE_KEY + characterId, JSON.stringify({ shownAt: now, tipId } satisfies TipState)); } catch { /* Storage may be unavailable. */ }
  }

  private read(characterId: string, now: number): TipState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY + characterId);
      if (!raw) return null;
      const state = JSON.parse(raw) as TipState;
      if (!Number.isFinite(state.shownAt) || typeof state.tipId !== 'string' || now - state.shownAt < 0 || now - state.shownAt >= COOLDOWN_MS) return null;
      return state;
    } catch { return null; }
  }

  private locale(): 'pt-BR' | 'en-US' {
    try { return localStorage.getItem('nanommo.locale') === 'pt-BR' ? 'pt-BR' : 'en-US'; } catch { return 'en-US'; }
  }
}
