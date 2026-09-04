import { slugify, translateRisk, buildDinGeoUrl } from '../dingeo';

describe('slugify', () => {
  it('lowercases and hyphenates whitespace', () => {
    expect(slugify('Morelvej 84')).toBe('morelvej-84');
    expect(slugify('  Kongens   Nytorv  ')).toBe('kongens-nytorv');
  });
});

describe('translateRisk', () => {
  it('maps known Danish risk labels to English', () => {
    expect(translateRisk('meget lav')).toBe('Very Low');
    expect(translateRisk('lav')).toBe('Low');
    expect(translateRisk('moderat')).toBe('Moderate');
    expect(translateRisk('middel')).toBe('Moderate');
    expect(translateRisk('høj')).toBe('High');
    expect(translateRisk('meget høj')).toBe('Very High');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(translateRisk('  MEGET LAV ')).toBe('Very Low');
  });

  it('capitalises unknown labels instead of dropping them', () => {
    expect(translateRisk('ukendt')).toBe('Ukendt');
  });

  it('returns undefined for empty input', () => {
    expect(translateRisk(undefined)).toBeUndefined();
    expect(translateRisk('')).toBeUndefined();
  });
});

describe('buildDinGeoUrl', () => {
  it('builds the two-segment address URL', () => {
    expect(buildDinGeoUrl('Morelvej 84, 5250 Odense SV', '5250', 'Odense SV')).toBe(
      'https://www.dingeo.dk/adresse/5250-odense-sv/morelvej-84/'
    );
  });

  it('uses only the street+number segment before the comma', () => {
    expect(buildDinGeoUrl('Vestergade 12, 3.tv, 8000 Aarhus', '8000', 'Aarhus')).toBe(
      'https://www.dingeo.dk/adresse/8000-aarhus/vestergade-12/'
    );
  });

  it('maps the English city name Copenhagen back to København', () => {
    expect(buildDinGeoUrl('Nørrebrogade 1, 2200 Copenhagen', '2200', 'Copenhagen')).toBe(
      'https://www.dingeo.dk/adresse/2200-københavn/nørrebrogade-1/'
    );
  });

  it('returns null when postal code or city is missing', () => {
    expect(buildDinGeoUrl('Morelvej 84', null, 'Odense')).toBeNull();
    expect(buildDinGeoUrl('Morelvej 84', '5250', null)).toBeNull();
  });

  it('returns null when there is no street segment', () => {
    expect(buildDinGeoUrl('', '5250', 'Odense')).toBeNull();
  });
});
