import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WelcomeScreen } from './WelcomeScreen';

describe('WelcomeScreen while it works out where to send somebody (SUS-157)', () => {
  it('carries the brand lockup from the first moment of the wait', () => {
    render(<WelcomeScreen state="loading" />);
    expect(screen.getByLabelText('Wenna')).toBeInTheDocument();
  });

  it('and on the way out to its error, so the brand never leaves', () => {
    render(<WelcomeScreen state="error" />);
    expect(screen.getByLabelText('Wenna')).toBeInTheDocument();
  });
});
