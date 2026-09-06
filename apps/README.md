# apps/

`apps/app` — the Expo universal app (SDK 57, Expo Router, `web.output: "server"`)
— is created in **S0-02**. It is left out of this scaffold deliberately: the
workspace, the TypeScript base config and the lint boundaries land first, so the
app is created inside rules that already exist.

The lint boundaries for its internal layers (`app/` routes, `src/features`,
`src/components`, `src/data`, `src/platform`, `src/copy`, `src/analytics`) are
already declared in `eslint.config.mjs`, including the rule that `data` and
`platform` never import `features` (architecture §7.2).
