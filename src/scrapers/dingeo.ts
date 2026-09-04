import axios from 'axios';

/**
 * DinGeo Insights
 *
 * DinGeo (dingeo.dk, same parent company as Boliga) publishes free per-address
 * geodata reports — radon risk, burglary risk, cloudburst/flood risk, traffic
 * noise, school district, and an automated valuation estimate — built from
 * public registries (BBR, Danmarks Statistik, Klimadatastyrelsen, etc).
 *
 * robots.txt (https://www.dingeo.dk/robots.txt) only disallows specific map/API
 * paths (/kort/.../?, /opslag/?postnr=*, /awsLookup, /byggesag*, etc.) and its
 * own sitemap indexes thousands of /adresse/{postnr-by}/{vej-nr}/ pages, so the
 * per-address report pages this reads are intended to be crawled.
 *
 * There's no public API, so this extracts a handful of headline facts from the
 * rendered page with targeted regexes (anchored to stable surrounding copy,
 * not to the address itself, so the same pattern matches any address).
 */

const USER_AGENT = 'HomeRadarBot/1.0 (+https://sarah-a13.github.io/HomeRadar_1/; property research aggregator)';

export interface DinGeoInsights {
  available: boolean;
  url?: string;
  radonRisk?: string;
  burglaryRisk?: string;
  floodRisk?: string;
  noiseLevel?: string;
  schoolDistrict?: string;
  valuationEstimate?: number;
}

const UNAVAILABLE: DinGeoInsights = { available: false };

// DinGeo's underlying registries (BBR, statistics, climate models) change at most
// monthly, so cache per-address for the life of the process instead of re-fetching
// on every details-page view.
const cache = new Map<string, DinGeoInsights>();

const RISK_LABELS: Record<string, string> = {
  'meget lav': 'Very Low',
  lav: 'Low',
  moderat: 'Moderate',
  middel: 'Moderate',
  høj: 'High',
  'meget høj': 'Very High',
};

function translateRisk(da: string | undefined): string | undefined {
  if (!da) return undefined;
  const key = da.trim().toLowerCase();
  return RISK_LABELS[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

// Addresses are stored as "{street} {number}, {postal} {city}" — DinGeo's URL
// scheme needs the street+number and postal+city as two separate path segments
// (e.g. /adresse/5250-odense-sv/morelvej-84/), not the combined display string.
function buildDinGeoUrl(address: string, postalCode: string | null, city: string | null): string | null {
  if (!postalCode || !city) return null;
  const streetAndNumber = address.split(',')[0]?.trim();
  if (!streetAndNumber) return null;
  const cityName = city.toLowerCase() === 'copenhagen' ? 'københavn' : city;
  return `https://www.dingeo.dk/adresse/${slugify(`${postalCode} ${cityName}`)}/${slugify(streetAndNumber)}/`;
}

export async function getDinGeoInsights(
  address: string,
  postalCode: string | null,
  city: string | null
): Promise<DinGeoInsights> {
  const url = buildDinGeoUrl(address, postalCode, city);
  if (!url) return UNAVAILABLE;

  const cached = cache.get(url);
  if (cached) return cached;

  let result: DinGeoInsights = UNAVAILABLE;
  try {
    const response = await axios.get<string>(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'da-DK,da;q=0.9' },
      timeout: 15000,
    });
    const html = response.data;

    // DinGeo's not-found page for addresses it doesn't recognise.
    if (!html.includes('Vi kunne ikke finde adressen')) {
      const radonRisk = translateRisk(
        html.match(/bygningsdata, vurderes[\s\S]{0,300}?til at være <strong>([^<]+)<\/strong>/)?.[1]
      );
      const burglaryRisk = translateRisk(
        html.match(/anmeldte indbrud vurderes[\s\S]{0,200}?at være <strong>([^<]+)<\/strong>/)?.[1]
      );
      const floodRisk = translateRisk(
        html.match(/Der <strong>er ([^<]+) risiko<\/strong> for oversvømmelse ved kraftig regn/)?.[1]
      );
      const noiseLevel = html.match(/Støjen er vurderet at være <span class="font-bold">([^<]+)<\/span>/)?.[1];
      const schoolDistrict = html.match(/hører under skoledistriktet ([^.<]+)\./)?.[1]?.trim();
      const valuationMatch = html.match(/Dingestimat<\/span><\/div><div[^>]*><span[^>]*>([\d.]+) kr\./);
      const valuationEstimate = valuationMatch ? parseInt(valuationMatch[1].replace(/\./g, ''), 10) : undefined;

      const hasAnyData = radonRisk || burglaryRisk || floodRisk || noiseLevel || schoolDistrict || valuationEstimate;
      result = hasAnyData
        ? { available: true, url, radonRisk, burglaryRisk, floodRisk, noiseLevel, schoolDistrict, valuationEstimate }
        : UNAVAILABLE;
    }
  } catch (error: any) {
    console.error(`Failed to fetch DinGeo insights for "${address}":`, error.message);
    result = UNAVAILABLE;
  }

  cache.set(url, result);
  return result;
}
