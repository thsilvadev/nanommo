import { Injectable, signal } from '@angular/core';

export type GameLocale = 'pt-BR' | 'en-US';

const TRANSLATIONS: Record<GameLocale, Record<string, string>> = {
  'pt-BR': {
    "Letters, parcels, and Market deliveries are waiting here.":"Cartas, encomendas e entregas do Mercado esperam aqui.","Sound":"Som","Gold":"Ouro","MDEF":"Defesa Mágica","Move Speed":"Velocidade de Movimento","Attack":"Ataque","Magic ATK":"Ataque Mágico","Cast Time Reduction":"Redução do Tempo de Conjuração","Accuracy":"Precisão","Critical Chance":"Chance Crítica","Attack Speed":"Velocidade de Ataque","Max HP":"HP Máximo","Max SP":"SP Máximo","Evasion":"Esquiva","Defense":"Defesa","atk":"Ataque","matk":"Ataque Mágico","mdefPercent":"Defesa Mágica","def":"Defesa","hp":"HP Máximo","sp":"SP Máximo","accuracy":"Precisão","criticalPercent":"Chance Crítica","atkSpeed":"Velocidade de Ataque","castTimeReduction":"Redução do Tempo de Conjuração","evasion":"Esquiva","defense":"Defesa","str":"FOR","agi":"AGI","dex":"DES","vit":"VIT","int":"INT","luk":"SOR","Ok I'll be back":"Já volto","[Handle items]":"[Entregar itens]","Thank you.":"Obrigado.","Language":"Idioma","Professions":"Profissões","Quests":"Missões","Gathering":"Coleta",
    "Active Quests":"Missões Ativas","Completed":"Concluídas","Rewards":"Recompensas","Character XP":"XP de Personagem",
    "Turn in":"Entregar","Abandon":"Abandonar","No completed quests.":"Nenhuma missão concluída.","Deadline:":"Prazo:","Given by":"Recebida de",
    "Português (Brasil)":"Português (Brasil)","English (US)":"Inglês (EUA)","Delete account":"Excluir conta",
    "Cooking":"Culinária","Level":"Nível","XP":"XP","Cancel":"Cancelar","Close":"Fechar",
    "Alchemy":"Alquimia","Blacksmith":"Ferreiro","Refinement":"Refinamento",
    "Brew a potion":"Preparar uma poção","I want to brew a potion":"Quero preparar uma poção","Craft equipment":"Fabricar equipamento","Refine equipment":"Refinar equipamento",
    "Available":"Disponível","Missing ingredients":"Faltam ingredientes","Not enough inventory space":"Espaço insuficiente no inventário",
    "Start crafting":"Começar fabricação","Craft":"Fabricar","Refine":"Refinar","Select equipment":"Selecionar equipamento",
    "Bliss Stone":"Pedra da Bem-Aventurança","Divine Shard":"Fragmento Divino","Use Divine Shard":"Usar Fragmento Divino",
    "Chance":"Chance","Failure effect":"Efeito da falha","Current refinement":"Refinamento atual","Next refinement":"Próximo refinamento",
    "Current stats":"Atributos atuais","Stat gain":"Ganho de atributo","Confirm refinement":"Confirmar refino","Confirm attempt":"Confirmar tentativa","Confirm refinement attempt?":"Confirmar tentativa de refino?","Refinement succeeded":"Refino concluído","Refinement failed":"Falha no refino","Equipment destroyed":"Equipamento destruído","Confirm":"Confirmar","The equipment and current refinement level will be preserved if this attempt fails.":"O equipamento e o nível de refino atual serão preservados se esta tentativa falhar.","The equipment will survive failure but lose one refinement level.":"O equipamento sobreviverá à falha, mas perderá um nível de refino.","Not enough Bliss Stones":"Pedras da Bem-Aventurança insuficientes",
    "Not enough Divine Shards":"Fragmentos Divinos insuficientes",
    "Another crafting session is already active. Return to the NPC who started it to cancel it":"Já há outra fabricação em andamento. Volte ao NPC que a iniciou para cancelá-la.","Equipment will be destroyed on failure":"O equipamento será destruído em caso de falha",
    "No failure at this chance":"Não há falha com esta chance",
    "The Bliss Stone is lost; equipment refinement stays unchanged":"A Pedra da Bem-Aventurança é perdida; o refino do equipamento permanece igual",
    "The Bliss Stone and Divine Shard are lost; refinement stays unchanged":"A Pedra da Bem-Aventurança e o Fragmento Divino são perdidos; o refino permanece igual",
    "The Bliss Stone is lost; refinement resets to +0":"A Pedra da Bem-Aventurança é perdida; o refino volta a +0",
    "The Bliss Stone and Divine Shard are lost; refinement decreases by one":"A Pedra da Bem-Aventurança e o Fragmento Divino são perdidos; o refino diminui em um nível",
    "The equipment is destroyed":"O equipamento é destruído",
    "Quest · Offer":"Missão · Oferta","Quest · Complete":"Missão · Concluída","Quest · In Progress":"Missão · Em andamento",
    "Talk":"Conversar","Continue":"Continuar","Offer the five tears":"Entregar as cinco lágrimas","I will help.":"Eu vou ajudar.",
    "Why do you need them?":"Por que você precisa delas?","Not now.":"Agora não.","I am going to help.":"Vou ajudar.",
    "The forest is growing weak. I need five of the ancient’s tears. Will you help?":"A floresta está enfraquecendo. Preciso de cinco lágrimas do ancião. Você me ajudará?",
    "The Flaming Treant is bound to the old forest. Its tears carry the memory of the land. Five will be enough.":"O Treant Flamejante está ligado à floresta ancestral. Suas lágrimas guardam a memória desta terra. Cinco serão suficientes.",
    "You honored the forest. Take these boots; may they guide you safely.":"Você honrou a floresta. Fique com estas botas; que elas guiem seus passos em segurança.",
    "I trade in useful remedies and supplies. Take what you need.":"Troco remédios e suprimentos úteis. Pegue o que precisar.",
    "Good steel, sound temper, precise work. What can I do for your equipment?":"Aço de qualidade, têmpera firme e trabalho preciso. Como posso ajudar seu equipamento?",
    "Aruandê, traveler. The forest has many gifts, and many stories still to tell.":"Aruandê, viajante. A floresta guarda muitos presentes e histórias.",
    "Aruandê, traveler. What brings you to Kwaiouá-Taba?":"Aruandê, viajante. O que traz você a Kwaiouá-Taba?",
    "I would like to brew a potion.":"Quero preparar uma poção.","I came to ask about the forest.":"Vim perguntar sobre a floresta.",
    "Nothing for now.":"Nada por enquanto","I'd like to cook":"Quero cozinhar","COOK":"COZINHAR","UNCLE PHILLIP'S KITCHEN":"COZINHA DO TIO PHILLIP",
    "monster drop":"item de monstro","deliver items":"entregar itens","kill monster":"derrotar monstro","objective":"objetivo"
  },
  'en-US': {}
};

@Injectable({ providedIn: 'root' })
export class LocaleService {
  readonly locale = signal<GameLocale>(this.readSavedLocale());

  private readSavedLocale(): GameLocale {
    try { return localStorage.getItem('nanommo.locale') === 'pt-BR' ? 'pt-BR' : 'en-US'; }
    catch { return 'en-US'; }
  }

  setLocale(locale: GameLocale): void {
    this.locale.set(locale);
    try { localStorage.setItem('nanommo.locale', locale); } catch { /* Storage may be disabled by browser policy. */ }
  }

  t(text: string | null | undefined): string {
    if (!text) return '';
    return TRANSLATIONS[this.locale()]?.[text] ?? text;
  }

  localized(record: any, field: string, fallback?: string): string {
    const locale = this.locale();
    const fieldValue = record?.[field];
    const value = fieldValue?.locales?.[locale]
      ?? record?.locales?.[locale]?.[field]
      ?? record?.[field + 'Locales']?.[locale]
      ?? (typeof fieldValue === 'string' ? fieldValue : undefined)
      ?? fallback
      ?? '';
    return typeof value === 'string' ? value : '';
  }
}
