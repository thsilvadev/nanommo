# Animações dos monstros 3D

Movimentos de batalha (mesmos nomes do personagem): **Idle** (parado em combate), **Attack**
(ataque básico), **Damage** (recebe dano), **Dead** (morte, termina deitado/afundado), **Cast** (habilidade).
Fonte da verdade do mapeamento: `monsters.config.mjs`; o manifesto gerado lista os clipes de cada GLB.

Regra para o que falta (decisão do usuário: usar idle ou a mais viável):
- **Damage faltando** → 🔧 o build gera um *recuo* no nó raiz (tranco para trás, 0,4 s).
- **Dead faltando** → 🔧 *tombar e afundar* no nó raiz (1,4 s).
- **Attack faltando** → 🔧 *investida* para a frente (0,7 s).
- **Cast faltando** → ↪ cópia do Attack.

Legenda: ✅ do modelo · 🔧 gerado · ↪ substituto · 🗃 extra guardado (fica no GLB com esse nome).

## Native (rig próprio)

| Monstro (modelo) | Idle | Attack | Damage | Dead | Cast | 🗃 Extras | Não usados |
|---|---|---|---|---|---|---|---|
| slime (Slime) | ✅ Idle | ✅ Attack1 | ✅ Damage | ✅ Death | ↪ Pulse | | Attack2, Walk |
| fieldbat (giant bat) | ✅ 2legsIdle | ✅ 2legsWingAttackR | 🔧 | ✅ 2legsDeath | ↪ 2legsRoar | | 2legsWalk, WingAttackL |
| mutantbee (Bee) | ✅ _bee_hover | 🔧 | 🔧 | 🔧 | ↪ Attack | | _bee_idle (pousada), take_off_and_land |
| thornsprout (Carnivorous Plant) | ✅ Idle | ✅ Bite | 🔧 | ✅ Dying | ↪ Spit | | Idle2 |
| mudcrawler (Frost Predator) | ✅ rig\|Idle | ✅ rig\|attack | 🔧 | 🔧 | ↪ rig\|Roar | PowerAttack | walk, Run, Sleeping; morphs removidos |
| direwolf (Magic Wolf) | ✅ Idle | ✅ claw attack | ✅ damage | 🔧 | ↪ flame thrower | | stunned, run, trot, walk |
| gravelhorn (Ankylosaurus) | ✅ idle | ✅ attack1 | 🔧 | ✅ die | ↪ attack2 | | walk, run |
| mudflatcrocodile | ✅ idle | ✅ attack | ✅ hit | ✅ Death | ↪ Attack01 | | walk |
| sandscorpion | ✅ idle | ✅ doubleClawsAttack | ✅ buff1 | ✅ death | ↪ stingerAttack | | claws L/R, jump, fall, buff2, walk |
| ridgebreaker (Grux) | ✅ Idle | ✅ PrimaryAttack_RA | ✅ HitReact_Front | ✅ Death_B | ↪ PrimaryAttack_LA | | Run |
| saltfangcrab | ✅ idle | ✅ ClawAttackLeft | 🔧 | ✅ death | ↪ clawAttackRight | | walkRight |
| needlebackstalker (Chimera) | ✅ 4legsIdle | ✅ 4legsClawsAttackR | ✅ 4legsGetHit | ✅ 4legsDeath | ↪ 4legsHorntAttack | Bite (4legsSnakeBiteAttack) | variantes 2Legs, walk, run |
| giantspider | ✅ idle | ✅ attack | 🔧 | ✅ die | ↪ Attack | | walks, run |
| duneraider (Tusken Raider) | ✅ alert_weightshift | ✅ gaderffi_lunge | ✅ rct_stumbleb | ✅ rct_splatb | ↪ larm_throw_upper | | ~45 clipes de cobertura/patrulha |
| venomviper (Cobra) | ✅ Idle | ✅ Bite | 🔧 | ✅ Killed | ↪ Attack2 | | Attack, CircleBite, GetUp, Steady, IdleLoop |
| giantmosquito | ✅ hover | ✅ attack | 🔧 | ✅ death1 | ↪ Attack | | fly, landing, walk, idle (pousado), death2 |
| rootboundbrute (Troll) | ✅ idle | ✅ attack1 | ✅ take_damage | ✅ death | ↪ attack2 | | idle_break, walk, run |
| unicorn (Horse Rigged) | ✅ trecho 0–4 s | ✅ empinar 33,2–35,4 s | 🔧 | ✅ queda 38,8–40,2 s | ↪ Attack | | resto do take de 60 s (andar, trote, levantar) |
| giantmantis | ✅ mantis_idle | ✅ mantis_attack | ✅ mantis_gothit | ✅ mantis_death | ↪ Attack | | run, walk |
| mirageStalker (Camouflaged-leopard) | ✅ Idle | ✅ Attack | ↪ Growl | ✅ Death | ↪ PounceSwipe | **Bite** (skill futura) | Die, DieLoop, JumpUp, Pounce, Graze, Sick, Run, Walk |
| arcanewisp (Stonewisp) | ✅ Idle | ↪ Intimidate | ↪ Brace_Enter | ✅ Die | ↪ Brace_Idle | | Brace_Exit, Inspect, Swim |
| sacredforestguardian (Plant Painted) | ✅ ArmatureAction | 🔧 | 🔧 | 🔧 | ↪ Attack | | — (só tinha 1 clipe) |
| aramaianwarden (Drugdör) | ✅ Idle | ✅ Attack1 | ✅ Defence2 | ✅ Defence3 | ↪ Attack3 | | Attack2, Defence1, Walk, IdlePieces |
| ruinsguardian (Drugdör) | ✅ Idle | ✅ Attack1 | ✅ Defence2 | ✅ Defence3 | ↪ Attack3 | | idem |
| boneknight (KayKit Skeleton_Warrior) | ✅ Idle_Combat | ✅ 1H_Melee_Attack_Chop | ✅ Hit_A | ✅ Death_A | ↪ Spellcast_Shoot | | ~80 clipes KayKit |
| brokensentinel (Simple Golem) | ✅ Idle | ✅ Attack | ✅ Damage | ✅ Death | ↪ Attack | | Death_2, Idle_To_Walk, Walk |
| cindergolem (Magma Golem) | ✅ combatidle | ✅ chpunch | ✅ hit | ✅ death1 (cortado em 1,25 s: afunda na lava) | ✅ sprayl | FireBreath, ThrowMagma | walk, sleep, teleport… |
| wraith (Viking Spirit, estático) | ✅ Take 01 (flutua) | 🔧 | 🔧 | 🔧 | ↪ Attack | | — |

## Character (nosso esqueleto → todas as animações do personagem: Idle, Attack, Damage, Dead, CombatIdle, CastStart/CastLoop…)

| Monstro | Modelo | Observação |
|---|---|---|
| kwaiouaranger | female archer (Mixamo) | dourado→verde, pele morena; arma no manifesto: `bow-wooden` (presa em tempo de execução) |
| flamingtreant | Treeman | 3,2 m; fx `fire` (arena) |
| moonleafarcanist | Plague Doctor | o clipe Take 001 do modelo foi descartado |
| bandit | — | sem GLB: o próprio personagem com `body-ranger`, `head-rogue-hood`, `cape-rogue`, `shoes-peasant`, `dagger-serrated` |

## Efeitos para a arena (não construídos aqui; `fx` no manifesto)
arcanewisp `blue-fire-aura` · mirageStalker `aura`, `turquoise-eyes` · flamingtreant `fire` · mudcrawler `leaves` · wraith `blue-melting-particles`.
