import { Injectable } from '@nestjs/common';
import { CharacterService } from '../../character/character.service';
import { targetName, type GmCommand, type GmContext } from '../gm.types';

@Injectable()
export class ResetSkillTreeCommand implements GmCommand {
  readonly name = 'reset-skilltree';
  readonly usage = '[charName]';
  readonly summary = 'Refunds a character\'s skill points (mastery progress kept; yours by default)';
  constructor(private readonly characters: CharacterService) {}

  async run([character]: string[], ctx: GmContext): Promise<string> {
    const result = await this.characters.resetMasteryForCharacterName(targetName(character, ctx));
    return `${result.characterName}: skill trees reset in ${result.categoriesReset} categories.`;
  }
}
