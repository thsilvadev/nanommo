import { bubbleDurationMs, wrapBubbleText } from './town-speech-bubble';

describe('speech bubble', () => {
  // 10 px per character: easy widths.
  const measure = (s: string) => s.length * 10;

  it('wraps words greedily to the width', () => {
    expect(wrapBubbleText('aaa bbb ccc ddd', measure, 80)).toEqual(['aaa bbb', 'ccc ddd']);
    expect(wrapBubbleText('  oi   tudo bem? ', measure, 200)).toEqual(['oi tudo bem?']);
  });

  it('cuts an overlong word into pieces that fit, on their own lines', () => {
    expect(wrapBubbleText('hi kkkkkkkkkkkkkk ok', measure, 50, 8)).toEqual(['hi', 'kkkkk', 'kkkkk', 'kkkk', 'ok']);
  });

  it('keeps at most four lines and ends the last with an ellipsis', () => {
    const lines = wrapBubbleText('one two three four five six seven', measure, 50, 4);
    expect(lines.length).toBe(4);
    expect(lines[3].endsWith('…')).toBeTrue();
    expect(lines.every((l) => measure(l) <= 50)).toBeTrue();
  });

  it('stays up 4–10 s, longer for longer lines', () => {
    expect(bubbleDurationMs('oi')).toBe(4000);
    expect(bubbleDurationMs('x'.repeat(60))).toBeGreaterThan(bubbleDurationMs('x'.repeat(30)));
    expect(bubbleDurationMs('x'.repeat(200))).toBe(10_000);
  });
});
