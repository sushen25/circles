import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Input } from './Input';
import { TEXT_AREA_MAX, TEXT_AREA_MIN, TextArea } from './TextArea';

// jsdom does no layout, so the content height is whatever the test says it is.
let content = 0;
Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
  configurable: true,
  get: () => content,
});

afterEach(() => {
  content = 0;
});

const heightOf = (el: HTMLElement) => Number.parseInt(el.style.height, 10);

describe('TextArea', () => {
  it('is a textarea about four lines tall when empty', () => {
    content = 40;
    render(<TextArea aria-label="Note" placeholder="Say something" value="" />);
    const el = screen.getByLabelText('Note');
    expect(el.tagName).toBe('TEXTAREA');
    expect(heightOf(el)).toBe(TEXT_AREA_MIN);
  });

  it('grows with its content, then stops at about eight lines and scrolls', () => {
    content = 100;
    const { rerender } = render(<TextArea aria-label="Note" value="a" />);
    const el = screen.getByLabelText('Note');
    expect(heightOf(el)).toBe(TEXT_AREA_MIN);

    content = 160;
    rerender(<TextArea aria-label="Note" value={'a\nb\nc\nd\ne'} />);
    expect(heightOf(el)).toBe(162);

    content = 900;
    rerender(<TextArea aria-label="Note" value={'a\n'.repeat(30)} />);
    expect(heightOf(el)).toBe(TEXT_AREA_MAX);
  });

  it('passes typing through', () => {
    let seen = '';
    render(<TextArea aria-label="Note" value="" onChangeText={(t) => (seen = t)} />);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'hello' } });
    expect(seen).toBe('hello');
  });
});

describe('Input', () => {
  it('stays exactly 54 tall', () => {
    render(<Input aria-label="Place" value="" />);
    expect(screen.getByLabelText('Place')).toHaveStyle({ height: '54px' });
  });
});
