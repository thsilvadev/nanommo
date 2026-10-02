import { Injectable, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
@Injectable({providedIn:'root'})
export class ViewportService {
 readonly isMobile=signal(false); readonly isTouch=signal(false); readonly canDrag=signal(true); readonly isLandscape=signal(false); readonly reducedMotion=signal(false);
 constructor(private readonly breakpoints:BreakpointObserver){
  this.breakpoints.observe(['(max-width: 899px)']).subscribe(x=>this.isMobile.set(x.matches));
  const touch=window.matchMedia('(pointer: coarse)'), motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const sync=()=>{this.isTouch.set(touch.matches);this.canDrag.set(!touch.matches);this.isLandscape.set(window.matchMedia('(orientation: landscape)').matches);this.reducedMotion.set(motion.matches)};
  sync(); touch.addEventListener?.('change',sync); motion.addEventListener?.('change',sync); window.addEventListener('resize',sync);
 }
}
