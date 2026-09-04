jest.mock('../../server', () => ({ pool: { query: jest.fn() } }));

import {
  decodeEscapes,
  extractField,
  parseListingsFromHtml,
  matchesArea,
  PROPERTY_TYPE_MAP,
} from '../boligsiden';

describe('decodeEscapes', () => {
  it('decodes escaped ampersands, quotes and backslashes', () => {
    expect(decodeEscapes('Rugvej 3 \\u0026 4')).toBe('Rugvej 3 & 4');
    expect(decodeEscapes('say \\"hi\\"')).toBe('say "hi"');
    expect(decodeEscapes('path\\\\to')).toBe('path\\to');
  });
});

describe('extractField', () => {
  it('returns the first capture group when matched', () => {
    expect(extractField('"caseID":"abc-1"', /"caseID":"([^"]+)"/)).toBe('abc-1');
  });

  it('returns undefined when there is no match', () => {
    expect(extractField('no fields here', /"caseID":"([^"]+)"/)).toBeUndefined();
  });
});

describe('PROPERTY_TYPE_MAP', () => {
  it('normalises Boligsiden address types to HomeRadar property types', () => {
    expect(PROPERTY_TYPE_MAP.villa).toBe('house');
    expect(PROPERTY_TYPE_MAP.condo).toBe('apartment');
    expect(PROPERTY_TYPE_MAP.terracedHouse).toBe('townhouse');
    expect(PROPERTY_TYPE_MAP.cottage).toBe('summer_house');
    expect(PROPERTY_TYPE_MAP.cooperative).toBe('apartment');
  });
});

describe('matchesArea', () => {
  it('matches a numeric postal-code prefix against the zip code', () => {
    expect(matchesArea('5250', 'Odense SV', '5250')).toBe(true);
    expect(matchesArea('52', 'Odense SV', '5250')).toBe(true);
    expect(matchesArea('5250', 'Aarhus', '8000')).toBe(false);
  });

  it('matches a city name against the start of the listing city', () => {
    expect(matchesArea('Odense', 'Odense SV', '5250')).toBe(true);
    expect(matchesArea('odense', 'Odense SV', '5250')).toBe(true);
    expect(matchesArea('Aarhus', 'Odense SV', '5250')).toBe(false);
  });

  it('resolves the Copenhagen -> København alias', () => {
    expect(matchesArea('Copenhagen', 'København K', '1050')).toBe(true);
  });

  it('returns false for empty or whitespace areas', () => {
    expect(matchesArea('', 'Odense', '5000')).toBe(false);
    expect(matchesArea('   ', 'Odense', '5000')).toBe(false);
  });
});

describe('parseListingsFromHtml', () => {
  const marker = '"address":{"_links":{"self":{"href":"/addresses/';

  const listing = (over: Record<string, string>) =>
    `${marker}${over.href || 'a'}"}}},` +
    `"caseID":"${over.caseID}","slugAddress":"${over.slugAddress}",` +
    `"roadName":"${over.roadName}","houseNumber":"${over.houseNumber ?? '1'}",` +
    `"zipCode":${over.zipCode},"cityName":"${over.cityName}","addressType":"villa",` +
    `"coordinates":{"lat":55.4,"lon":10.4},"housingArea":140,"numberOfRooms":5,` +
    `${over.priceCash ? `"priceCash":${over.priceCash},` : ''}"yearBuilt":1965`;

  it('parses a complete listing block', () => {
    const html =
      'PAGE_CHROME' +
      listing({
        caseID: 'case-1',
        slugAddress: 'morelvej-84-5250-odense-sv',
        roadName: 'Morelvej',
        houseNumber: '84',
        zipCode: '5250',
        cityName: 'Odense SV',
        priceCash: '3495000',
      });

    const [l] = parseListingsFromHtml(html);
    expect(l.caseId).toBe('case-1');
    expect(l.roadName).toBe('Morelvej');
    expect(l.houseNumber).toBe('84');
    expect(l.zipCode).toBe('5250');
    expect(l.cityName).toBe('Odense SV');
    expect(l.priceCash).toBe(3495000);
    expect(l.numberOfRooms).toBe(5);
    expect(l.housingArea).toBe(140);
    expect(l.lat).toBeCloseTo(55.4);
  });

  it('skips blocks missing a required field (no price)', () => {
    const html =
      'PAGE_CHROME' +
      listing({
        caseID: 'case-2',
        slugAddress: 'x',
        roadName: 'Testvej',
        zipCode: '8000',
        cityName: 'Aarhus',
      });
    expect(parseListingsFromHtml(html)).toHaveLength(0);
  });

  it('deduplicates repeated case IDs, keeping the first', () => {
    const one = listing({
      caseID: 'dupe', slugAddress: 's', roadName: 'R', zipCode: '5000', cityName: 'Odense', priceCash: '1000000',
    });
    const listings = parseListingsFromHtml('CHROME' + one + one);
    expect(listings).toHaveLength(1);
    expect(listings[0].caseId).toBe('dupe');
  });

  it('returns an empty array when no marker is present', () => {
    expect(parseListingsFromHtml('just some page chrome')).toHaveLength(0);
  });
});
