import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MainScreen } from './MainScreen';

describe('MainScreen', () => {
  it('shows a failure with a way to retry even when there is no invite to show', () => {
    // The live flow has nothing to preview when the preview is what failed.
    // A screen that needed an invite before it would show an error sat on
    // "Opening the invite" for ever.
    render(<MainScreen state="error" onRetry={() => undefined} />);

    expect(screen.getByText("We couldn't open this invite just now.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('describes who is in without saying anybody has answered', () => {
    // The preview carries membership initials and nothing else. "M answered"
    // would be reply state the Join page has no business with (ADR 0006).
    render(
      <MainScreen
        invite={{ circleName: 'Sunday Crew', inviterName: 'Maya', memberInitials: ['M', 'P'] }}
      />,
    );

    const marks = screen.getByRole('img');
    expect(marks.getAttribute('aria-label')).toBe('2 people are in so far');
    expect(document.body.innerHTML).not.toMatch(/answered/);
  });
});
