import { postsOf, type FounderAnalytics } from '@circles/contracts';

import { BodyText, Card, Label, Small } from '../../components';
import { Stack } from '../../components/layout';
import { t } from '../../copy';

/**
 * The funnel by the campaign tag on the link (SUS-240): which post an
 * organiser arrived from, and how far their circle got. A tag is a label for a
 * post, never for a person, and a circle is only ever counted under it, never
 * named.
 */
export function PostsSection({ data }: { data: FounderAnalytics }) {
  const posts = postsOf(data);
  return (
    <Stack gap={10}>
      <Label>{t('founderAnalytics', 'posts')}</Label>
      <Small>{t('founderAnalytics', 'posts_detail')}</Small>
      {posts.length === 0 ? (
        <Small>{t('founderAnalytics', 'posts_empty')}</Small>
      ) : (
        <Card gap={12}>
          {/* The tag on a line of its own: a tag is long and has no spaces to break at. */}
          {posts.map((post) => (
            <Stack key={post.tag} gap={2}>
              <BodyText>{post.tag}</BodyText>
              <Small>
                {t('founderAnalytics', 'post_figure', {
                  circles: post.circles,
                  shared: post.plansShared,
                  answered: post.answered,
                  confirmed: post.confirmed,
                })}
              </Small>
            </Stack>
          ))}
        </Card>
      )}
    </Stack>
  );
}
