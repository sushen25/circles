import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FirstCircleScreen } from '../circles/FirstCircleScreen';
import { NameScreen } from './NameScreen';
import { YourNameScreen } from './YourNameScreen';

/**
 * The three single-input screens a person lands on cold (SUS-195): the guest's
 * name, the organiser's name and the first circle's name. Each one opens with
 * the cursor in its field, so the keyboard is up on a phone, and each field's
 * hint is an instruction, never a name that reads as an answer already given.
 */

const LOOKS_LIKE_AN_ANSWER = /^(Nina|Maya|Sunday Crew)$/;

describe('the three name screens', () => {
  it.each([
    ['the guest name screen', <NameScreen key="a" circleName="Sunday Crew" />, 'Your name'],
    ['the organiser name screen', <YourNameScreen key="b" />, 'Your name'],
    ['the first circle screen', <FirstCircleScreen key="c" />, 'Circle name'],
  ])('%s takes focus and hints with an instruction', (_name, screenElement, label) => {
    render(screenElement);
    const field = screen.getByLabelText(label);
    expect(document.activeElement).toBe(field);
    const hint = field.getAttribute('placeholder') ?? '';
    expect(hint).not.toBe('');
    expect(hint).not.toMatch(LOOKS_LIKE_AN_ANSWER);
  });

  it('asks for a first name, and for the name of the group chat', () => {
    const guest = render(<NameScreen circleName="Sunday Crew" />);
    expect(screen.getByPlaceholderText('Your first name')).toBeVisible();
    guest.unmount();
    const organiser = render(<YourNameScreen />);
    expect(screen.getByPlaceholderText('Your first name')).toBeVisible();
    organiser.unmount();
    render(<FirstCircleScreen />);
    expect(screen.getByPlaceholderText('e.g. the name of your group chat')).toBeVisible();
  });
});
