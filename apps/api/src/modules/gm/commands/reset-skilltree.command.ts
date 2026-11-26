import { Injectable } from '@nestjs/common';
import { CharacterService } from '../../character/character.service';
import { GmCommandError, type GmCommand } from '../gm.types';

@Injectable()
export class ResetSkillTreeCommand implements GmCommand {
  readonly name = 'reset-skilltree';
  readonly usage = '<charName>';
  readonly summary = 'Refunds a character\'s skill points (mastery progress kept)';
  constructor(private readonly characters: CharacterService) {}

  async run([character]: string[]): Promise<string> {
    if (!character?.trim()) throw new GmCommandError('Pass the exact character name');
    const result = await this.characters.resetMasteryForCharacterName(character.trim());
    return `${result.characterName}: skill trees reset in ${result.categoriesReset} categories.`;
  }
}
