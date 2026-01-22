import { NextResponse } from 'next/server';

const KLAVIYO_API = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-02-15';

function klaviyoHeaders() {
  const key = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!key) throw new Error('KLAVIYO_PRIVATE_API_KEY not set');
  return {
    'Authorization': `Klaviyo-API-Key ${key}`,
    'Accept': 'application/json',
    'revision': KLAVIYO_REVISION,
  };
}

// Fetch all "Back In Stock Signup" events from Klaviyo
async function getSignupEvents() {
  try {
    // First find the metric ID for "Back In Stock Signup"
    const metricsRes = await fetch(`${KLAVIYO_API}/metrics/`, {
      headers: klaviyoHeaders(),
      cache: 'no-store',
    });

    if (!metricsRes.ok) return new Map();

    const metricsData = await metricsRes.json();
    const signupMetric = (metricsData.data || []).find(m =>
      m.attributes?.name?.toLowerCase() === 'back in stock signup'
    );

    if (!signupMetric) {
      console.log('No "Back In Stock Signup" metric found');
      return new Map();
    }

    // Fetch events for this metric
    const eventsRes = await fetch(
      `${KLAVIYO_API}/events/?filter=equals(metric_id,"${signupMetric.id}")&page[size]=100&sort=-datetime`,
      { headers: klaviyoHeaders(), cache: 'no-store' }
    );

    if (!eventsRes.ok) return new Map();

    const eventsData = await eventsRes.json();
    const events = eventsData.data || [];

    // Group by profile ID
    const byProfile = new Map();

    for (const event of events) {
      const profileId = event.relationships?.profile?.data?.id;
      if (!profileId) continue;

      const props = event.attributes?.event_properties || {};
      const signup = {
        productId: props.ProductID || null,
        productHandle: props.ProductHandle || null,
        variantId: props.VariantID || null,
        productTitle: props.ProductTitle || null,
        productUrl: props.ProductURL || null,
        productImage: props.ProductImage || null,
        signupDate: props.SignupDate || event.attributes?.datetime || null,
      };

      if (!byProfile.has(profileId)) {
        byProfile.set(profileId, []);
      }
      byProfile.get(profileId).push(signup);
    }

    return byProfile;
  } catch (error) {
    console.error('Error fetching signup events:', error);
    return new Map();
  }
}

// Check if a "Back In Stock Alert" was sent for this signup
async function getAlertEvents() {
  try {
    const metricsRes = await fetch(`${KLAVIYO_API}/metrics/`, {
      headers: klaviyoHeaders(),
      cache: 'no-store',
    });

    if (!metricsRes.ok) return new Map();

    const metricsData = await metricsRes.json();
    const alertMetric = (metricsData.data || []).find(m =>
      m.attributes?.name?.toLowerCase() === 'back in stock alert'
    );

    if (!alertMetric) {
      console.log('No "Back In Stock Alert" metric found');
      return new Map();
    }

    const eventsRes = await fetch(
      `${KLAVIYO_API}/events/?filter=equals(metric_id,"${alertMetric.id}")&page[size]=100&sort=-datetime`,
      { headers: klaviyoHeaders(), cache: 'no-store' }
    );

    if (!eventsRes.ok) return new Map();

    const eventsData = await eventsRes.json();
    const events = eventsData.data || [];

    // Map: profileId -> array of { productId, date }
    const byProfile = new Map();

    for (const event of events) {
      const profileId = event.relationships?.profile?.data?.id;
      if (!profileId) continue;

      const props = event.attributes?.event_properties || {};
      const alert = {
        productId: props.ProductID || null,
        date: event.attributes?.datetime || null,
      };

      if (!byProfile.has(profileId)) {
        byProfile.set(profileId, []);
      }
      byProfile.get(profileId).push(alert);
    }

    return byProfile;
  } catch (error) {
    console.error('Error fetching alert events:', error);
    return new Map();
  }
}

// Fetch product inventory from Shopify
async function getInventory(productId) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!domain || !token || !productId) return null;

  // Extract numeric ID from GID format
  let numericId = productId;
  if (productId.includes('gid://')) {
    numericId = productId.split('/').pop();
  }

  try {
    const res = await fetch(
      `https://${domain}/admin/api/2024-01/products/${numericId}.json`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const variants = data.product?.variants || [];

    return variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0);
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const listId = process.env.KLAVIYO_LIST_ID || 'XMVuS6';

    // Fetch list profiles and events in parallel
    const [profilesRes, signupsByProfile, alertsByProfile] = await Promise.all([
      fetch(`${KLAVIYO_API}/lists/${listId}/profiles/?page[size]=100`, {
        headers: klaviyoHeaders(),
        cache: 'no-store',
      }),
      getSignupEvents(),
      getAlertEvents(),
    ]);

    if (!profilesRes.ok) {
      throw new Error(`Klaviyo API error: ${profilesRes.status}`);
    }

    const profilesData = await profilesRes.json();
    const profiles = profilesData.data || [];

    // Build subscriber list
    const subscribers = [];

    for (const profile of profiles) {
      const email = profile.attributes?.email || 'N/A';
      const name = [
        profile.attributes?.first_name,
        profile.attributes?.last_name
      ].filter(Boolean).join(' ');

      const signups = signupsByProfile.get(profile.id) || [];
      const alerts = alertsByProfile.get(profile.id) || [];

      // If we have signup events, create a row for each
      if (signups.length > 0) {
        for (const signup of signups) {
          // Check if an alert was sent for this product after signup
          const alertSent = alerts.some(a =>
            a.productId === signup.productId &&
            new Date(a.date) > new Date(signup.signupDate)
          );

          const inventory = await getInventory(signup.productId);

          subscribers.push({
            id: `${profile.id}-${signup.productId}-${signup.signupDate}`,
            profileId: profile.id,
            email,
            name,
            productId: signup.productId,
            productTitle: signup.productTitle,
            productUrl: signup.productUrl,
            variantId: signup.variantId,
            signupDate: signup.signupDate,
            alertSent,
            inventory,
          });
        }
      } else {
        // Fallback for profiles without events (legacy)
        subscribers.push({
          id: profile.id,
          profileId: profile.id,
          email,
          name,
          productId: null,
          productTitle: null,
          productUrl: null,
          variantId: null,
          signupDate: profile.attributes?.created || null,
          alertSent: false,
          inventory: null,
        });
      }
    }

    // Sort by signup date (newest first)
    subscribers.sort((a, b) => {
      const aDate = new Date(a.signupDate || 0);
      const bDate = new Date(b.signupDate || 0);
      return bDate - aDate;
    });

    return NextResponse.json({ subscribers });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: error.message, subscribers: [] }, { status: 500 });
  }
}
