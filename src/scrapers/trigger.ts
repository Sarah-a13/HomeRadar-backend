import { pool } from '../server';
import axios from 'axios';

/**
 * Trigger-Based Social Media Scraper
 * 
 * When a user submits their preferences:
 * 1. Extract criteria (city, budget, bedrooms, etc)
 * 2. Trigger Facebook Marketplace scraping for that area
 * 3. Search Instagram hashtags for matching properties
 * 4. Store results with source tracking
 * 5. Notify user of new matches
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
    console.log(`🔍 Starting social media scrape for user ${userId}`);
    console.log(`   City: ${preferences.city}`);
    console.log(`   Budget: ${preferences.budget?.min}-${preferences.budget?.max}`);

    // Start scraping asynchronously (don't block user experience)
    Promise.all([
      scrapeFacebookMarketplace(userId, preferences),
      scrapeInstagram(userId, preferences),
    ]).catch(error => {
      console.error('Error during background scraping:', error);
    });

    console.log('✅ Scraping queued (running in background)');
  } catch (error) {
    console.error('Error triggering scraper:', error);
  }
}

/**
 * Facebook Marketplace Scraper
 * Searches for properties matching user criteria
 */
async function scrapeFacebookMarketplace(userId: string, prefs: UserPreferences) {
  try {
    console.log(`📱 Scraping Facebook Marketplace for ${prefs.city}...`);

    // Build search query
    const searchQuery = buildSearchQuery(prefs);

    // Simulate API call to Facebook Marketplace
    // In production: Use Playwright for headless browsing
    const facebookListings = await simulateFacebookSearch(prefs.city, searchQuery);

    console.log(`Found ${facebookListings.length} listings on Facebook Marketplace`);

    // Insert into database
    for (const listing of facebookListings) {
      try {
        // Check for duplicates
        const existing = await pool.query(
          'SELECT id FROM properties WHERE source_url = $1',
          [listing.source_url]
        );

        if (existing.rows.length > 0) {
          continue; // Skip duplicate
        }

        // Insert new listing
        await pool.query(
          `INSERT INTO properties (
            address, city, price, bedrooms, bathrooms, sqm,
            source, source_url, verified, description, images,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)`,
          [
            listing.address,
            prefs.city,
            listing.price,
            listing.bedrooms,
            listing.bathrooms,
            listing.sqm,
            'facebook', // source
            listing.source_url,
            false, // not verified (user-generated)
            listing.description,
            listing.images,
          ]
        );

        console.log(`✅ Stored: ${listing.address}`);
      } catch (error) {
        console.error(`Failed to store: ${listing.address}`, error);
      }
    }

    // Notify user of new listings
    if (facebookListings.length > 0) {
      await notifyUser(userId, `Found ${facebookListings.length} properties on Facebook Marketplace in ${prefs.city}`);
    }
  } catch (error) {
    console.error('Facebook scraper error:', error);
  }
}

/**
 * Instagram Scraper
 * Searches for properties using real estate hashtags
 */
async function scrapeInstagram(userId: string, prefs: UserPreferences) {
  try {
    console.log(`📷 Scraping Instagram for ${prefs.city}...`);

    // Search hashtags relevant to the city and property type
    const hashtags = buildInstagramHashtags(prefs);
    console.log(`Searching hashtags: ${hashtags.join(', ')}`);

    // Simulate API call to Instagram
    // In production: Use Instagram Graph API with business account
    const instagramListings = await simulateInstagramSearch(hashtags, prefs.city);

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
            address, city, price, bedrooms, sqm,
            source, source_url, verified, description, images,
            agent_name, agent_email, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)`,
          [
            post.address,
            prefs.city,
            post.price,
            post.bedrooms,
            post.sqm,
            'instagram', // source
            post.source_url,
            false, // not verified
            post.description,
            post.images,
            post.agent_name,
            post.agent_email,
          ]
        );

        console.log(`✅ Stored: Instagram post from ${post.agent_name}`);
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
 * Helper: Build search query from preferences
 */
function buildSearchQuery(prefs: UserPreferences): string {
  const parts = [prefs.city];

  if (prefs.bedrooms) parts.push(`${prefs.bedrooms} bedroom`);
  if (prefs.budget?.max) parts.push(`under ${prefs.budget.max / 1000000}M`);
  if (prefs.features?.length) parts.push(prefs.features.join(' '));

  return parts.join(' ');
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
 * SIMULATION: Facebook Marketplace search
 * In production, replace with Playwright scraper
 */
async function simulateFacebookSearch(
  city: string,
  query: string
): Promise<Array<any>> {
  // This is a placeholder - would be replaced with real Playwright scraper
  console.log(`Would search Facebook: "${query}"`);

  // Return mock results for MVP
  return [
    {
      address: `Sample Property 1, ${city}`,
      price: 4000000,
      bedrooms: 3,
      bathrooms: 2,
      sqm: 120,
      source_url: 'https://facebook.com/marketplace/...',
      description: 'Beautiful apartment listing',
      images: [],
    },
  ];
}

/**
 * SIMULATION: Instagram hashtag search
 * In production, use Instagram Graph API
 */
async function simulateInstagramSearch(hashtags: string[], city: string): Promise<Array<any>> {
  // This is a placeholder - would be replaced with real Instagram API
  console.log(`Would search Instagram: ${hashtags.join(' ')}`);

  // Return mock results for MVP
  return [
    {
      address: `Instagram Property, ${city}`,
      price: 3500000,
      bedrooms: 2,
      sqm: 100,
      source_url: 'https://instagram.com/p/...',
      description: 'Real estate agent posting',
      images: ['https://instagram.com/...'],
      agent_name: 'Maria Realtor',
      agent_email: 'maria@realtor.dk',
    },
  ];
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
