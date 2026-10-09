import { describe, expect, it } from 'vitest';

import {
  EN_PREVIEW_CARDS,
  EN_PREVIEW_TEMPLATES,
  ogDescription,
  ogTitle,
  previewCopy,
} from './preview.js';

const MEMBER_NAMES = ['Maya', 'Nina', 'Tom', 'Jess', 'Sam', 'Alex', 'Nic'];

describe('the link preview', () => {
  it('is the artboard, word for word', () => {
    expect(ogTitle('Sunday Crew', EN_PREVIEW_TEMPLATES)).toBe(
      'Sunday Crew is finding a time to catch up',
    );
    expect(ogDescription(EN_PREVIEW_TEMPLATES)).toBe(
      "Pick the times you'd be up for. About a minute, and nobody sees your calendar.",
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

describe('the card for each link and plan state', () => {
  const circle = 'Sunday Crew';
  const copy = (
    kind: string,
    circleName: string | null,
    planState: 'asking' | 'locked_in' | null,
  ) => previewCopy({ kind, circleName, planState }, 'Acme');

  it('says a confirmed plan is locked in, by the circle name alone', () => {
    expect(copy('p', circle, 'locked_in')).toEqual({
      title: 'Sunday Crew is locked in',
      description: 'The day, the time, the place, and add to calendar.',
    });
  });

  it('keeps the asking card for a plan that is still asking, on either link', () => {
    for (const kind of ['p', 'j']) {
      expect(copy(kind, circle, 'asking')).toEqual({
        title: ogTitle(circle, EN_PREVIEW_TEMPLATES),
        description: ogDescription(EN_PREVIEW_TEMPLATES),
      });
    }
  });

  it('is the same locked-in card whichever of the two plan links it came by', () => {
    expect(copy('j', circle, 'locked_in')).toEqual(copy('p', circle, 'locked_in'));
  });

  it('draws the generic card, which claims no plan, for a link that does not resolve', () => {
    for (const kind of ['p', 'j']) {
      const card = copy(kind, null, null);
      expect(card.title).toBe('Plans with friends, on Acme');
      expect(`${card.title} ${card.description}`).not.toMatch(/finding a time|locked/i);
    }
  });

  it('draws the invite card for /join, whatever else it is given', () => {
    const card = copy('join', null, null);
    expect(card.title).toBe("You're invited to a circle on Acme");
    expect(`${card.title} ${card.description}`).not.toMatch(/finding a time|locked/i);
    expect(copy('join', circle, 'locked_in')).toEqual(card);
  });

  it('never says more than "locked in": no date, time, place or member, in any card', () => {
    const everything = [
      copy('p', circle, 'locked_in'),
      copy('p', circle, 'asking'),
      copy('p', null, null),
      copy('join', null, null),
    ].map((card) => `${card.title} ${card.description}`);
    for (const text of everything) {
      expect(text).not.toMatch(/\d/);
      for (const name of MEMBER_NAMES) expect(text).not.toContain(name);
    }
  });

  it('keeps the asking card as the template everything else renders', () => {
    expect(EN_PREVIEW_CARDS.asking).toBe(EN_PREVIEW_TEMPLATES);
  });
});
