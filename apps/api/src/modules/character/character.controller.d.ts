import { Request as ExpressRequest } from 'express';
import { CharacterService } from './character.service';
import { CreateCharacterDto, CharacterDto, SpendAttributePointsDto } from '@nanommo/shared';
export declare class CharacterController {
    private characterService;
    constructor(characterService: CharacterService);
    create(req: ExpressRequest, dto: CreateCharacterDto): Promise<CharacterDto>;
    getMyCharacter(req: ExpressRequest): Promise<CharacterDto | null>;
    spendAttributes(req: ExpressRequest, dto: SpendAttributePointsDto): Promise<CharacterDto>;
}
//# sourceMappingURL=character.controller.d.ts.map