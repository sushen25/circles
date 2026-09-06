import type { ReactNode } from 'react';

/**
 * `react-native-svg` ships Fabric codegen specs that neither jsdom nor Vitest
 * can load, and Metro picks its web build by platform extension in a way Vitest
 * cannot follow. Rendering the real library is not what these tests are about:
 * they check that a component shows an icon at all — that selection is never
 * signalled by colour alone — so a stub that emits real `<svg>` elements
 * answers exactly that question.
 */
type AnyProps = Record<string, unknown> & { children?: ReactNode };

export default function Svg({ children, ...props }: AnyProps) {
  return (
    <svg {...(props as object)} data-testid="icon">
      {children}
    </svg>
  );
}

export function Path(props: AnyProps) {
  return <path {...(props as object)} />;
}

export function Circle(props: AnyProps) {
  return <circle {...(props as object)} />;
}

export function Rect(props: AnyProps) {
  return <rect {...(props as object)} />;
}
