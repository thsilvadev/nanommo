import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { Character } from './character.entity';
import { WeaponType } from '@nanommo/shared';

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

  @Column({ type: 'enum', enum: ['sword', 'greatsword', 'dagger', 'bow', 'staff', 'wand', 'shield'] })
  weaponType!: WeaponType;

  @Column({ type: 'int', default: 1 })
  level!: number;

  @Column({ type: 'bigint', default: 0 })
  xp!: number;
}
