import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { brand } from '@circles/config';

import mark from '../../assets/brand/wenna-mark.svg?raw';
import markSmall from '../../assets/brand/wenna-mark-small.svg?raw';
import { BrandLockup, BrandMark, MARK } from './Brand';

/** Every `<rect …>` in a master, as its attributes. */
function rects(svg: string): Record<string, string>[] {
  return [...svg.matchAll(/<rect ([^>]*)\/>/g)].map(([, attributes = '']) =>
    Object.fromEntries([...attributes.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
  );
}

describe('BrandMark', () => {
  it.each([
    ['wenna-mark.svg', mark, MARK.dots.regular],
    ['wenna-mark-small.svg', markSmall, MARK.dots.small],
  ])('draws what %s draws', (_file, svg, dots) => {
    const shapes = rects(svg);
    const { x, y, width, height, rx } = MARK.lozenge;
    for (const shape of shapes) {
      expect(shape).toMatchObject({
        x: `${x}`,
        y: `${y}`,
        width: `${width}`,
        height: `${height}`,
        rx: `${rx}`,
      });
    }
    const angle = (shape: Record<string, string>) =>
      Number(/rotate\((\d+) /.exec(shape['transform'] ?? '')?.[1]);
    const seats = shapes.filter((shape) => shape['fill'] !== 'none');
    const open = shapes.filter((shape) => shape['fill'] === 'none');
    expect(seats.map(angle)).toEqual([...MARK.seats]);
    expect(open.map(angle)).toEqual([MARK.open]);
    expect(open[0]).toMatchObject({
      'stroke-width': `${dots.width}`,
      'stroke-dasharray': dots.dash,
    });
  });

  it('switches to the heavier dots at small sizes, so the open seat survives a tab', () => {
    const { container } = render(
      <>
        <BrandMark size={16} />
        <BrandMark size={48} />
      </>,
    );
    const outlines = Array.from(container.querySelectorAll('rect[fill="none"]'));
    expect(outlines.map((outline) => outline.getAttribute('stroke-width'))).toEqual([
      `${MARK.dots.small.width}`,
      `${MARK.dots.regular.width}`,
    ]);
  });
});

describe('BrandLockup', () => {
  it('is one heading named for the product, with the wordmark in lower case', () => {
    render(<BrandLockup />);

    expect(screen.getByRole('heading', { name: brand.name })).toBeInTheDocument();
    expect(screen.getByText(brand.name.toLowerCase())).toBeInTheDocument();
    expect(screen.queryByText(brand.descriptor)).toBeNull();
  });

  it('carries the descriptor beneath when asked', () => {
    render(<BrandLockup descriptor />);

    expect(screen.getByText(brand.descriptor)).toBeInTheDocument();
  });
});
