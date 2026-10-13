import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { Character } from './character.entity';

@Entity('weapon_proficiencies')
@Unique(['characterId', 'weaponType'])
@Index(['characterId'])
export class WeaponProficiency {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  characterId!: string;

  @ManyToOne(() => Character, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character?: Character;

  @Column({ type: 'varchar', length: 16 })
  weaponType!: string;

  @Column({ type: 'int', default: 0 })
  level!: number;

  @Column({ type: 'bigint', default: 0 })
  xp!: number;

  @Column({ type: 'int', default: 0 })
  spentSkillPoints!: number;

  @Column({ type: 'jsonb', default: '{}' })
  skillRanks!: Record<string, number>;
}
