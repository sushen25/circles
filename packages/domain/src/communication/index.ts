/**
 * The communication context (architecture §6.2, §13): which message, to whom,
 * on which channel, when — and the text people paste into a group chat.
 *
 * Downstream of every other context and called by none of them: these are
 * pure rules the dispatcher consults, so the rules can be tested without Resend
 * or Expo, and the dispatcher stays a loop.
 */
export * from './kinds.js';
export * from './eligibility.js';
export * from './idempotency.js';
export * from './occurrence.js';
export * from './quiet-hours.js';
export * from './share-messages.js';
export * from './preview.js';
