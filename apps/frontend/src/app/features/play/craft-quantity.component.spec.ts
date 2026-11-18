import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CraftQuantityComponent } from './craft-quantity.component';

describe('craft quantity control', () => {
  let fixture: ComponentFixture<CraftQuantityComponent>;
  let host: HTMLElement;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CraftQuantityComponent] }).compileComponents();
    fixture = TestBed.createComponent(CraftQuantityComponent);
    fixture.componentRef.setInput('max', 12);
    fixture.componentRef.setInput('value', 3);
    fixture.componentInstance.valueChange.subscribe(value => fixture.componentRef.setInput('value', value));
    fixture.detectChanges();host = fixture.nativeElement;
  });
  it('keeps a subtle Max link left of the input, centered vertically', () => {
    for (const width of ['1000px', '320px']) {
      host.style.width = width;
      const max = host.querySelector<HTMLButtonElement>('.quantity-max')!;
      const input = host.querySelector('input')!;
      const a = max.getBoundingClientRect(), b = input.getBoundingClientRect();
      expect(max.textContent?.trim()).toBe('Max');
      expect(a.right).toBeLessThanOrEqual(b.left);
      expect(Math.abs((a.top+a.height/2)-(b.top+b.height/2))).toBeLessThan(2);
      expect(getComputedStyle(max).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(max).borderTopWidth).toBe('0px');
    }
  });
  it('sets Max, steps within bounds, and clamps typed quantities', () => {
    host.querySelector<HTMLButtonElement>('.quantity-max')!.click();fixture.detectChanges();
    expect(fixture.componentInstance.value).toBe(12);
    expect(host.querySelector<HTMLButtonElement>('.quantity-up')!.disabled).toBeTrue();
    host.querySelector<HTMLButtonElement>('.quantity-down')!.click();fixture.detectChanges();
    expect(fixture.componentInstance.value).toBe(11);
    const input=host.querySelector('input')!;
    input.value='99';input.dispatchEvent(new Event('input'));fixture.detectChanges();expect(input.value).toBe('12');
    input.value='0';input.dispatchEvent(new Event('input'));fixture.detectChanges();expect(input.value).toBe('1');
    expect(host.querySelector<HTMLButtonElement>('.quantity-down')!.disabled).toBeTrue();
  });
  it('disables every control while crafting is unavailable', () => {
    fixture.componentRef.setInput('disabled',true);fixture.detectChanges();
    expect(Array.from(host.querySelectorAll('input,button')).every(el=>(el as HTMLInputElement).disabled)).toBeTrue();
  });
});
