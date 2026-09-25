import { Repository } from 'typeorm';
import { Character, WeaponProficiency } from '@/database/entities';
import { CharacterDto, Attribute } from '@nanommo/shared';
import { DataService } from '../data/data.service';
export declare class CharacterService {
    private characterRepository;
    private weaponProficiencyRepository;
    private dataService;
    private readonly logger;
    constructor(characterRepository: Repository<Character>, weaponProficiencyRepository: Repository<WeaponProficiency>, dataService: DataService);
    createCharacter(userId: string, username: string): Promise<CharacterDto>;
    getCharacterByUserId(userId: string): Promise<Character | null>;
    getCharacterById(characterId: string): Promise<Character | null>;
    spendAttributePoints(characterId: string, attributes: Partial<Record<Attribute, number>>): Promise<CharacterDto>;
    gainXp(characterId: string, xpAmount: number): Promise<void>;
    private toDto;
}
//# sourceMappingURL=character.service.d.ts.map