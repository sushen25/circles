/**
 * Font files are resolved by the bundler (Metro on native and web), which hands
 * back an opaque asset handle. TypeScript only needs to know they are modules.
 */
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
