import { EN_SHARE_TEMPLATES, newPlanMessage, waitingMessage } from '@circles/domain';

/**
 * What an organiser pastes into the group chat to chase a plan that is still
 * taking answers (SUS-132): the domain's waiting message, a count and never
 * names, because a message in a chat is read by everyone.
 *
 * With nobody left to chase the plan is still open to changes of mind, and
 * "waiting on 0 replies" would be wrong; the link goes out as the ask it
 * already was.
 */
export function reminderMessage(input: {
  remaining: number;
  circleName: string;
  url: string;
}): string {
  if (input.remaining <= 0) {
    return newPlanMessage({
      circleName: input.circleName,
      url: input.url,
      templates: EN_SHARE_TEMPLATES,
    });
  }
  return waitingMessage({
    remaining: input.remaining,
    url: input.url,
    templates: EN_SHARE_TEMPLATES,
  });
}
