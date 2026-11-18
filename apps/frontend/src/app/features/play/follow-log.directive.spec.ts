import { ElementRef } from '@angular/core';
import { FollowLogDirective } from './follow-log.directive';

describe('battle log following', () => {
  let el: HTMLDivElement;
  let directive: FollowLogDirective;
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  beforeEach(() => {
    el = document.createElement('div');
    el.style.cssText = 'height:100px;overflow:auto;overflow-anchor:none';
    document.body.append(el);
    for (let i=0; i<20; i++) { const row=document.createElement('div');row.style.height='20px';el.append(row); }
    directive=new FollowLogDirective(new ElementRef(el));
    el.addEventListener('scroll',()=>directive.onScroll());
    directive.ngAfterViewInit();
  });
  afterEach(() => { directive.ngOnDestroy();el.remove(); });
  it('follows appended rows, pauses while reading and resumes at the bottom', async () => {
    await frame();
    expect(el.scrollTop).toBe(el.scrollHeight-el.clientHeight);
    const append=()=>{const row=document.createElement('div');row.style.height='40px';el.append(row);};
    append(); await frame();
    expect(el.scrollTop).toBe(el.scrollHeight-el.clientHeight);
    el.scrollTop=30;directive.onScroll();await frame();
    append();await frame();expect(el.scrollTop).toBe(30);
    el.scrollTop=el.scrollHeight;directive.onScroll();await frame();
    append();await frame();expect(el.scrollTop).toBe(el.scrollHeight-el.clientHeight);
  });
});
