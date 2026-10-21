import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DeletedScreen } from './DeletedScreen';

describe('DeletedScreen', () => {
  it('says the account is deleted and what happens next, with no session', () => {
    const onDone = vi.fn();
    render(<DeletedScreen onDone={onDone} />);

    expect(screen.getByText('Your account is deleted')).toBeVisible();
    expect(screen.getByText(/Thirty days from now we delete the rest/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
