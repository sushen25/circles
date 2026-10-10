/**
 * `expo-asset` under Vitest: the module number from `font-assets-stub.ts`
 * resolved to the hashed URL a bundler would have given it. Only what the
 * middleware reads.
 */
import { STUB_FONT_URLS, fontAssets } from './font-assets-stub';

const urlOf = new Map<number, string>(
  (Object.keys(fontAssets) as (keyof typeof fontAssets)[]).map((face) => [
    fontAssets[face],
    STUB_FONT_URLS[face],
  ]),
);

export const Asset = {
  fromModule(id: number): { uri: string } {
    const uri = urlOf.get(id);
    if (uri === undefined) throw new Error(`expo-asset stub: no asset ${id}`);
    return { uri };
  },
};
