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

// Check if customer ordered a specific product after signup date
async function checkIfOrdered(email, productId, signupDate) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!domain || !token || !email || !productId) return false;

  // Normalize product ID
  let numericProductId = productId;
  if (productId.includes('gid://')) {
    numericProductId = productId.split('/').pop();
  }

  try {
    // Search for orders by this email
    const res = await fetch(
      `https://${domain}/admin/api/2024-01/orders.json?email=${encodeURIComponent(email)}&status=any&limit=50`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) return false;

    const data = await res.json();
    const orders = data.orders || [];

    const signupTime = signupDate ? new Date(signupDate).getTime() : 0;

    // Check if any order after signup contains this product
    for (const order of orders) {
      const orderTime = new Date(order.created_at).getTime();
      if (orderTime < signupTime) continue; // Order was before signup

      for (const item of order.line_items || []) {
        if (String(item.product_id) === String(numericProductId)) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

// Look up Shopify customer ID by email
async function getShopifyCustomerId(email) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!domain || !token || !email) return null;

  try {
    const res = await fetch(
      `https://${domain}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(email)}`,
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
    return data.customers?.[0]?.id || null;
  } catch {
    return null;
  }
}

// Fetch product inventory and SKU from Shopify
async function getProductData(productId, variantId) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!domain || !token || !productId) return { inventory: null, sku: null };

  // Extract numeric ID from GID format
  let numericId = productId;
  if (productId.includes('gid://')) {
    numericId = productId.split('/').pop();
  }

  let numericVariantId = variantId;
  if (variantId && variantId.includes('gid://')) {
    numericVariantId = variantId.split('/').pop();
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

    if (!res.ok) return { inventory: null, sku: null };

    const data = await res.json();
    const variants = data.product?.variants || [];

    const inventory = variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0);

    // Get SKU - prefer matching variant, fall back to first
    let sku = null;
    if (numericVariantId) {
      const matchingVariant = variants.find(v => String(v.id) === String(numericVariantId));
      sku = matchingVariant?.sku || variants[0]?.sku || null;
    } else {
      sku = variants[0]?.sku || null;
    }

    return { inventory, sku };
  } catch {
    return { inventory: null, sku: null };
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
      const shopifyCustomerId = await getShopifyCustomerId(email);

      // If we have signup events, create a row for each
      if (signups.length > 0) {
        for (const signup of signups) {
          // Check if an alert was sent for this product after signup
          const alertSent = alerts.some(a =>
            a.productId === signup.productId &&
            new Date(a.date) > new Date(signup.signupDate)
          );

          const { inventory, sku } = await getProductData(signup.productId, signup.variantId);
          const ordered = await checkIfOrdered(email, signup.productId, signup.signupDate);

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
            ordered,
            inventory,
            sku,
            shopifyCustomerId,
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
          ordered: false,
          inventory: null,
          sku: null,
          shopifyCustomerId,
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
