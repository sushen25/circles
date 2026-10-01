/**
 * Vite's `?raw` suffix imports a file's text. Tests use it to read a vector
 * master without `node:fs`, which the component layer may not import (§7.2).
 */
declare module '*?raw' {
  const text: string;
  export default text;
}
