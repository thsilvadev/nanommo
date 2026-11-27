import { Body, Controller, Delete, Get, Param, Post, Put, Request, UseGuards, NotFoundException } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, ArrayMaxSize } from 'class-validator';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CharacterService } from '../character/character.service';
import { PartyService } from './party.service';
class InviteDto {
  @IsOptional() @IsUUID() candidateId?:string;
  @IsOptional() @IsString() @MaxLength(16) candidateName?:string;
  @IsOptional() @IsString() @MaxLength(100) clientRequestId?:string;
}
class LeaveDto { @IsOptional() @IsBoolean() cancel?:boolean; }
class AutoDto { @IsBoolean() enabled!:boolean; }
class LeaderDto { @IsUUID() characterId!:string; @IsOptional() @IsString() @MaxLength(100) clientRequestId?:string; }
class OrderDto { @IsArray() @ArrayMaxSize(5) @IsUUID('all',{each:true}) characterIds!:string[]; }
class ActionDto {
  @IsString() @MaxLength(100) clientRequestId!:string;
  @IsIn(['equip','unequip','use_item','gambit_update','gambit_activate','attributes']) kind!:string;
  @IsObject() payload!:Record<string,unknown>;
}
@Controller('party')
@UseGuards(JwtAuthGuard)
export class PartyController {
  constructor(private readonly characters:CharacterService,private readonly parties:PartyService){}
  private async id(req:any){const c=await this.characters.getCharacterByUserId(req.user.userId);if(!c)throw new NotFoundException('Character not found');return c.id;}
  @Get() async get(@Request()req:any){return this.parties.get(await this.id(req));}
  @Post('invites') async invite(@Request()req:any,@Body()dto:InviteDto){return this.parties.invite(await this.id(req),dto.candidateId,dto.candidateName,dto.clientRequestId??randomUUID());}
  @Post('invites/:id/accept') async accept(@Request()req:any,@Param('id')id:string){return this.parties.accept(await this.id(req),id);}
  @Delete('invites/:id') async cancel(@Request()req:any,@Param('id')id:string){return this.parties.cancelInvite(await this.id(req),id);}
  @Post('leave') async leave(@Request()req:any,@Body()dto:LeaveDto){return this.parties.leave(await this.id(req),dto.cancel===true);}
  @Delete('members/:id') async kick(@Request()req:any,@Param('id')id:string){return this.parties.leave(await this.id(req),false,id);}
  @Put('order') async order(@Request()req:any,@Body()dto:OrderDto){return this.parties.reorder(await this.id(req),dto.characterIds);}
  @Put('leader') async leader(@Request()req:any,@Body()dto:LeaderDto){return this.parties.transferLeader(await this.id(req),dto.characterId);}
  @Put('auto') async auto(@Request()req:any,@Body()dto:AutoDto){return this.parties.setAuto(await this.id(req),dto.enabled);}
  @Get('actions') async actions(@Request()req:any){return this.parties.actions(await this.id(req));}
  @Post('actions') async enqueue(@Request()req:any,@Body()dto:ActionDto){return this.parties.enqueue(await this.id(req),dto.clientRequestId,dto.kind,dto.payload);}
  @Delete('actions/:id') async cancelAction(@Request()req:any,@Param('id')id:string){return this.parties.cancelAction(await this.id(req),id);}
  @Post('teleport') async teleport(@Request()req:any){return this.parties.teleport(await this.id(req));}
  @Post('flee') async flee(@Request()req:any){return this.parties.flee(await this.id(req));}
}
