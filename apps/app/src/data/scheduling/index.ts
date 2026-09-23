/**
 * What the group's options are, and what the organiser can do about them when
 * there are none (spec §5.6, S1-27).
 */
export {
  closeAttempt,
  lowerQuorum,
  previewQuorum,
  previewWiderWindow,
  widenWindow,
} from './actions';
export { planCandidates, reasonOf, viewOf } from './candidates';
export type {
  CandidateRow,
  CandidateSetRead,
  PlanCandidates,
  RosterMember,
  SchedulingView,
} from './candidates';
