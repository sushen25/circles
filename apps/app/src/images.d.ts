/**
 * Metro resolves an imported PNG to an image source (a module id on native, a
 * URL on web). Only the development brand page imports one today.
 */
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}
