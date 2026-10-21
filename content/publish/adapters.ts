/**
 * One thin function per platform. Each takes the caption and the slide
 * images and returns the remote post id. No retries, no cleverness: if a
 * platform fails, the run prints the error and the item stays unpublished
 * for that platform, so the next run tries again.
 *
 * Instagram and Threads need the images at a public URL (they fetch them
 * server-side). Set MEDIA_BASE_URL to the bucket (R2/S3) that serves `out/`;
 * renders are git-ignored in the monorepo, so the repo is never the host.
 * Bluesky and LinkedIn take uploads directly. Where the piece has an MP4,
 * Bluesky, Threads and Instagram post it instead of the stills (Threads and
 * Instagram by URL, Bluesky by upload). YouTube takes the MP4 as a
 * resumable upload; TikTok takes it (or JPEG stills by URL) as a draft in
 * the founder's inbox, never as a post (ADR 0086).
 */
import { readFileSync } from 'node:fs';
import { setEnvLine } from './envfile.ts';
import { youtubeAccessToken } from './youtube-token.ts';
import type { Caption } from '../lib/queue.ts';

export type Media = {
  localPaths: string[];
  publicUrls: string[];
  /** the piece's MP4 at a public URL, when rendered and MEDIA_BASE_URL is set */
  videoUrl?: string;
  /** the piece's MP4 on disk, when rendered (`npm run video`) */
  videoPath?: string;
  /** the JPEG stills at a public URL, when rendered and MEDIA_BASE_URL is set; TikTok photo posts take JPEG or WebP, not PNG */
  photoUrls?: string[];
};
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

/** Swapped out by the tests so polling does not wait. */
export const clock = { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

/* ---------------------------------------------------------------- Bluesky */

const BSKY_VIDEO = 'https://video.bsky.app/xrpc';

/** What the video upload needs from a signed-in agent; the tests pass a fake. */
export type BskyVideoSession = { did: string; pdsHost: string; serviceToken: (aud: string, lxm: string) => Promise<string> };

type BskyJobStatus = { jobId: string; state: string; blob?: unknown; error?: string; message?: string };

/**
 * Bluesky's recommended route for video: upload to the video service with a
 * service token for our PDS, wait for it to process, and post the blob it
 * returns, so the post never appears with a missing video. The account's
 * email must be verified, and Bluesky caps video uploads per day.
 * Returns the blob ref as JSON (the caller turns it into a BlobRef).
 */
export async function bskyVideoBlob(session: BskyVideoSession, path: string): Promise<unknown> {
  const bytes = readFileSync(path);
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error(`${path} is over Bluesky's 100 MB video limit`);
  const token = await session.serviceToken(`did:web:${session.pdsHost}`, 'com.atproto.repo.uploadBlob');

  const url = new URL(`${BSKY_VIDEO}/app.bsky.video.uploadVideo`);
  url.searchParams.set('did', session.did);
  url.searchParams.set('name', path.split('/').pop()!);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.byteLength) },
    body: bytes,
  });
  const body = (await res.json().catch(() => ({}))) as { jobStatus?: BskyJobStatus; jobId?: string; error?: string; message?: string } & Partial<BskyJobStatus>;
  // A video already processed comes back as an error that still names its job.
  const job: Partial<BskyJobStatus> = body.jobStatus ?? body;
  if (!res.ok && !job.jobId) throw new Error(`Bluesky video upload failed: ${res.status} ${body.error ?? ''} ${body.message ?? ''}`);
  if (job.blob) return job.blob;

  for (let i = 0; i < 120; i++) {
    await clock.sleep(2_000);
    const st = await json<{ jobStatus: BskyJobStatus }>(
      await fetch(`${BSKY_VIDEO}/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(job.jobId!)}`),
    );
    if (st.jobStatus.blob) return st.jobStatus.blob;
    if (st.jobStatus.state === 'JOB_STATE_FAILED') throw new Error(`Bluesky video processing failed: ${st.jobStatus.error ?? ''} ${st.jobStatus.message ?? ''}`);
  }
  throw new Error(`Bluesky video job ${job.jobId} still processing after 4 minutes`);
}

export const bluesky: Adapter = async (caption, media) => {
  const { BskyAgent, RichText, jsonToLex } = await import('@atproto/api');
  const agent = new BskyAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier: env('BSKY_HANDLE'), password: env('BSKY_APP_PASSWORD') });

  const rt = new RichText({ text: caption.text });
  await rt.detectFacets(agent);

  let embed: Record<string, unknown> | undefined;
  if (media.videoPath) {
    const blob = await bskyVideoBlob(
      {
        did: agent.session!.did,
        pdsHost: agent.dispatchUrl.host,
        serviceToken: async (aud, lxm) =>
          (await agent.com.atproto.server.getServiceAuth({ aud, lxm, exp: Math.floor(Date.now() / 1000) + 30 * 60 })).data.token,
      },
      media.videoPath,
    );
    embed = { $type: 'app.bsky.embed.video', video: jsonToLex(blob), alt: caption.text.slice(0, 1000), aspectRatio: { width: 1080, height: 1920 } };
  } else if (media.localPaths.length) {
    const images = [];
    for (const p of media.localPaths.slice(0, 4)) {
      const bytes = readFileSync(p);
      if (bytes.byteLength > 1_000_000) throw new Error(`${p} is over Bluesky's 1 MB image limit`);
      const up = await agent.uploadBlob(bytes, { encoding: 'image/png' });
      images.push({ image: up.data.blob, alt: caption.text.slice(0, 300), aspectRatio: { width: 1080, height: 1920 } });
    }
    embed = { $type: 'app.bsky.embed.images', images };
  }

  const res = await agent.post({
    text: rt.text,
    facets: rt.facets,
    langs: ['en-AU'],
    ...(embed ? { embed } : {}),
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
  if (media.videoUrl) {
    containerId = (await create({ media_type: 'VIDEO', video_url: media.videoUrl, text })).id;
  } else if (media.publicUrls.length === 0) {
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

  if (media.videoUrl) {
    // Threads fetches and processes a video before it can be published.
    for (let i = 0; ; i++) {
      const st = await json<{ status: string; error_message?: string }>(
        await fetch(`https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${token}`),
      );
      if (st.status === 'FINISHED') break;
      if (st.status === 'ERROR' || st.status === 'EXPIRED') throw new Error(`Threads container ${st.status}: ${st.error_message ?? ''}`);
      if (i >= 40) throw new Error(`Threads container ${containerId} still ${st.status} after 200 s`);
      await clock.sleep(5_000);
    }
  } else {
    // Threads asks for a pause before publishing a container.
    await clock.sleep(15_000);
  }
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

/* ---------------------------------------------------------------- YouTube */

export const YOUTUBE_PRIVACY = ['private', 'unlisted', 'public'] as const;

/**
 * Uploads from an API project Google has not audited are locked to private
 * whatever is asked for, so private is the default until the audit passes;
 * then set YOUTUBE_PRIVACY=public.
 */
export function youtubePrivacy(): (typeof YOUTUBE_PRIVACY)[number] {
  const v = (process.env.YOUTUBE_PRIVACY || 'private').trim();
  if (!(YOUTUBE_PRIVACY as readonly string[]).includes(v)) throw new Error(`YOUTUBE_PRIVACY "${v}" is not one of ${YOUTUBE_PRIVACY.join(', ')}`);
  return v as (typeof YOUTUBE_PRIVACY)[number];
}

/**
 * The MP4 as a Short: vertical and under three minutes is all YouTube asks.
 * The caption's `title:` line is the title, the tagged text the description.
 * One resumable session, one PUT: the file is a few MB.
 */
export const youtube: Adapter = async (caption, media) => {
  if (!media.videoPath) throw new Error('YouTube needs the MP4; run npm run video');
  if (!caption.title) throw new Error('the ## youtube caption has no title: line');
  const token = await youtubeAccessToken();
  const bytes = readFileSync(media.videoPath);

  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(bytes.byteLength),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify({
      snippet: { title: caption.title, description: withTags(caption), categoryId: '22', defaultLanguage: 'en-AU' },
      status: { privacyStatus: youtubePrivacy(), selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) throw new Error(`YouTube upload session failed: ${init.status} ${(await init.text()).slice(0, 400)}`);
  const session = init.headers.get('location');
  if (!session) throw new Error('YouTube returned no upload session URL');

  const done = await json<{ id: string }>(
    await fetch(session, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.byteLength) },
      body: bytes,
    }),
  );
  return done.id;
};

/* ----------------------------------------------------------------- TikTok */

/**
 * Upload mode only (scope video.upload, post_mode MEDIA_UPLOAD): the piece
 * lands in the founder's TikTok inbox as a draft, and the founder adds a
 * sound and taps Post. Direct Post is never used (ADR 0086). Returns the
 * publish_id, which the ledger records as "drafted".
 */
const TIKTOK = 'https://open.tiktokapis.com/v2';

type TikTokEnvelope<T> = { data: T; error: { code: string; message?: string; log_id?: string } };

async function tiktokCall<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${TIKTOK}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const out = await json<TikTokEnvelope<T>>(res);
  if (out.error?.code !== 'ok') throw new Error(`TikTok ${path}: ${out.error?.code} ${out.error?.message ?? ''}`);
  return out.data;
}

export type TikTokToken = { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; open_id: string; scope: string };

export async function tiktokToken(params: Record<string, string>): Promise<TikTokToken> {
  const res = await fetch(`${TIKTOK}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'), ...params }),
  });
  const tok = await json<TikTokToken & { error?: string; error_description?: string }>(res);
  if (!tok.access_token) throw new Error(`TikTok token: ${tok.error ?? 'no access_token'} ${tok.error_description ?? ''}`);
  return tok;
}

/**
 * Access tokens last a day, so every run trades the refresh token (a year)
 * for a fresh one. TikTok may rotate the refresh token as it does; a rotated
 * one is written back to a local .env, or flagged for the CI secret.
 */
async function tiktokAccessToken(): Promise<string> {
  const current = env('TIKTOK_REFRESH_TOKEN');
  const tok = await tiktokToken({ grant_type: 'refresh_token', refresh_token: current });
  if (tok.refresh_token && tok.refresh_token !== current) {
    process.env.TIKTOK_REFRESH_TOKEN = tok.refresh_token;
    console.warn(
      setEnvLine('TIKTOK_REFRESH_TOKEN', tok.refresh_token)
        ? 'TikTok rotated the refresh token; .env updated'
        : 'TikTok rotated the refresh token; run npm run auth:tiktok and update the TIKTOK_REFRESH_TOKEN secret',
    );
  }
  return tok.access_token;
}

/** TikTok's chunk rules: 5–64 MB chunks, the remainder folded into the last; anything up to 64 MB goes whole. */
export function tiktokChunks(size: number): { chunkSize: number; count: number } {
  const MB = 1024 * 1024;
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

/** Polls until TikTok has handed the draft to the inbox. A slow one is left to finish on its own. */
async function tiktokSettle(token: string, publishId: string): Promise<void> {
  for (let i = 0; i < 24; i++) {
    const st = await tiktokCall<{ status: string; fail_reason?: string }>('/post/publish/status/fetch/', token, { publish_id: publishId });
    if (st.status === 'SEND_TO_USER_INBOX' || st.status === 'PUBLISH_COMPLETE') return;
    if (st.status === 'FAILED') throw new Error(`TikTok draft ${publishId} failed: ${st.fail_reason ?? 'no reason given'}`);
    await clock.sleep(5_000);
  }
  console.warn(`TikTok draft ${publishId} still processing; it lands in the inbox when done`);
}

export const tiktok: Adapter = async (caption, media) => {
  const token = await tiktokAccessToken();
  let publishId: string;

  if (media.photoUrls?.length) {
    // Photo mode: TikTok pulls the stills from the verified MEDIA_BASE_URL domain.
    const d = await tiktokCall<{ publish_id: string }>('/post/publish/content/init/', token, {
      post_info: { description: withTags(caption).slice(0, 4000) },
      source_info: { source: 'PULL_FROM_URL', photo_images: media.photoUrls.slice(0, 35), photo_cover_index: 0 },
      post_mode: 'MEDIA_UPLOAD',
      media_type: 'PHOTO',
    });
    publishId = d.publish_id;
  } else if (media.videoPath) {
    // Video: an inbox upload carries no caption; publish.ts prints it for pasting.
    const bytes = readFileSync(media.videoPath);
    const size = bytes.byteLength;
    const { chunkSize, count } = tiktokChunks(size);
    const d = await tiktokCall<{ publish_id: string; upload_url: string }>('/post/publish/inbox/video/init/', token, {
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count },
    });
    for (let i = 0; i < count; i++) {
      const first = i * chunkSize;
      const last = i === count - 1 ? size - 1 : first + chunkSize - 1;
      const put = await fetch(d.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(last - first + 1), 'Content-Range': `bytes ${first}-${last}/${size}` },
        body: bytes.subarray(first, last + 1),
      });
      if (!put.ok) throw new Error(`TikTok chunk ${i + 1}/${count} failed: ${put.status} ${(await put.text()).slice(0, 400)}`);
    }
    publishId = d.publish_id;
  } else {
    throw new Error('TikTok needs the MP4 (npm run video) or JPEG stills at MEDIA_BASE_URL');
  }

  await tiktokSettle(token, publishId);
  return publishId;
};

export const adapters: Record<string, Adapter> = { bluesky, threads, instagram, linkedin, youtube, tiktok };
