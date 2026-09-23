import { describe, expect, it } from 'vitest';

import { mapsDevice, mapsLink } from './maps';

/** "Open in Maps" on each kind of device (S1-28, item 3). */

describe('mapsLink', () => {
  const place = { name: 'Hope St Radio' };

  it('opens Apple Maps on an iPhone', () => {
    expect(mapsLink(place, 'ios')).toBe('https://maps.apple.com/?q=Hope%20St%20Radio');
  });

  it('hands Android the geo: scheme, which offers whatever maps app is installed', () => {
    expect(mapsLink(place, 'android')).toBe('geo:0,0?q=Hope%20St%20Radio');
  });

  it('uses a Google Maps search anywhere else', () => {
    expect(mapsLink(place, 'other')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Hope%20St%20Radio',
    );
  });

  it("prefers the organiser's own link, which is the place they meant", () => {
    const url = 'https://maps.app.goo.gl/abc';
    expect(mapsLink({ ...place, url }, 'ios')).toBe(url);
  });

  it('offers nothing when there is nothing to find', () => {
    expect(mapsLink({}, 'ios')).toBeUndefined();
    expect(mapsLink({ name: '  ' }, 'other')).toBeUndefined();
  });
});

describe('mapsDevice', () => {
  it('reads the browser it is in', () => {
    expect(
      mapsDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe('ios');
    expect(mapsDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36')).toBe(
      'android',
    );
    expect(mapsDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('other');
  });
});
