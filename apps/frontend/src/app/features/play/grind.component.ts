import { CommonModule } from '@angular/common';
import { inject } from '@angular/core';
import { CharacterStore } from '../../core/game.store';
import { Component } from '@angular/core';
import { MapBoard, InventoryGrid, TownCenter } from './components';
@Component({selector:'app-grind',standalone:true,imports:[CommonModule,MapBoard,InventoryGrid,TownCenter],templateUrl:'./grind.component.html',styleUrl:'./grind.component.css'})
export class GrindComponent { readonly character=inject(CharacterStore); }
