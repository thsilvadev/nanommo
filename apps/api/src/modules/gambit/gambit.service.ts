import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { GambitPage } from '../../database/entities/gambit-page.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';

/** SPEC §8.4: at most 20 gambit lines per page. */
const MAX_LINES_PER_PAGE = 20;
/** SPEC §8.4: exactly 1 condition per line. */
const MIN_CONDITIONS_PER_LINE = 1;

export interface GambitValidationError {
  /** Dotted path into the request body, e.g. `lines[2].conditions[0].id`. */
  path: string;
  message: string;
}

export interface GambitValidationResult {
  valid: boolean;
  errors: GambitValidationError[];
}

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
   * SPEC §8.4 — server-side gambit validation, mandatory on every page write.
   *
   * Accepts both param shapes the project uses, mirroring
   * `GambitEvaluator.readParams()` in the shared engine: the SPEC §8.2 nested
   * form `{ id, params: { band } }` and the `gambit_catalog.json` / live payload
   * inline form `{ id, band }`. Rejecting one of them would be the same class of
   * bug as the `drop.dropRate` vs `drop.chance` mismatch.
   */
  private static readParams(node: any): Record<string, any> {
    if (!node || typeof node !== 'object') return {};
    const { id: _id, params, ...rest } = node;
    return { ...rest, ...(params ?? {}) };
  }

  private catalogConditions(): any[] {
    return this.dataService.getGambitCatalog()?.conditions ?? [];
  }

  private catalogActions(): any[] {
    return this.dataService.getGambitCatalog()?.actions ?? [];
  }


  /** Only the 7 player weapon trees — `monsterSkills` are not character-usable. */
  private characterSkillExists(skillId: string): boolean {
    const trees = this.dataService.getSkillTrees()?.trees ?? {};
    for (const weaponType of Object.keys(trees)) {
      if ((trees[weaponType] ?? []).some((s: any) => s.id === skillId)) return true;
    }
    return false;
  }

  /**
   * Validate a single `condition`/`action` node against its catalog entry and
   * resolve `skillRef` / `itemRef` params for real existence.
   */
  private validateNode(
    node: any,
    kind: 'condition' | 'action',
    path: string,
    errors: GambitValidationError[],
  ): void {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      errors.push({ path, message: `${kind} must be an object` });
      return;
    }

    const id = node.id;
    if (typeof id !== 'string' || id.length === 0) {
      errors.push({ path: `${path}.id`, message: `${kind}.id is required` });
      return;
    }

    const catalog =
      kind === 'condition'
        ? this.catalogConditions().find((c: any) => c.id === id)
        : this.catalogActions().find((a: any) => a.id === id);

    if (!catalog) {
      errors.push({
        path: `${path}.id`,
        message: `Unknown ${kind}.id "${id}" - not present in gambit_catalog.json`,
      });
      return;
    }

    const params = GambitService.readParams(node);

    for (const spec of catalog.params ?? []) {
      const value = params[spec.name];

      if (value === undefined || value === null || value === '') {
        errors.push({
          path: `${path}.${spec.name}`,
          message: `${kind} "${id}" requires param "${spec.name}"`,
        });
        continue;
      }

      if (spec.type === 'enum') {
        if (!(spec.values ?? []).includes(value)) {
          errors.push({
            path: `${path}.${spec.name}`,
            message: `${kind} "${id}" param "${spec.name}" must be one of ${(
              spec.values ?? []
            ).join(', ')} (got ${JSON.stringify(value)})`,
          });
        }
        continue;
      }

      if (spec.type === 'skillRef') {
        if (!this.characterSkillExists(String(value))) {
          errors.push({
            path: `${path}.${spec.name}`,
            message: `${kind} "${id}" references unknown skillId "${value}" - not in skill_trees.json`,
          });
        }
        continue;
      }

      if (spec.type === 'itemRef') {
        if (!this.dataService.getItemById(String(value))) {
          errors.push({
            path: `${path}.${spec.name}`,
            message: `${kind} "${id}" references unknown itemId "${value}" - not in items.json`,
          });
        }
      }
    }
  }

  /**
   * SPEC §8.4 — validate a single gambit line.
   * Returns every problem found rather than throwing on the first one, so the
   * client can highlight all offending fields at once.
   */
  async validateGambitLine(
    line: any,
    path = 'line',
  ): Promise<GambitValidationResult> {
    const errors: GambitValidationError[] = [];

    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      return { valid: false, errors: [{ path, message: 'line must be an object' }] };
    }

    if (line.priority !== undefined && line.priority !== null) {
      if (!Number.isInteger(line.priority) || line.priority < 1) {
        errors.push({
          path: `${path}.priority`,
          message: 'priority must be a positive integer',
        });
      }
    }

    // --- exactly one condition per line; combinators are no longer part of the contract
    const conditions = line.conditions;
    if (!Array.isArray(conditions) || conditions.length !== 1) {
      errors.push({
        path: `${path}.conditions`,
        message: `a gambit line must have exactly 1 condition (got ${Array.isArray(conditions) ? conditions.length : 'non-array'})`,
      });
    } else {
      this.validateNode(conditions[0], 'condition', `${path}.conditions[0]`, errors);
    }

    if (line.combinator !== undefined && line.combinator !== null) {
      errors.push({
        path: `${path}.combinator`,
        message: 'combinator is no longer supported; each gambit line has exactly 1 condition',
      });
    }

    // --- action: must exist, and its skill/item refs must be real
    if (!line.action) {
      errors.push({ path: `${path}.action`, message: 'action is required' });
    } else {
      this.validateNode(line.action, 'action', `${path}.action`, errors);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * SPEC §8.4 — validate a whole page. Rejects the ENTIRE write if any line
   * fails; invalid lines are never silently dropped.
   */
  async validateGambitPage(lines: any): Promise<GambitValidationResult> {
    const errors: GambitValidationError[] = [];

    if (!Array.isArray(lines)) {
      return {
        valid: false,
        errors: [{ path: 'lines', message: 'lines must be an array' }],
      };
    }

    if (lines.length > MAX_LINES_PER_PAGE) {
      errors.push({
        path: 'lines',
        message: `a page holds at most ${MAX_LINES_PER_PAGE} lines (got ${lines.length})`,
      });
    }

    for (let i = 0; i < lines.length; i++) {
      const result = await this.validateGambitLine(lines[i], `lines[${i}]`);
      errors.push(...result.errors);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * SPEC §8.4 — "Reject the whole write with a 400 + field-level errors if any
   * line fails validation - never silently drop invalid lines."
   * Throws before any repository write happens.
   */
  private async assertValidGambitPage(lines: any): Promise<void> {
    const result = await this.validateGambitPage(lines);

    if (!result.valid) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: result.errors.map((e) => `${e.path}: ${e.message}`),
        fieldErrors: result.errors,
      });
    }
  }

  /**
   * Get all gambit pages for a character
   */
  async getGambitPages(characterId: string): Promise<GambitPage[]> {
    const pages = await this.gambitPageRepo.find({
      where: { character: { id: characterId } },
    });

    // Keep the starter page name consistent for characters created before
    // the Default Gambit naming was introduced.
    const defaultPage = pages.find((page) => page.slotIndex === 0);
    if (defaultPage && (!defaultPage.title || defaultPage.title.trim() === 'Page 1')) {
      defaultPage.title = 'Default Gambit';
      await this.gambitPageRepo.save(defaultPage);
    }

    return pages;
  }

  /**
   * Get a specific gambit page
   */
  async getGambitPage(pageId: string): Promise<GambitPage | null> {
    return this.gambitPageRepo.findOneBy({ id: pageId });
  }

  /** Persist the canonical one-condition line shape and discard legacy null combinators. */
  private canonicalizeLines(lines: any[]): any[] {
    return lines.map((line: any) => {
      const { combinator: _legacyCombinator, ...rest } = line;
      return { ...rest, conditions: [line.conditions[0]] };
    });
  }

  /**
   * Create or update a gambit page for a character
   * If slotIndex is provided, performs upsert operation (updates existing or creates new)
   *
   * SPEC §8.4: the whole payload is validated before anything is written, so an
   * invalid line can never be persisted and then silently never fire.
   */
  async createGambitPage(characterId: string, pageData: any): Promise<GambitPage> {
    const character = await this.characterRepo.findOne({ where: { id: characterId } });
    if (!character) {
      throw new NotFoundException('Character not found');
    }

    if (pageData.slotIndex !== undefined) {
      const slotIndex = pageData.slotIndex;

      if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 2) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: ['slotIndex: must be an integer between 0 and 2'],
          fieldErrors: [
            { path: 'slotIndex', message: 'must be an integer between 0 and 2' },
          ],
        });
      }
    }

    const lines = pageData.lines ?? [];
    await this.assertValidGambitPage(lines);
    const canonicalLines = this.canonicalizeLines(lines);

    // If slotIndex is provided, upsert (update or create)
    if (pageData.slotIndex !== undefined) {
      const existingPage = await this.gambitPageRepo.findOne({
        where: {
          characterId,
          slotIndex: pageData.slotIndex,
        },
      });

      if (existingPage) {
        existingPage.title = pageData.title ?? existingPage.title;
        existingPage.lines = canonicalLines;
        return this.gambitPageRepo.save(existingPage);
      }
    }

    const gambitPage = this.gambitPageRepo.create({
      characterId,
      slotIndex: pageData.slotIndex ?? 0,
      title: pageData.title ?? 'Default Gambit',
      lines: canonicalLines,
    });

    return this.gambitPageRepo.save(gambitPage);
  }

  /**
   * Update a gambit page.
   *
   * Scoped by `characterId` on purpose: the controller resolves the caller from
   * the JWT, so one user can never update another character's page by guessing
   * a pageId.
   */
  async updateGambitPage(
    characterId: string,
    pageId: string,
    pageData: any,
  ): Promise<GambitPage> {
    const page = await this.gambitPageRepo.findOne({
      where: { id: pageId, characterId },
    });
    if (!page) {
      throw new NotFoundException('Gambit page not found');
    }

    if (pageData.slotIndex !== undefined) {
      const slotIndex = pageData.slotIndex;
      if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 2) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: ['slotIndex: must be an integer between 0 and 2'],
          fieldErrors: [
            { path: 'slotIndex', message: 'must be an integer between 0 and 2' },
          ],
        });
      }

      // A slot may only be held by one page, otherwise `getGambitPages` would
      // return two pages for the same slot and activation would be ambiguous.
      const clash = await this.gambitPageRepo.findOne({
        where: {
          characterId,
          slotIndex,
          id: In([pageId].filter((id) => id !== pageId) as string[]),
        },
      });
      if (clash) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: [`slotIndex: slot ${slotIndex} is already taken by another page`],
          fieldErrors: [
            { path: 'slotIndex', message: `slot ${slotIndex} is already taken` },
          ],
        });
      }
      page.slotIndex = slotIndex;
    }

    if (pageData.title !== undefined) {
      if (typeof pageData.title !== 'string' || pageData.title.trim().length === 0) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: ['title: must be a non-empty string'],
          fieldErrors: [{ path: 'title', message: 'must be a non-empty string' }],
        });
      }
      page.title = pageData.title;
    }

    if (pageData.lines !== undefined) {
      await this.assertValidGambitPage(pageData.lines);
      page.lines = this.canonicalizeLines(pageData.lines);
    }

    return this.gambitPageRepo.save(page);
  }

  /**
   * Delete a gambit page. Scoped by `characterId` so one user cannot delete
   * another character's page.
   */
  async deleteGambitPage(characterId: string, pageId: string): Promise<void> {
    const result = await this.gambitPageRepo.delete({ id: pageId, characterId });
    if (!result.affected) {
      throw new NotFoundException('Gambit page not found');
    }

    // A deleted page must not stay as the character's active page.
    await this.characterRepo
      .createQueryBuilder()
      .update(Character)
      .set({ activeGambitPageId: null })
      .where('"id" = :characterId', { characterId })
      .andWhere('"activeGambitPageId" = :pageId', { pageId })
      .execute();
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
      throw new NotFoundException('Character not found');
    }

    const page = await this.gambitPageRepo.findOne({
      where: { id: pageId, characterId },
    });

    if (!page) {
      // 404 rather than 403 so the endpoint does not confirm that another
      // user's pageId exists.
      throw new NotFoundException('Gambit page not found');
    }

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
