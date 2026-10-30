import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthStore } from '../../core/auth.store';
import { BattleStore, CharacterStore, InventoryStore } from '../../core/game.store';
import { CatalogService } from '../../core/catalog.service';
import { ApiService } from '../../core/api.service';
import { LoginMusicControlComponent } from '../../shared/login-music-control.component';
import { GameSocketService } from '../../core/game.socket.service';
import { LocaleService } from '../../core/locale.service';
import { GameAudioService } from '../../shared/game-audio.service';
import { LoginMusicService } from '../../shared/login-music.service';
import { BrowserNotificationsService } from '../../core/browser-notifications.service';
import { availableMasterySkillPoints, masteryLevelForXp } from '@nanommo/shared';
import { CharacterSummary, GrindInfo } from './components';
@Component({
    selector: 'app-play', standalone: true, imports: [CommonModule, RouterOutlet, CharacterSummary, GrindInfo, LoginMusicControlComponent],
    templateUrl: './play.component.html', styleUrl: './play.component.css'
})
export class PlayComponent implements OnInit, OnDestroy {
    readonly auth = inject(AuthStore); readonly character = inject(CharacterStore); private readonly battle = inject(BattleStore);
    private readonly inventory = inject(InventoryStore); private readonly catalog = inject(CatalogService); private readonly api = inject(ApiService); private readonly socket = inject(GameSocketService); readonly localeService = inject(LocaleService);
    private readonly router = inject(Router); readonly browserNotifications = inject(BrowserNotificationsService); private readonly gameAudio = inject(GameAudioService); private readonly loginMusic = inject(LoginMusicService); readonly gambitPages = signal<any[]>([]); readonly masteryRows = signal<any[]>([]); readonly gambitTitle = computed(() => { const id = this.character.character()?.activeGambitPageId; const page = this.gambitPages().find(p => p.id === id); return page?.title?.trim() || 'No Gambit Active' }); readonly hasMasteryPoints = computed(() => this.masteryRows().some((row: any) => availableMasterySkillPoints(masteryLevelForXp(Number(row?.xp ?? 0)), Number(row?.spentSkillPoints ?? 0)) > 0)); readonly hasAttributePoints = computed(() => Number(this.character.character()?.unspentAttributePoints ?? 0) > 0); readonly hasGambitDiscoveries = computed(() => { const known=new Set((this.character.character() as any)?.knownItemIds??[]); const newItems=this.catalog.items().some((item:any)=>known.has(item.id)&&item.type==='consumable'&&!String(item.id).startsWith('food_')&&!this.browserNotifications.hasAcknowledged('gambit:item:'+item.id)); const newSkills=this.catalog.skills().some((skill:any)=>skill.kind==='active'&&Number(this.masteryRows().find((row:any)=>row.weaponType===skill.category)?.skillRanks?.[skill.id]??0)>0&&!this.browserNotifications.hasAcknowledged('gambit:skill:'+skill.id)); return newItems||newSkills; }); readonly activeGambitEquipmentWarning = computed(() => { const id=this.character.character()?.activeGambitPageId; const page=this.gambitPages().find(p=>p.id===id); if(!page)return false; const ranks=new Map(this.masteryRows().map(row=>[row.weaponType,row.skillRanks??{}])); const equipped=new Set(this.inventory.equipment().map(row=>this.catalog.item(row.itemId)?.weaponType).filter(Boolean)); return (page.lines??[]).some((line:any)=>{ if(line?.action?.id!=='use_skill')return false; const skillId=line.action.params?.skillId??line.action.skillId; const skill=this.catalog.skills().find((row:any)=>row.id===skillId); if(!skill||skill.kind!=='active'||Number((ranks.get(skill.category) as any)?.[skill.id]??0)<1)return false; return !equipped.has(String(skill.requiresWeaponEquipped??skill.category)); }); }); readonly settingsOpen = signal(false); readonly deleteAccountOpen = signal(false); readonly deleteConfirm = signal(''); readonly deleteAccountError = signal<string | null>(null);
    ngOnInit() { void this.loginMusic.fadeOut(500); void this.browserNotifications.syncExistingSubscription(); this.socket.connect(); this.battle.bindEvents(this.character, this.inventory); this.gameAudio.start(this.character, this.battle, this.inventory); void Promise.all([this.character.load(), this.inventory.load(), this.battle.load(), this.catalog.load()]).then(() => this.loadActiveGambitTitle()); }
    ngOnDestroy() { this.gameAudio.destroy(); }
    async loadActiveGambitTitle() { try { const [pages, mastery] = await Promise.all([this.api.get<any[]>('/gambits').toPromise(), this.api.get<any[]>('/characters/weapon-proficiency').toPromise()]); this.gambitPages.set(pages ?? []); this.masteryRows.set(mastery ?? []) } catch { this.gambitPages.set([]); this.masteryRows.set([]) } }
    go(path: string) { void this.router.navigateByUrl(path) } goCharacter() { void this.router.navigate(['/play/character'], { queryParams: { tab: 'character' } }) } is(path: string) { return this.router.url.split('?')[0] === path }
    xpWidth() { const c = this.character.character(); return c?.xpToNext ? Math.max(0, Math.min(100, c.xp / c.xpToNext * 100)) : 0 }
    xpTitle() { const c = this.character.character(); return c ? `XP ${c.xp} / ${c.xpToNext}` : 'XP' }
    activeGambitTitle() { return this.gambitTitle() } openUnavailableGambits(event: MouseEvent) { event.stopPropagation(); void this.router.navigate(['/play/character'], { queryParams: { tab: 'gambits' } }); }
    enableBrowserNotifications() { void this.browserNotifications.enable(); }
    changeLocale(locale: 'pt-BR' | 'en-US') { this.localeService.setLocale(locale); void this.browserNotifications.syncExistingSubscription(); }
    openDeleteAccount() { this.settingsOpen.set(false); this.deleteConfirm.set(''); this.deleteAccountError.set(null); this.deleteAccountOpen.set(true) }
    cancelDeleteAccount() { this.deleteAccountOpen.set(false); this.deleteConfirm.set(''); this.deleteAccountError.set(null) }
    confirmDeleteAccount() { if (this.deleteConfirm() !== 'DELETE') return; this.deleteAccountError.set(null); this.auth.deleteAccount().subscribe({ next: () => { this.cancelDeleteAccount(); this.auth.logout() }, error: (err) => this.deleteAccountError.set(err.error?.message || 'Unable to delete account') }) }
}
