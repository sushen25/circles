# Content media: media.wenna.app

Where the content loop's renders are served from. Threads, Instagram and
TikTok fetch a post's media by URL, and the repository is never the host
(renders are git-ignored, ADR 0081), so `MEDIA_BASE_URL` points here.

| | |
|---|---|
| URL | `https://media.wenna.app/<slug>/` (`MEDIA_BASE_URL=https://media.wenna.app`) |
| Bucket | `wenna-media`, S3 `ap-southeast-2`, private, all public access blocked, SSE-S3 |
| CDN | CloudFront, alias `media.wenna.app`, `PriceClass_100`, HTTP redirected to HTTPS, managed `CachingOptimized` policy |
| Access | Origin access control `wenna-media-oac`; the bucket policy lets only that distribution read. A direct S3 URL answers 403. |
| Certificate | ACM in `us-east-1` for `media.wenna.app`, DNS-validated, renews itself while the validation CNAME stays in the zone |
| DNS | `A` and `AAAA` alias records for `media.wenna.app`, and ACM's `_….media.wenna.app` validation CNAME, in the `wenna.app` Route 53 zone |
| Tags | `project=wenna-content` on the bucket and the certificate |
| Set up | 21 October 2026, with the AWS CLI, in the same account as the `wenna.app` zone |

## Uploading a piece

Before approving a piece that goes to Threads, Instagram or TikTok:

```bash
cd content
npm run render queue/<file>.md   # NN.png and NN.jpg
npm run video  queue/<file>.md   # <slug>.mp4
npm run upload queue/<file>.md   # to s3://wenna-media/<slug>/
```

`npm run upload` (the AWS SDK, `content/publish/upload.ts`) reads
`S3_BUCKET=wenna-media` and `S3_REGION=ap-southeast-2` from `content/.env`, and
its credentials from the AWS CLI's profile on this machine (`AWS_PROFILE`
picks it) or from `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. It sends the
stills, the JPEGs and the MP4 with `Cache-Control: public, max-age=300`, so a
re-render under the same names reaches the platforms within five minutes,
skips any file whose MD5 already matches the object, and then checks every
public URL. `-- --dry-run` lists without sending; `-- --approved` does every
approved piece that is due. The video's `frames/`, the contact sheet and the
caption sheet stay local.

## Checking it

```bash
curl -sI https://media.wenna.app/<slug>/01.png
```

Expect `HTTP/2 200`, `content-type: image/png` and the `cache-control` above.
A missing object answers 403, not 404: CloudFront cannot list a private
bucket, so it cannot tell "missing" from "forbidden".

## TikTok

TikTok pulls photo drafts only from a domain verified in its developer
portal. `wenna.app` is verified there (21 October 2026), which covers
`media.wenna.app`, by a TXT value at the apex:
`tiktok-developers-site-verification=…`. It shares the apex TXT record with
ImprovMX's SPF line (`v=spf1 include:spf.improvmx.com ~all`), so edit that
record with both values (UPSERT), never replace it with one. Removing the
TikTok value un-verifies the domain and photo drafts stop.

## Cost

Storage and requests for a few MB a day, and egress to the platforms'
fetchers, is cents a month. The free tier covers CloudFront's first 1 TB.
