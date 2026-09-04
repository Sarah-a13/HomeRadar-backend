import { pool } from '../server';
import axios from 'axios';
import { scrapeBoligsidenForCriteria } from './boligsiden';

/**
 * Trigger-Based Property Matching
 *
 * When a user submits their preferences:
 * 1. Extract criteria (city, budget, bedrooms, etc)
 * 2. Match against real estate agents' "coming soon" listings (agent_listings table)
 * 3. (Paused) Search Instagram via the official Graph API — see ENABLE_INSTAGRAM_SCRAPING below
 * 4. Store results with source tracking
 * 5. Notify user of new matches
 *
 * Note: Facebook Marketplace has no public API for reading listings, and
 * scraping it would violate Meta's Terms of Service, so it is intentionally
 * not implemented here. The Agent Portal (agents.ts) is the legitimate
 * substitute — agents opt in to submit their own "coming soon" listings.
 *
 * Instagram Business Discovery requires Meta Advanced Access (App Review +
 * Tech Provider business/access verification) to look up accounts outside
 * our own Business Manager, which we're not pursuing right now. Bulk real
 * listing data instead comes from the Boligsiden scraper (see
 * src/scrapers/boligsiden.ts), which needs no such approval.
 */
const ENABLE_INSTAGRAM_SCRAPING = false; // paused — flip back on once Instagram Advanced Access (or an opt-in flow) is in place

export interface UserPreferences {
  city: string;
  cities?: string[];
  budget?: { min: number; max: number };
  bedrooms?: number;
  features?: string[];
}

/**
 * Main trigger function - Called when user completes preferences setup
 */
export async function triggerSocialMediaScraping(userId: string, preferences: UserPreferences) {
  try {
    console.log(`🔍 Starting property match for user ${userId}`);
    console.log(`   City: ${preferences.city}`);
    console.log(`   Budget: ${preferences.budget?.min}-${preferences.budget?.max}`);

    // Run asynchronously (don't block user experience)
    const tasks = [
      matchAgentComingSoonListings(userId, preferences),
      searchBoligsidenForUnmetCriteria(userId, preferences, true),
    ];
    if (ENABLE_INSTAGRAM_SCRAPING) {
      tasks.push(scrapeInstagram(userId, preferences));
    } else {
      console.log('📷 Instagram search paused (ENABLE_INSTAGRAM_SCRAPING = false)');
    }
    Promise.all(tasks).catch(error => {
      console.error('Error during background matching:', error);
    });

    console.log('✅ Matching queued (running in background)');
  } catch (error) {
    console.error('Error triggering matcher:', error);
  }
}

let scheduledSearchRunning = false;

export async function runScheduledMatching() {
  if (scheduledSearchRunning) return;
  scheduledSearchRunning = true;
  try {
    const result = await pool.query('SELECT id, preferences FROM users WHERE preferences IS NOT NULL');
    await Promise.all(result.rows.map(async user => {
      const preferences = user.preferences || {};
      const areas = Array.isArray(preferences.cities) ? preferences.cities.filter(Boolean) : [];
      const city = preferences.city || areas[0];
      if (!city && areas.length === 0) return;
      await searchBoligsidenForUnmetCriteria(user.id, { ...preferences, city: city || areas[0], cities: areas }, true);
    }));
  } catch (error) {
    console.error('Scheduled matching sweep failed:', error);
  } finally {
    scheduledSearchRunning = false;
  }
}

/**
 * Agent "Coming Soon" Listings Matcher
 * Copies agent pre-listings matching user criteria into the public properties feed
 */
async function matchAgentComingSoonListings(userId: string, prefs: UserPreferences) {
  try {
    console.log(`🏘️  Matching agent coming-soon listings for ${prefs.city}...`);

    const params: any[] = [`%${prefs.city}%`];
    let query = `SELECT al.*, a.name as agent_full_name, a.email as agent_full_email
                 FROM agent_listings al
                 JOIN agents a ON al.agent_id = a.id
                 WHERE al.status = 'coming_soon' AND al.city ILIKE $1`;

    if (prefs.budget?.max) {
      params.push(prefs.budget.max);
      query += ` AND (al.price_estimate IS NULL OR al.price_estimate <= $${params.length})`;
    }
    if (prefs.bedrooms) {
      params.push(prefs.bedrooms);
      query += ` AND (al.bedrooms IS NULL OR al.bedrooms >= $${params.length})`;
    }

    const matches = await pool.query(query, params);
    console.log(`Found ${matches.rows.length} agent coming-soon listings`);

    let storedCount = 0;
    for (const listing of matches.rows) {
      try {
        // Coming-soon agent listings have no public URL yet, so source_url is left NULL
        // (frontend already renders a plain "View Details" button when source_url is falsy)
        // instead of the fake, non-clickable "agent_listing:{id}" placeholder used previously.
        // Dedupe on the agent_listings row id via source_id instead of an ad-hoc source_url key.
        const sourceId = `agent_listing_${listing.id}`;
        const existing = await pool.query(
          'SELECT id FROM properties WHERE source = $1 AND source_id = $2',
          ['agent_portal', sourceId]
        );
        if (existing.rows.length > 0) continue;

        await pool.query(
          `INSERT INTO properties (
            address, city, price, bedrooms, bathrooms, sqm,
            source, source_id, verified, description, images,
            agent_name, agent_email, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)`,
          [
            listing.address,
            listing.city,
            listing.price_estimate,
            listing.bedrooms,
            listing.bathrooms,
            listing.sqm,
            'agent_portal',
            sourceId,
            true, // verified - agent-submitted, tied to a registered account
            listing.description,
            listing.images,
            listing.agent_full_name,
            listing.agent_full_email,
          ]
        );
        storedCount++;
        console.log(`✅ Stored: ${listing.address}`);
      } catch (error) {
        console.error(`Failed to store: ${listing.address}`, error);
      }
    }

    if (storedCount > 0) {
      await notifyUser(userId, `Found ${storedCount} coming-soon properties from local agents in ${prefs.city}`);
    }
  } catch (error) {
    console.error('Agent listing matcher error:', error);
  }
}

/**
 * Live, Targeted Boligsiden Search
 * If the property pool we already have doesn't contain anything matching this user's
 * saved areas + budget, go fetch fresh price-filtered listings from Boligsiden right now
 * and keep only the ones in their requested area(s), instead of waiting for the next
 * scheduled full-catalog scrape.
 */
async function searchBoligsidenForUnmetCriteria(userId: string, prefs: UserPreferences, forceSearch = false) {
  try {
    const areas = (prefs.cities && prefs.cities.length > 0) ? prefs.cities : [prefs.city];
    const budgetMin = prefs.budget?.min ?? 0;
    const budgetMax = prefs.budget?.max ?? 999000000;

    // Same city-name/postal-code + alias matching used on the frontend, so this existence
    // check doesn't falsely conclude "no matches" just because "Copenhagen" != "København".
    const CITY_ALIASES: Record<string, string> = { copenhagen: 'københavn' };
    const searchTerms = areas.flatMap(a => {
      const alias = CITY_ALIASES[a.toLowerCase()];
      return alias ? [a, alias] : [a];
    });

    const areaConditions = searchTerms.map((_, i) => `city ILIKE $${i + 3} OR postal_code LIKE $${i + 3}`).join(' OR ');
    const existing = await pool.query(
      `SELECT id FROM properties WHERE price BETWEEN $1 AND $2 AND (${areaConditions}) LIMIT 1`,
      [budgetMin, budgetMax, ...searchTerms.map(a => `${a}%`)]
    );

    if (existing.rows.length > 0 && !forceSearch) {
      console.log(`🏠 Already have matching properties for [${areas.join(', ')}] - skipping live search`);
      return;
    }

    console.log(`🔍 No existing matches for [${areas.join(', ')}] - searching Boligsiden live...`);
    const { inserted } = await scrapeBoligsidenForCriteria(areas, budgetMin, budgetMax);

    if (inserted > 0) {
      await notifyUser(userId, `Found ${inserted} new properties matching your criteria in ${areas.join(', ')}`);
    }
  } catch (error) {
    console.error('Targeted Boligsiden search error:', error);
  }
}

/**
 * Instagram Scraper (official Graph API - Business Discovery)
 * Looks up recent public posts from real estate agents who registered
 * their Instagram handle via the Agent Portal, using the Business
 * Discovery endpoint (works against known Business/Creator accounts,
 * unlike hashtag search which requires "Instagram Public Content Access"
 * review for arbitrary public content). Requires INSTAGRAM_ACCESS_TOKEN
 * and INSTAGRAM_BUSINESS_ACCOUNT_ID to be set (see .env.example). If not
 * configured, this is skipped rather than faking results.
 */
async function scrapeInstagram(userId: string, prefs: UserPreferences) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const businessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (!accessToken || !businessAccountId) {
    console.log('📷 Instagram search skipped - INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_BUSINESS_ACCOUNT_ID not configured');
    return;
  }

  try {
    console.log(`📷 Searching Instagram (Business Discovery) for ${prefs.city}...`);

    const agentsRes = await pool.query(
      `SELECT id, name, instagram_username FROM agents WHERE instagram_username IS NOT NULL`
    );

    const instagramListings = await searchAgentInstagramPosts(agentsRes.rows, prefs, businessAccountId, accessToken);

    console.log(`Found ${instagramListings.length} posts on Instagram`);

    // Insert into database
    for (const post of instagramListings) {
      try {
        const existing = await pool.query(
          'SELECT id FROM properties WHERE source_url = $1',
          [post.source_url]
        );

        if (existing.rows.length > 0) {
          continue;
        }

        await pool.query(
          `INSERT INTO properties (
            address, city, source, source_url, verified, description, images,
            agent_name, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
          [
            prefs.city, // exact address unknown from a caption alone
            prefs.city,
            'instagram',
            post.source_url,
            false, // not verified
            post.description,
            post.images,
            post.agent_name,
          ]
        );

        console.log(`✅ Stored Instagram post: ${post.source_url}`);
      } catch (error) {
        console.error('Failed to store Instagram post:', error);
      }
    }

    // Notify user
    if (instagramListings.length > 0) {
      await notifyUser(userId, `Found ${instagramListings.length} properties on Instagram in ${prefs.city}`);
    }
  } catch (error) {
    console.error('Instagram scraper error:', error);
  }
}

/**
 * Real Instagram Business Discovery lookup via the official Graph API.
 * Docs: https://developers.facebook.com/docs/instagram-api/guides/business-discovery-api
 * Requires our own Instagram Business Account to have Advanced Access
 * for the instagram_basic permission (via Meta App Review) to look up
 * agents' accounts we don't manage ourselves.
 */
async function searchAgentInstagramPosts(
  agents: Array<{ id: string; name: string; instagram_username: string }>,
  prefs: UserPreferences,
  businessAccountId: string,
  accessToken: string
): Promise<Array<{ source_url: string; description: string; images: string[]; agent_name: string }>> {
  const results: Array<{ source_url: string; description: string; images: string[]; agent_name: string }> = [];
  const graphUrl = 'https://graph.facebook.com/v19.0';
  const cityLower = prefs.city.toLowerCase();

  for (const agent of agents) {
    try {
      const discoveryRes = await axios.get(`${graphUrl}/${businessAccountId}`, {
        params: {
          fields: `business_discovery.username(${agent.instagram_username}){media{caption,permalink,media_url,timestamp}}`,
          access_token: accessToken,
        },
      });

      const media = discoveryRes.data?.business_discovery?.media?.data ?? [];

      for (const post of media) {
        const caption: string = post.caption ?? '';
        if (!caption.toLowerCase().includes(cityLower)) continue; // only posts mentioning the requested city

        results.push({
          source_url: post.permalink,
          description: caption,
          images: post.media_url ? [post.media_url] : [],
          agent_name: agent.name,
        });
      }
    } catch (error: any) {
      console.warn(
        `Instagram business discovery failed for @${agent.instagram_username}:`,
        error.response?.data?.error?.message ?? error.message
      );
    }
  }

  return results;
}

/**
 * Notify user of new findings
 * In production: Send email or push notification
 */
async function notifyUser(userId: string, message: string) {
  try {
    // Store notification
    await pool.query(
      `INSERT INTO notifications (user_id, message, created_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)`,
      [userId, message]
    );

    console.log(`📧 Notification sent to user ${userId}: ${message}`);
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}

export default {
  triggerSocialMediaScraping,
};
