import axios from 'axios';
import { pool } from '../server';

/**
 * Boligsiden Scraper
 *
 * Pulls active "for sale" listings from boligsiden.dk's public search
 * pages. Boligsiden aggregates listings from virtually all Danish real
 * estate agents, so this gives us real, verifiable properties without
 * depending on any single agent or social platform.
 *
 * robots.txt (https://www.boligsiden.dk/robots.txt) allows crawling the
 * /tilsalg search pages; only /api/*, /viderestilling/* (outbound agent
 * redirect links), /tilsalg/kort/* (map view) and a few other paths are
 * disallowed — none of which this scraper touches.
 *
 * Boligsiden server-renders listing data as an escaped JSON blob inside
 * a Next.js RSC <script> payload rather than exposing a public API, so
 * this extracts the fields we need with targeted regexes instead of a
 * full (and much more brittle) RSC/JSON parse.
 *
 * Usage: npm run scrape:boligsiden [maxPages] [delayMs]
 */

const BASE_URL = 'https://www.boligsiden.dk/tilsalg';
const USER_AGENT = 'HomeRadarBot/1.0 (+https://sarah-a13.github.io/HomeRadar_1/; property research aggregator)';

// Every listing object in the page payload starts with this exact key sequence.
const ADDRESS_BLOCK_MARKER = '"address":{"_links":{"self":{"href":"/addresses/';

const PROPERTY_TYPE_MAP: Record<string, string> = {
  villa: 'house',
  condo: 'apartment',
  terracedHouse: 'townhouse',
  cottage: 'summer_house',
  cooperative: 'apartment',
};

interface ScrapedListing {
  caseId: string;
  roadName: string;
  houseNumber: string;
  floor?: string;
  zipCode: string;
  cityName: string;
  addressType: string;
  lat?: number;
  lon?: number;
  housingArea?: number;
  numberOfRooms?: number;
  priceCash: number;
  yearBuilt?: number;
  slugAddress: string;
  realtorName?: string;
  imageUrl?: string;
  daysListed?: number;
}

function extractField(text: string, regex: RegExp): string | undefined {
  return text.match(regex)?.[1];
}

function decodeEscapes(str: string): string {
  return str.replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseListingsFromHtml(html: string): ScrapedListing[] {
  const decoded = decodeEscapes(html);
  const blocks = decoded.split(ADDRESS_BLOCK_MARKER).slice(1); // part 0 is page chrome before the first listing

  const listings: ScrapedListing[] = [];

  for (const block of blocks) {
    const chunk = block.slice(0, 4000); // this listing's fields all live within a few KB of the marker

    const caseId = extractField(chunk, /"caseID":"([^"]+)"/);
    const slugAddress = extractField(chunk, /"slugAddress":"([^"]+)"/);
    const roadName = extractField(chunk, /"roadName":"([^"]+)"/);
    const houseNumber = extractField(chunk, /"houseNumber":"([^"]*)"/);
    const floor = extractField(chunk, /"floor":"([^"]*)"/);
    const zipCode = extractField(chunk, /"zipCode":(\d+)/);
    const cityName = extractField(chunk, /"cityName":"([^"]+)"/);
    const addressType = extractField(chunk, /"addressType":"([^"]+)"/);
    const latLonMatch = chunk.match(/"coordinates":\{"lat":(-?[\d.]+),"lon":(-?[\d.]+)/);
    const housingArea = extractField(chunk, /"housingArea":(\d+)/);
    const numberOfRooms = extractField(chunk, /"numberOfRooms":(\d+)/);
    const priceCash = extractField(chunk, /"priceCash":(\d+)/);
    const yearBuilt = extractField(chunk, /"yearBuilt":(\d+)/);
    const daysListed = extractField(chunk, /"daysListed":\{"days":(\d+)\}/);
    const imageUrl = extractField(chunk, /"image":\{"imageSources":\[\{[^}]*?"url":"([^"]+)"/);
    const realtorName = chunk.match(/"realtor":\{[\s\S]*?"name":"([^"]+)"/)?.[1];

    // Skip "coming soon" preview blocks and anything missing required fields
    if (!caseId || !slugAddress || !roadName || !zipCode || !cityName || !priceCash) {
      continue;
    }

    listings.push({
      caseId,
      roadName,
      houseNumber: houseNumber || '',
      floor,
      zipCode,
      cityName,
      addressType: addressType || 'residential',
      lat: latLonMatch ? parseFloat(latLonMatch[1]) : undefined,
      lon: latLonMatch ? parseFloat(latLonMatch[2]) : undefined,
      housingArea: housingArea ? parseInt(housingArea, 10) : undefined,
      numberOfRooms: numberOfRooms ? parseInt(numberOfRooms, 10) : undefined,
      priceCash: parseInt(priceCash, 10),
      yearBuilt: yearBuilt ? parseInt(yearBuilt, 10) : undefined,
      slugAddress,
      realtorName,
      imageUrl,
      daysListed: daysListed ? parseInt(daysListed, 10) : undefined,
    });
  }

  // The RSC stream can repeat a listing's data across chunk boundaries; keep the first occurrence
  const seen = new Set<string>();
  return listings.filter(l => (seen.has(l.caseId) ? false : (seen.add(l.caseId), true)));
}

async function fetchPage(page: number, priceMin?: number, priceMax?: number): Promise<string> {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (priceMin) params.set('priceMin', String(Math.floor(priceMin)));
  if (priceMax && priceMax < 900000000) params.set('priceMax', String(Math.floor(priceMax)));
  const qs = params.toString();
  const url = qs ? `${BASE_URL}?${qs}` : BASE_URL;
  const response = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'da-DK,da;q=0.9' },
    timeout: 20000,
  });
  return response.data;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Inserts one listing if it isn't already stored (dedup by source_id). Returns true if inserted.
async function insertListing(listing: ScrapedListing): Promise<boolean> {
  const existing = await pool.query(
    'SELECT id FROM properties WHERE source_id = $1 AND source = $2',
    [listing.caseId, 'boligsiden']
  );
  if (existing.rows.length > 0) {
    return false;
  }

  const address = `${listing.roadName} ${listing.houseNumber}${listing.floor ? ', ' + listing.floor + '.' : ''}, ${listing.zipCode} ${listing.cityName}`;
  const listingDate = listing.daysListed !== undefined
    ? new Date(Date.now() - listing.daysListed * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    : null;

  await pool.query(
    `INSERT INTO properties (
      address, postal_code, city, latitude, longitude, price,
      bedrooms, sqm, year_built, property_type,
      source, source_url, source_id, verified, images, thumbnail_url,
      agent_name, listing_date, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP)`,
    [
      address,
      listing.zipCode,
      listing.cityName,
      listing.lat ?? null,
      listing.lon ?? null,
      listing.priceCash,
      listing.numberOfRooms ?? null,
      listing.housingArea ?? null,
      listing.yearBuilt ?? null,
      PROPERTY_TYPE_MAP[listing.addressType] || listing.addressType,
      'boligsiden',
      `https://www.boligsiden.dk/adresse/${listing.slugAddress}`,
      listing.caseId,
      true, // verified - Boligsiden aggregates licensed real estate agents' own listings
      listing.imageUrl ? [listing.imageUrl] : null,
      listing.imageUrl ?? null,
      listing.realtorName ?? null,
      listingDate,
    ]
  );
  return true;
}

async function scrapeBoligsiden(maxPages: number, delayMs: number) {
  console.log(`🏠 Scraping Boligsiden (up to ${maxPages} pages, ${delayMs}ms delay between requests)...`);

  let insertedCount = 0;
  let skippedCount = 0;
  let totalSeen = 0;

  for (let page = 1; page <= maxPages; page++) {
    let html: string;
    try {
      console.log(`📄 Fetching page ${page}...`);
      html = await fetchPage(page);
    } catch (error: any) {
      console.error(`Failed to fetch page ${page}:`, error.message);
      break;
    }

    const listings = parseListingsFromHtml(html);
    if (listings.length === 0) {
      console.log(`No listings found on page ${page}, stopping.`);
      break;
    }
    totalSeen += listings.length;

    for (const listing of listings) {
      try {
        const wasInserted = await insertListing(listing);
        if (wasInserted) {
          insertedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        console.error(`Failed to store listing ${listing.caseId}:`, error);
      }
    }

    console.log(`   Page ${page}: ${listings.length} listings found (inserted so far: ${insertedCount}, skipped: ${skippedCount})`);

    if (page < maxPages) {
      await sleep(delayMs);
    }
  }

  console.log(`\n✨ Boligsiden Scrape Complete`);
  console.log(`   Seen: ${totalSeen}`);
  console.log(`   Inserted: ${insertedCount}`);
  console.log(`   Skipped (duplicates): ${skippedCount}`);
}

const maxPages = parseInt(process.argv[2] || process.env.BOLIGSIDEN_MAX_PAGES || '5', 10);
const delayMs = parseInt(process.argv[3] || process.env.BOLIGSIDEN_DELAY_MS || '1500', 10);

// Danish real-estate data uses native city names with postal-district suffixes (e.g. "København K"),
// and users may type a city name or a postal code - mirrors the matching helper used on the frontend.
const CITY_ALIASES: Record<string, string> = { Copenhagen: 'København' };
function matchesArea(area: string, cityName: string, zipCode: string): boolean {
  const trimmed = (area || '').trim();
  if (!trimmed) return false;
  if (/^\d+$/.test(trimmed)) {
    return zipCode.startsWith(trimmed);
  }
  const cityLower = cityName.toLowerCase();
  const areaLower = trimmed.toLowerCase();
  if (cityLower.startsWith(areaLower)) return true;
  const alias = CITY_ALIASES[trimmed];
  return alias ? cityLower.startsWith(alias.toLowerCase()) : false;
}

/**
 * On-demand targeted search, triggered when a user's saved criteria has no existing matches
 * in the database. Fetches a small, bounded number of price-filtered pages (not a full crawl)
 * and keeps only listings in the user's requested area(s), inserting new ones.
 */
export async function scrapeBoligsidenForCriteria(
  areas: string[],
  budgetMin: number,
  budgetMax: number,
  maxPagesToCheck = 8
): Promise<{ inserted: number; matched: number }> {
  let inserted = 0;
  let matched = 0;

  for (let page = 1; page <= maxPagesToCheck; page++) {
    let html: string;
    try {
      html = await fetchPage(page, budgetMin, budgetMax);
    } catch (error: any) {
      console.error(`[targeted search] Failed to fetch page ${page}:`, error.message);
      break;
    }

    const listings = parseListingsFromHtml(html);
    if (listings.length === 0) break;

    const areaMatches = listings.filter(l => areas.some(a => matchesArea(a, l.cityName, l.zipCode)));
    matched += areaMatches.length;

    for (const listing of areaMatches) {
      try {
        if (await insertListing(listing)) inserted++;
      } catch (error) {
        console.error(`[targeted search] Failed to store listing ${listing.caseId}:`, error);
      }
    }

    if (page < maxPagesToCheck) await sleep(800);
  }

  console.log(`🔍 Targeted Boligsiden search for [${areas.join(', ')}]: matched ${matched}, inserted ${inserted} new`);
  return { inserted, matched };
}

// Only run the full multi-page crawl when this file is executed directly (npm run scrape:boligsiden),
// not when imported by trigger.ts for the on-demand targeted search above.
if (require.main === module) {
  scrapeBoligsiden(maxPages, delayMs)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error scraping Boligsiden:', error);
      process.exit(1);
    });
}
