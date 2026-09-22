/**
 * Playwright's `globalSetup` for both suites: refuse to run against the other
 * suite's build.
 *
 * `reuseExistingServer` is what makes this necessary. A dev server left on the
 * port is reused rather than replaced, and a suite that quietly runs against
 * somebody else's export fails in ways that read like product bugs — ninety
 * live tests red because the app they loaded had no backend at all. Better to
 * stop before the first test, saying which build is actually there.
 *
 * Fetched over HTTP rather than read off disk, because the question is what the
 * *server* is serving: a server started before an export still holds the old
 * directory open.
 */
export default async function expectBuildMode(): Promise<void> {
  const want = process.env['EXPECTED_BUILD_MODE'];
  const url = process.env['BUILD_MODE_URL'];
  if (want === undefined || url === undefined) return;

  let found = 'none';
  try {
    const response = await fetch(url);
    if (response.ok) found = ((await response.json()) as { mode?: string }).mode ?? 'none';
  } catch {
    // Unreachable: Playwright's own web-server wait reports that better.
    return;
  }

  if (found === want) return;
  throw new Error(
    [
      `The server on ${new URL(url).host} is serving the ${found} build, not ${want}.`,
      'Both exports write to apps/app/dist, so whichever ran last owns it, and a',
      'server already on the port is reused rather than replaced.',
      '',
      `Stop whatever is serving that port — \`make dev-down\` — and run the ${want} suite again.`,
    ].join('\n'),
  );
}
