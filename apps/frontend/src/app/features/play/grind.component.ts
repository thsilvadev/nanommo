import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { MapBoard, InventoryGrid } from './components';
@Component({selector:'app-grind',standalone:true,imports:[CommonModule,MapBoard,InventoryGrid],templateUrl:'./grind.component.html',styleUrl:'./grind.component.css'})
export class GrindComponent {}
