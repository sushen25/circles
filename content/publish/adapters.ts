/**
 * One thin function per platform. Each takes the caption and the slide
 * images and returns the remote post id. No retries, no cleverness: if a
 * platform fails, the run prints the error and the item stays unpublished
 * for that platform, so the next run tries again.
 *
 * Instagram and Threads need the images at a public URL (they fetch them
 * server-side). Set MEDIA_BASE_URL to the bucket (R2/S3) that serves `out/`;
 * renders are git-ignored in the monorepo, so the repo is never the host.
 * Bluesky and LinkedIn take uploads directly.
 */
import { readFileSync } from 'node:fs';
import type { Caption } from '../lib/queue.ts';

export type Media = { localPaths: string[]; publicUrls: string[]; /** the piece's MP4 at a public URL, when rendered and MEDIA_BASE_URL is set */ videoUrl?: string };
export type Adapter = (caption: Caption, media: Media) => Promise<string>;

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const withTags = (c: Caption) => (c.hashtags.length ? `${c.text}\n\n${c.hashtags.join(' ')}` : c.text);

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

/* ---------------------------------------------------------------- Bluesky */

export const bluesky: Adapter = async (caption, media) => {
  const { BskyAgent, RichText } = await import('@atproto/api');
  const agent = new BskyAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier: env('BSKY_HANDLE'), password: env('BSKY_APP_PASSWORD') });

  const rt = new RichText({ text: caption.text });
  await rt.detectFacets(agent);

  const images = [];
  for (const p of media.localPaths.slice(0, 4)) {
    const bytes = readFileSync(p);
    if (bytes.byteLength > 1_000_000) throw new Error(`${p} is over Bluesky's 1 MB image limit`);
    const up = await agent.uploadBlob(bytes, { encoding: 'image/png' });
    images.push({ image: up.data.blob, alt: caption.text.slice(0, 300), aspectRatio: { width: 1080, height: 1920 } });
  }

  const res = await agent.post({
    text: rt.text,
    facets: rt.facets,
    langs: ['en-AU'],
    ...(images.length ? { embed: { $type: 'app.bsky.embed.images', images } } : {}),
    createdAt: new Date().toISOString(),
  });
  return res.uri;
};

/* ---------------------------------------------------------------- Threads */

export const threads: Adapter = async (caption, media) => {
  const token = env('THREADS_ACCESS_TOKEN');
  const user = env('THREADS_USER_ID');
  const base = `https://graph.threads.net/v1.0/${user}`;
  const text = withTags(caption);

  const create = async (params: Record<string, string>) =>
    json<{ id: string }>(
      await fetch(`${base}/threads`, {
        method: 'POST',
        body: new URLSearchParams({ ...params, access_token: token }),
      }),
    );

  let containerId: string;
  if (media.publicUrls.length === 0) {
    containerId = (await create({ media_type: 'TEXT', text })).id;
  } else if (media.publicUrls.length === 1) {
    containerId = (await create({ media_type: 'IMAGE', image_url: media.publicUrls[0], text })).id;
  } else {
    const children: string[] = [];
    for (const url of media.publicUrls.slice(0, 20)) {
      children.push((await create({ media_type: 'IMAGE', image_url: url, is_carousel_item: 'true' })).id);
    }
    containerId = (await create({ media_type: 'CAROUSEL', children: children.join(','), text })).id;
  }

  // Threads asks for a pause before publishing a container.
  await new Promise((r) => setTimeout(r, 15_000));
  const pub = await json<{ id: string }>(
    await fetch(`${base}/threads_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: containerId, access_token: token }),
    }),
  );
  return pub.id;
};

/* -------------------------------------------------------------- Instagram */

/**
 * Posts the MP4 as a Reel when one exists (9:16 is what Reels want; feed
 * images are capped at 4:5, so the slides are not posted as a carousel).
 * Tokens from "Instagram Login" (IGAA…) go to graph.instagram.com; tokens
 * from Facebook Login go to graph.facebook.com. Override with IG_GRAPH_HOST.
 */
export const instagram: Adapter = async (caption, media) => {
  const token = env('IG_ACCESS_TOKEN');
  const user = env('IG_USER_ID');
  const host = process.env.IG_GRAPH_HOST || (token.startsWith('IG') ? 'graph.instagram.com' : 'graph.facebook.com');
  const base = `https://${host}/v21.0/${user}`;
  const text = withTags(caption);

  const create = async (params: Record<string, string>) =>
    json<{ id: string }>(
      await fetch(`${base}/media`, {
        method: 'POST',
        body: new URLSearchParams({ ...params, access_token: token }),
      }),
    );

  let containerId: string;
  if (media.videoUrl) {
    containerId = (await create({ media_type: 'REELS', video_url: media.videoUrl, caption: text, share_to_feed: 'true' })).id;
  } else if (media.publicUrls.length === 1) {
    containerId = (await create({ image_url: media.publicUrls[0], caption: text })).id;
  } else if (media.publicUrls.length > 1) {
    const children: string[] = [];
    for (const url of media.publicUrls.slice(0, 10)) {
      children.push((await create({ image_url: url, is_carousel_item: 'true' })).id);
    }
    containerId = (await create({ media_type: 'CAROUSEL', children: children.join(','), caption: text })).id;
  } else {
    throw new Error('Instagram needs a video or at least one image');
  }

  // Instagram fetches and processes the media before it can be published.
  for (let i = 0; i < 40; i++) {
    const st = await json<{ status_code: string; status?: string }>(
      await fetch(`https://${host}/v21.0/${containerId}?fields=status_code,status&access_token=${token}`),
    );
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`Instagram container ${st.status_code}: ${st.status ?? ''}`);
    await new Promise((r) => setTimeout(r, 5_000));
  }

  const pub = await json<{ id: string }>(
    await fetch(`${base}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: containerId, access_token: token }),
    }),
  );
  return pub.id;
};

/* --------------------------------------------------------------- LinkedIn */

export const linkedin: Adapter = async (caption, media) => {
  const token = env('LINKEDIN_ACCESS_TOKEN');
  const author = `urn:li:person:${env('LINKEDIN_PERSON_ID')}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': '202410',
    'Content-Type': 'application/json',
  };

  // Upload the first slide only: LinkedIn is a text-first channel for us.
  let imageUrn: string | undefined;
  if (media.localPaths[0]) {
    const init = await json<{ value: { uploadUrl: string; image: string } }>(
      await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
        method: 'POST',
        headers,
        body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
      }),
    );
    const put = await fetch(init.value.uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: readFileSync(media.localPaths[0]),
    });
    if (!put.ok) throw new Error(`LinkedIn image upload failed: ${put.status}`);
    imageUrn = init.value.image;
  }

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      author,
      commentary: withTags(caption),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      ...(imageUrn ? { content: { media: { id: imageUrn, altText: caption.text.slice(0, 300) } } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn post failed: ${res.status} ${(await res.text()).slice(0, 400)}`);
  const id = res.headers.get('x-restli-id');
  if (!id) throw new Error('LinkedIn returned no post id');
  return id;
};

export const adapters: Record<string, Adapter> = { bluesky, threads, instagram, linkedin };
