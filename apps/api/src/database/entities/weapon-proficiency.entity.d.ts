import { Character } from './character.entity';
import { WeaponType } from '@nanommo/shared';
export declare class WeaponProficiency {
    id: string;
    characterId: string;
    character?: Character;
    weaponType: WeaponType;
    level: number;
    xp: number;
}
//# sourceMappingURL=weapon-proficiency.entity.d.ts.map