import { GambitService } from './gambit.service';
export declare class GambitController {
    private readonly gambitService;
    constructor(gambitService: GambitService);
    /**
     * Get all gambit pages for the character
     */
    getGambitPages(req: any): Promise<import("../../database/entities").GambitPage[]>;
    /**
     * Get a specific gambit page
     */
    getGambitPage(pageId: string): Promise<import("../../database/entities").GambitPage | null>;
    /**
     * Create a new gambit page
     */
    createGambitPage(req: any, pageData: any): Promise<import("../../database/entities").GambitPage>;
    /**
     * Update a gambit page
     */
    updateGambitPage(pageId: string, pageData: any): Promise<import("../../database/entities").GambitPage>;
    /**
     * Delete a gambit page
     */
    deleteGambitPage(pageId: string): Promise<{
        success: boolean;
    }>;
    /**
     * Validate a gambit line
     */
    validateGambitLine(line: any): Promise<{
        valid: boolean;
        errors?: string[];
    }>;
}
//# sourceMappingURL=gambit.controller.d.ts.map