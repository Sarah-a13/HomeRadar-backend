import { pool } from '../server';
import axios from 'axios';

/**
 * Trigger-Based Property Matching
 *
 * When a user submits their preferences:
 * 1. Extract criteria (city, budget, bedrooms, etc)
 * 2. Match against real estate agents' "coming soon" listings (agent_listings table)
 * 3. Search Instagram hashtags via the official Graph API (if configured)
 * 4. Store results with source tracking
 * 5. Notify user of new matches
 *
 * Note: Facebook Marketplace has no public API for reading listings, and
 * scraping it would violate Meta's Terms of Service, so it is intentionally
 * not implemented here. The Agent Portal (agents.ts) is the legitimate
 * substitute — agents opt in to submit their own "coming soon" listings.
 */

export interface UserPreferences {
  city: string;
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
    Promise.all([
      matchAgentComingSoonListings(userId, preferences),
      scrapeInstagram(userId, preferences),
    ]).catch(error => {
      console.error('Error during background matching:', error);
    });

    console.log('✅ Matching queued (running in background)');
  } catch (error) {
    console.error('Error triggering matcher:', error);
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
        const sourceUrl = `agent_listing:${listing.id}`;
        const existing = await pool.query('SELECT id FROM properties WHERE source_url = $1', [sourceUrl]);
        if (existing.rows.length > 0) continue;

        await pool.query(
          `INSERT INTO properties (
            address, city, price, bedrooms, bathrooms, sqm,
            source, source_url, verified, description, images,
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
            sourceUrl,
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
 * Instagram Scraper (official Graph API)
 * Searches for properties using real estate hashtags via Instagram's
 * Hashtag Search API. Requires INSTAGRAM_ACCESS_TOKEN and
 * INSTAGRAM_BUSINESS_ACCOUNT_ID to be set (see .env.example). If not
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
    console.log(`📷 Searching Instagram for ${prefs.city}...`);

    const hashtags = buildInstagramHashtags(prefs);
    const instagramListings = await searchInstagramHashtags(hashtags, businessAccountId, accessToken);

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
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
          [
            prefs.city, // exact address unknown from a caption alone
            prefs.city,
            'instagram',
            post.source_url,
            false, // not verified
            post.description,
            post.images,
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
 * Helper: Build Instagram hashtags for search
 */
function buildInstagramHashtags(prefs: UserPreferences): string[] {
  const citySlug = prefs.city.toLowerCase().replace(/\s+/g, '');

  return [
    `#bolig${citySlug}`,
    `#husudsalg${citySlug}`,
    `#ejendom${citySlug}`,
    `#${citySlug}boliger`,
    `#boligeudtojen`,
    `#husethusvej`,
    `#ejendomsmægler`,
    `#boligmarked`,
  ];
}

/**
 * Real Instagram Hashtag Search via the official Graph API.
 * Docs: https://developers.facebook.com/docs/instagram-api/guides/hashtag-search
 * Requires the business account to have been granted the
 * instagram_basic + instagram_manage_insights permissions.
 */
async function searchInstagramHashtags(
  hashtags: string[],
  businessAccountId: string,
  accessToken: string
): Promise<Array<{ source_url: string; description: string; images: string[] }>> {
  const results: Array<{ source_url: string; description: string; images: string[] }> = [];
  const graphUrl = 'https://graph.facebook.com/v19.0';

  for (const tag of hashtags) {
    try {
      const tagName = tag.replace('#', '');

      // Step 1: Resolve hashtag name to an ID
      const hashtagRes = await axios.get(`${graphUrl}/ig_hashtag_search`, {
        params: { user_id: businessAccountId, q: tagName, access_token: accessToken },
      });
      const hashtagId = hashtagRes.data?.data?.[0]?.id;
      if (!hashtagId) continue;

      // Step 2: Fetch recent media for that hashtag
      const mediaRes = await axios.get(`${graphUrl}/${hashtagId}/recent_media`, {
        params: {
          user_id: businessAccountId,
          fields: 'id,caption,permalink,media_url',
          access_token: accessToken,
        },
      });

      for (const post of mediaRes.data?.data ?? []) {
        results.push({
          source_url: post.permalink,
          description: post.caption ?? '',
          images: post.media_url ? [post.media_url] : [],
        });
      }
    } catch (error: any) {
      console.warn(`Instagram hashtag search failed for ${tag}:`, error.response?.data?.error?.message ?? error.message);
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
