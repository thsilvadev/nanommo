import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GambitPage } from '../../database/entities/gambit-page.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';

@Injectable()
export class GambitService {
  constructor(
    @InjectRepository(GambitPage)
    private readonly gambitPageRepo: Repository<GambitPage>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    private readonly dataService: DataService,
  ) {}

  /**
   * Get all gambit pages for a character
   */
  async getGambitPages(characterId: string): Promise<GambitPage[]> {
    return this.gambitPageRepo.find({
      where: { character: { id: characterId } },
    });
  }

  /**
   * Get a specific gambit page
   */
  async getGambitPage(pageId: string): Promise<GambitPage | null> {
    return this.gambitPageRepo.findOneBy({ id: pageId });
  }

  /**
   * Create or update a gambit page for a character
   * If slotIndex is provided, performs upsert operation (updates existing or creates new)
   */
  async createGambitPage(characterId: string, pageData: any): Promise<GambitPage> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) {
      throw new Error('Character not found');
    }

    // If slotIndex is provided, upsert (update or create)
    if (pageData.slotIndex !== undefined) {
      const slotIndex = pageData.slotIndex;
      
      // Validate slotIndex
      if (slotIndex < 0 || slotIndex > 2) {
        throw new Error('slotIndex must be between 0 and 2');
      }

      // Try to find existing page for this slot
      const existingPage = await this.gambitPageRepo.findOne({
        where: {
          characterId,
          slotIndex,
        },
      });

      if (existingPage) {
        // Update existing page
        existingPage.title = pageData.title || existingPage.title;
        existingPage.lines = pageData.lines || existingPage.lines;
        return this.gambitPageRepo.save(existingPage);
      }
    }

    // Create new page
    const gambitPage = this.gambitPageRepo.create({
      characterId,
      slotIndex: pageData.slotIndex || 0,
      title: pageData.title || 'Default Page',
      lines: pageData.lines || [],
    });

    return this.gambitPageRepo.save(gambitPage);
  }

  /**
   * Update a gambit page with validation
   */
  async updateGambitPage(pageId: string, pageData: any): Promise<GambitPage> {
    // TODO: Implement update
    // - Validate all gambit lines
    // - Check condition/action validity
    // - Update database
    throw new Error('Not implemented');
  }

  /**
   * Delete a gambit page
   */
  async deleteGambitPage(pageId: string): Promise<void> {
    await this.gambitPageRepo.delete(pageId);
  }

  /**
   * Validate a gambit line structure
   */
  async validateGambitLine(line: any): Promise<{ valid: boolean; errors?: string[] }> {
    // TODO: Implement validation
    // - Check condition exists in catalog
    // - Check action exists in catalog
    // - Validate parameters
    throw new Error('Not implemented');
  }

  /**
   * Get the active gambit page for a character
   */
  async getActiveGambitPage(characterId: string): Promise<GambitPage | null> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character || !character.activeGambitPageId) {
      return null;
    }
    return this.gambitPageRepo.findOneBy({ id: character.activeGambitPageId });
  }

  /**
   * Activate a gambit page for a character
   */
  async activateGambitPage(characterId: string, pageId: string): Promise<GambitPage> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) {
      throw new Error('Character not found');
    }

    const page = await this.gambitPageRepo.findOne({
      where: { id: pageId, characterId },
    });

    if (!page) {
      throw new Error('Gambit page not found or does not belong to this character');
    }

    // Update character to set active gambit page
    character.activeGambitPageId = pageId;
    await this.characterRepo.save(character);

    return page;
  }

  /**
   * Set the active gambit page (deprecated, use activateGambitPage)
   */
  async setActiveGambitPage(characterId: string, pageId: string): Promise<void> {
    await this.activateGambitPage(characterId, pageId);
  }
}
