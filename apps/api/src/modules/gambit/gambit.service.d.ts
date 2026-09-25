import { Repository } from 'typeorm';
import { GambitPage } from '../../database/entities/gambit-page.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';
export declare class GambitService {
    private readonly gambitPageRepo;
    private readonly characterRepo;
    private readonly dataService;
    constructor(gambitPageRepo: Repository<GambitPage>, characterRepo: Repository<Character>, dataService: DataService);
    /**
     * Get all gambit pages for a character
     */
    getGambitPages(characterId: string): Promise<GambitPage[]>;
    /**
     * Get a specific gambit page
     */
    getGambitPage(pageId: string): Promise<GambitPage | null>;
    /**
     * Create a new gambit page for a character
     */
    createGambitPage(characterId: string, pageData: any): Promise<GambitPage>;
    /**
     * Update a gambit page with validation
     */
    updateGambitPage(pageId: string, pageData: any): Promise<GambitPage>;
    /**
     * Delete a gambit page
     */
    deleteGambitPage(pageId: string): Promise<void>;
    /**
     * Validate a gambit line structure
     */
    validateGambitLine(line: any): Promise<{
        valid: boolean;
        errors?: string[];
    }>;
    /**
     * Get the active gambit page for a character
     */
    getActiveGambitPage(characterId: string): Promise<GambitPage>;
    /**
     * Set the active gambit page
     */
    setActiveGambitPage(characterId: string, pageId: string): Promise<void>;
}
//# sourceMappingURL=gambit.service.d.ts.map