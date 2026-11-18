export interface CraftTooltipLine { label: string; value: string; warning?: boolean }
export interface CraftTooltipContext { portuguese?: boolean; description?: string; stats?: CraftTooltipLine[]; statusName?: (id: string) => string }

/** Deliberate player-facing fields only. Never serialize arbitrary catalogue metadata. */
export function craftItemTooltipLines(item: any, context: CraftTooltipContext = {}): CraftTooltipLine[] {
  if (!item) return [];
  const t=(en:string,pt:string)=>context.portuguese?pt:en;
  const rows:CraftTooltipLine[]=[];
  const add=(en:string,pt:string,value:string)=>{if(value)rows.push({label:t(en,pt),value});};
  const names:Record<string,string>={sword:t('Sword','Espada'),greatsword:t('Greatsword','Espada de duas mãos'),dagger:t('Dagger','Adaga'),bow:t('Bow','Arco'),staff:t('Staff','Cajado'),rod:t('Rod','Bastão'),shield:t('Shield','Escudo'),rune:t('Rune','Runa'),head:t('Headgear','Elmo'),cape:t('Cape','Capa'),body:t('Body armor','Armadura'),feet:t('Footwear','Botas'),accessory:t('Accessory','Acessório')};
  const e=item.effect??{};
  const isSuper=item.alchemyCategory==='super_tonics'||['revive_full_cleanse','revive_ally'].includes(e.type);
  const isPotion=item.alchemyCategory==='potions'||['heal_hp','heal_sp','heal_hp_sp','cure_status'].includes(e.type);
  const isTonic=item.alchemyCategory==='tonics'||e.type==='apply_status';
  const type=item.type==='equipment'?names[item.weaponType]??names[item.slot]??t('Equipment','Equipamento'):item.type==='food'?t('Food','Alimento'):isSuper?t('Super Tonic','Super Tônico'):isPotion?t('Potion','Poção'):isTonic?t('Tonic','Tônico'):item.type==='monster_part'?t('Monster material','Material de monstro'):t('Crafting material','Material de fabricação');
  add('Type','Tipo',type);
  const description=e.type==='food_buff'?t('A prepared food that restores HP and SP over time while it is being digested.','Um alimento preparado que regenera HP e SP ao longo da digestão.'):context.description??item.description;
  if(typeof description==='string'&&description)rows.push({label:'',value:description});
  if(item.type==='equipment') {
    if(item.levelReq!=null)add('Required level','Nível necessário',String(item.levelReq));
    if(item.tier!=null)add('Equipment tier','Categoria do equipamento',String(item.tier));
    if(item.slot==='mainHand')add('Handling','Empunhadura',item.twoHanded?t('Two-handed weapon','Arma de duas mãos'):t('One-handed weapon','Arma de uma mão'));
    rows.push(...context.stats??[]);
    if(item.secondaryHand)add('Off hand','Mão secundária',t('Can also be equipped in your off hand.','Também pode ser equipado na mão secundária.'));
    const offhands=(item.allowedOffHandTypes??[]).map((id:string)=>names[id]).filter(Boolean);
    if(offhands.length)add('Compatible off hand','Mão secundária compatível',offhands.join(', '));
    const roll=item.randomRollOnCraft;
    if(roll?.enabled) {
      const attributes:Record<string,string>={STR:t('Strength','Força'),AGI:t('Agility','Agilidade'),DEX:t('Dexterity','Destreza'),VIT:t('Vitality','Vitalidade'),INT:t('Intelligence','Inteligência'),LUK:t('Luck','Sorte')};
      const pool=(roll.attributesPool??[]).map((id:string)=>attributes[id]).filter(Boolean);
      if(pool.length)add('Crafted bonus','Bônus de fabricação',t(`Gains one random attribute bonus of +${roll.min} to +${roll.max}: ${pool.join(', ')}.`,`Recebe um bônus aleatório de +${roll.min} a +${roll.max} em um atributo: ${pool.join(', ')}.`));
    }
    if(item.weaponType==='bow')rows.push({label:'',value:t('Bows reduce accuracy by 50%.','Arcos reduzem a precisão em 50%.'),warning:true});
  } else {
    const effects:string[]=[];
    if(e.type==='heal_hp')effects.push(t(`Restores ${e.amount} HP.`,`Restaura ${e.amount} HP.`));
    if(e.type==='heal_sp')effects.push(t(`Restores ${e.amount} SP.`,`Restaura ${e.amount} SP.`));
    if(e.type==='heal_hp_sp')effects.push(t(`Restores ${e.hpAmount} HP and ${e.spAmount} SP.`,`Restaura ${e.hpAmount} HP e ${e.spAmount} SP.`));
    if(e.type==='cure_status') {
      const known:Record<string,string>={poison:t('Poison','Veneno'),bleed:t('Bleeding','Sangramento'),freeze:t('Freeze','Congelamento'),stun:t('Stun','Atordoamento')};
      const status=known[e.status]??(context.statusName?.(e.status)||t('the harmful effect','o efeito negativo'));
      effects.push(t(`Removes ${status}.`,`Remove ${status}.`));
    }
    if(e.type==='revive_full_cleanse')effects.push(t('When your Upon Death Gambit activates, revives you with full HP and SP and removes all buffs and debuffs.','Quando seu Gambit Ao Morrer é ativado, revive você com HP e SP completos e remove todos os efeitos positivos e negativos.'));
    if(e.type==='revive_ally')effects.push(t(`Revives a knocked-out ally with ${e.hpPercent??50}% HP and ${e.spPercent??50}% SP, preserving their other effects.`,`Revive um aliado nocauteado com ${e.hpPercent??50}% de HP e ${e.spPercent??50}% de SP, preservando os demais efeitos.`));
    if(e.type==='apply_status') {
      if(e.defBonus)effects.push(t(`Increases Defense by ${e.defBonus}.`,`Aumenta a Defesa em ${e.defBonus}.`));
      if(e.mdefPercentBonus)effects.push(t(`Increases Magic Defense by ${e.mdefPercentBonus} percentage points.`,`Aumenta a Defesa Mágica em ${e.mdefPercentBonus} pontos percentuais.`));
      if(e.attackSpeedMultiplier)effects.push(t(`Multiplies Attack Speed by ${e.attackSpeedMultiplier}.`,`Multiplica a Velocidade de Ataque por ${e.attackSpeedMultiplier}.`));
      if(e.castTimeReductionMultiplier)effects.push(t(`Multiplies Cast Time Reduction by ${e.castTimeReductionMultiplier}.`,`Multiplica a Redução do Tempo de Conjuração por ${e.castTimeReductionMultiplier}.`));
    }
    if(e.type==='food_buff') {
      add('Base regeneration','Regeneração base',t(`${Number(e.hpRegenPerTenTicks??0)} HP and ${Number(e.spRegenPerTenTicks??0)} SP every 10 seconds.`,`${Number(e.hpRegenPerTenTicks??0)} HP e ${Number(e.spRegenPerTenTicks??0)} SP a cada 10 segundos.`));
    }
    if(effects.length)add('Effect','Efeito',effects.join(' '));
    if(Number(e.durationSeconds)>0)add(e.type==='food_buff'?'Digestion':'Duration',e.type==='food_buff'?'Digestão':'Duração',e.type==='food_buff'&&e.durationSeconds>=60?t(`${e.durationSeconds/60} minutes`,`${e.durationSeconds/60} minutos`):t(`${e.durationSeconds} seconds`,`${e.durationSeconds} segundos`));
    const cooldown=Number(item.cooldownInSeconds??item.cooldownSeconds??0);
    if(cooldown>0) {
      const group=isSuper?t('Super Tonics','Super Tônicos'):isPotion?t('Potions','Poções'):isTonic?t('Tonics','Tônicos'):'';
      add('Shared cooldown','Cooldown compartilhado',group?t(`${cooldown} seconds; shared by all ${group}.`,`${cooldown} segundos; compartilhado entre itens da categoria ${group}.`):t(`${cooldown} seconds.`,`${cooldown} segundos.`));
    }
    const usage:Record<string,string>={blacksmithing:t('Blacksmith crafting','Fabricação no Ferreiro'),alchemy:t('Alchemy recipes','Receitas de Alquimia'),equipment_refinement:t('Equipment refinement','Refinamento de equipamentos'),quest_objective:t('Quest objectives','Objetivos de missões'),quest_turn_in:t('Quest deliveries','Entregas de missões'),market_trade:t('Player trading','Comércio entre jogadores')};
    const uses=(item.usableFor??[]).map((id:string)=>usage[id]).filter(Boolean);
    if(uses.length)add('Used for','Utilizado em',uses.join(', '));
    if(Number(item.maxStack)>1)add('Stack limit','Limite por pilha',String(item.maxStack));
  }
  return rows;
}
