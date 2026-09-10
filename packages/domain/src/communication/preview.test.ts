import { describe, expect, it } from 'vitest';

import { EN_PREVIEW_TEMPLATES, ogDescription, ogTitle } from './preview.js';

const MEMBER_NAMES = ['Maya', 'Priya', 'Tom', 'Jess', 'Sam', 'Alex', 'Nic'];

describe('the link preview', () => {
  it('is the artboard, word for word', () => {
    expect(ogTitle('Sunday Crew', EN_PREVIEW_TEMPLATES)).toBe(
      'Sunday Crew is finding a time to catch up',
    );
    expect(ogDescription(EN_PREVIEW_TEMPLATES)).toBe(
      "Pick the times you'd actually be up for. No app needed.",
    );
  });

  it('names no member and no date, whatever the circle is called', () => {
    // A preview is fetched by the chat app and rendered to the whole thread —
    // including people who are not in the circle — before anybody taps.
    for (const name of MEMBER_NAMES) {
      const title = ogTitle('Sunday Crew', EN_PREVIEW_TEMPLATES);
      expect(title).not.toContain(name);
    }
    expect(ogDescription(EN_PREVIEW_TEMPLATES)).not.toMatch(/\d/);
    expect(ogTitle('Sunday Crew', EN_PREVIEW_TEMPLATES)).not.toMatch(/\d/);
  });

  it('says nothing about a quiet ask, because it is given nothing to say it with', () => {
    // The enforcement is the signature: the only input is the circle name, so
    // there is no plan, no mode and no initiator in scope to leak.
    expect(ogTitle.length).toBe(2);
    expect(ogDescription.length).toBe(1);
  });

  it('is the same sentence for every plan of every circle', () => {
    expect(ogDescription(EN_PREVIEW_TEMPLATES)).toBe(ogDescription(EN_PREVIEW_TEMPLATES));
  });

  it('passes a circle name through unchanged, however it is written', () => {
    for (const name of ['Sunday Crew', 'the 5am club', "Jess & Tom's"]) {
      expect(ogTitle(name, EN_PREVIEW_TEMPLATES)).toContain(name);
    }
  });
});
