import type { EmailCopy } from './copy.ts';

/**
 * The organiser moved a locked-in time without asking anybody again
 * (ADR 0051). Where it is now, where it was (day *and* time, so a same-day move
 * such as "the table moved to 7:30" says what changed), and what to do if it does
 * not work: nothing is asked of anyone it already suits, which is why this is not
 * `changed`. Not held overnight, and no list of who is going, which a letter
 * cannot keep current.
 */
export function moved(p: {
  circleName: string;
  shortDate: string;
  time: string;
  previousShortDate: string;
  previousTime: string;
  placeName?: string | undefined;
  organiserName?: string | undefined;
}): EmailCopy {
  const was = `${p.previousShortDate}, ${p.previousTime}`;
  return {
    subject: `Change of plan: ${p.circleName} is now ${p.shortDate}, ${p.time}`,
    preview: `Was ${was}.`,
    paragraphs: [
      `Change of plan: ${p.circleName} is now ${p.shortDate}, ${p.time}` +
        `${p.placeName === undefined ? '' : ` at ${p.placeName}`}.`,
      `It was ${was}. ` +
        (p.organiserName === undefined ? 'The' : `${p.organiserName} moved it. The`) +
        ' plan has the details, and is the place to say if the new time does not work for you.',
    ],
    button: { label: 'Open the plan' },
  };
}
