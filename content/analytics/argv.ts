/**
 * npm swallows a bare `--flag` typed after `npm run <script>`: it becomes
 * npm_config_<flag> in the script's environment (dashes to underscores; a
 * flag typed without a value arrives as 'true') and is not passed on. So
 * `npm run posted tiktok x y --dry` runs the script without --dry, and
 * `--at <iso>` leaves the time behind as a stray positional. `npm run
 * posted -- …` passes everything through. What is here reads the swallowed
 * flags back, so a call still does what was typed, and the command prints
 * one note about the `--`.
 */

export type Env = Record<string, string | undefined>;

export type SwallowedFlag = {
  name: string;
  /** takes no value: npm records it as 'true' */
  boolean?: boolean;
  /** npm's own spelling, when it rewrites the flag into one of its configs: `--dry` becomes `--dry-run` */
  alias?: string;
};

/** The value npm recorded for `--<name>`: 'true' for a bare flag, the value for `--<name>=<value>`, undefined when it was not swallowed. */
export function swallowed(name: string, env: Env): string | undefined {
  const v = env[`npm_config_${name.replace(/-/g, '_')}`];
  return v === undefined || v === '' ? undefined : v;
}

/**
 * argv with the swallowed flags put back as if `--` had been typed: a boolean
 * flag as `--name`; a value flag typed `--name=value` as `--name value`; one
 * typed `--name value` as a bare `--name`, its value having gone to the
 * positionals, where the command's own parser refuses it. `restored` names
 * what was put back, for the note.
 */
export function restoreSwallowed(argv: string[], flags: SwallowedFlag[], env: Env): { argv: string[]; restored: string[] } {
  const out = [...argv];
  const restored: string[] = [];
  for (const f of flags) {
    const v = swallowed(f.name, env) ?? (f.alias ? swallowed(f.alias, env) : undefined);
    if (v === undefined) continue;
    if (f.boolean) {
      if (v !== 'true') continue;
      out.push(`--${f.name}`);
    } else out.push(`--${f.name}`, ...(v === 'true' ? [] : [v]));
    restored.push(`--${f.name}`);
  }
  return { argv: out, restored };
}

/** The one line a command prints when it had to read flags back from npm. */
export const dashDashNote = (restored: string[]): string => `note  put -- after the script name; read ${restored.join(', ')} from npm`;
