import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { color } from '@circles/tokens';

/**
 * One icon family, drawn rather than imported, lifted from `docs/design/gen.py`
 * so the app and the canvas render the same shapes. Stroke 1.7 on a 24 grid,
 * round caps and joins (manifesto §5.4).
 *
 * Never an emoji. Icons are decorative here: they sit beside text that carries
 * the meaning, so they are hidden from screen readers.
 */
export type IconName =
  | 'back'
  | 'chevron'
  | 'check'
  | 'share'
  | 'calendar'
  | 'shield'
  | 'clock'
  | 'plus'
  | 'x'
  | 'link'
  | 'mail'
  | 'pin'
  | 'gear'
  | 'eye-off'
  | 'people'
  | 'wifi-off';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
};

export function Icon({ name, size = 20, color: stroke = color.ink }: Props) {
  const common = {
    stroke,
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {paths[name].map((d, i) =>
        typeof d === 'string' ? (
          <Path key={i} d={d} {...common} />
        ) : d.kind === 'circle' ? (
          <Circle key={i} cx={d.cx} cy={d.cy} r={d.r} {...common} />
        ) : (
          <Rect key={i} x={d.x} y={d.y} width={d.width} height={d.height} rx={d.rx} {...common} />
        ),
      )}
    </Svg>
  );
}

type Shape =
  | string
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number };

const paths: Record<IconName, Shape[]> = {
  back: ['M12.5 4.5 5 12l7.5 7.5'],
  chevron: ['M8 4.5 15.5 12 8 19.5'],
  check: ['M4.5 12.5 9.5 17.5 19.5 7'],
  share: ['M12 3.5v11M7.5 8 12 3.5 16.5 8M5 12.5v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6'],
  calendar: [
    { kind: 'rect', x: 3.5, y: 5, width: 17, height: 15.5, rx: 2.5 },
    'M3.5 10h17M8 3v4M16 3v4',
  ],
  shield: ['M12 3.5 5 6.5v5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9v-5z', 'M9.5 12l1.8 1.8L15 10'],
  clock: [{ kind: 'circle', cx: 12, cy: 12, r: 8.5 }, 'M12 7.5V12l3 2'],
  plus: ['M12 5v14M5 12h14'],
  x: ['M6 6l12 12M18 6 6 18'],
  link: [
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2',
    'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2',
  ],
  mail: [{ kind: 'rect', x: 3.5, y: 5.5, width: 17, height: 13, rx: 2.5 }, 'm4 7 8 6 8-6'],
  pin: [
    'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z',
    { kind: 'circle', cx: 12, cy: 10, r: 2.3 },
  ],
  gear: [
    { kind: 'circle', cx: 12, cy: 12, r: 3 },
    'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  ],
  'eye-off': [
    'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M7.4 7.5C4.6 9.2 3 12 3 12s3.5 6 9 6c1.7 0 3.2-.5 4.5-1.2M10 6.2C10.6 6.1 11.3 6 12 6c5.5 0 9 6 9 6s-.8 1.4-2.3 2.9',
  ],
  people: [
    { kind: 'circle', cx: 9, cy: 8.5, r: 3.2 },
    'M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5',
    { kind: 'circle', cx: 16.5, cy: 9.5, r: 2.5 },
    'M15.5 14.2c2.6.2 5 2 5 4.8',
  ],
  'wifi-off': [
    'M3 3l18 18M8.5 8.8A11 11 0 0 0 2.5 11M21.5 11a11 11 0 0 0-8-3.1M5.5 14.5a7 7 0 0 1 4.3-2.1M18.5 14.5a7 7 0 0 0-3.2-1.9M8.5 17.5a3.5 3.5 0 0 1 4.7-.5',
    { kind: 'circle', cx: 12, cy: 20, r: 1 },
  ],
};
