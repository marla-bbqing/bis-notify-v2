import { NextResponse } from 'next/server';

/**
 * INVENTORY WEBHOOK
 *
 * Called by Shopify Flow when inventory changes from 0 to 1+
 * Finds all customers who signed up for BIS alerts on this product
 * Creates "Back In Stock Alert" event in Klaviyo to trigger email flow
 */

const KLAVIYO_API = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-02-15';

function klaviyoHeaders() {
  const key = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!key) throw new Error('KLAVIYO_PRIVATE_API_KEY not set');
  return {
    'Authorization': `Klaviyo-API-Key ${key}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'revision': KLAVIYO_REVISION,
  };
}

// Find all profiles who signed up for alerts on this product
async function findSubscribers(productId, variantId) {
  try {
    // Find "Back In Stock Signup" metric
    const metricsRes = await fetch(`${KLAVIYO_API}/metrics/`, {
      headers: klaviyoHeaders(),
    });

    if (!metricsRes.ok) return [];

    const metricsData = await metricsRes.json();
    const signupMetric = (metricsData.data || []).find(m =>
      m.attributes?.name?.toLowerCase() === 'back in stock signup'
    );

    if (!signupMetric) {
      console.log('No "Back In Stock Signup" metric found');
      return [];
    }

    // Fetch signup events
    const eventsRes = await fetch(
      `${KLAVIYO_API}/events/?filter=equals(metric_id,"${signupMetric.id}")&page[size]=100`,
      { headers: klaviyoHeaders() }
    );

    if (!eventsRes.ok) return [];

    const eventsData = await eventsRes.json();
    const events = eventsData.data || [];

    // Normalize IDs for comparison
    const normalize = (id) => id?.toString().replace(/gid:\/\/shopify\/\w+\//g, '');
    const normProductId = normalize(productId);
    const normVariantId = normalize(variantId);

    console.log(`Looking for signups: product=${normProductId}, variant=${normVariantId}`);

    // Find matching events and collect profile IDs
    const profileIds = new Set();

    for (const event of events) {
      const props = event.attributes?.event_properties || {};
      const eventProductId = normalize(props.ProductID);
      const eventVariantId = normalize(props.VariantID);

      // Match by product OR variant
      const match = (eventProductId && eventProductId === normProductId) ||
                    (eventVariantId && normVariantId && eventVariantId === normVariantId);

      if (match) {
        const profileId = event.relationships?.profile?.data?.id;
        if (profileId) {
          console.log(`Found signup: profile=${profileId}`);
          profileIds.add(profileId);
        }
      }
    }

    // Fetch profile emails
    const subscribers = [];

    for (const profileId of profileIds) {
      try {
        const profileRes = await fetch(`${KLAVIYO_API}/profiles/${profileId}/`, {
          headers: klaviyoHeaders(),
        });

        if (profileRes.ok) {
          const profileData = await profileRes.json();
          const email = profileData.data?.attributes?.email;
          if (email) {
            subscribers.push({ profileId, email });
          }
        }
      } catch (e) {
        console.log(`Failed to fetch profile ${profileId}:`, e.message);
      }
    }

    return subscribers;

  } catch (error) {
    console.error('Error finding subscribers:', error);
    return [];
  }
}

// Create "Back In Stock Alert" event for a subscriber
// This event TRIGGERS the Klaviyo email flow
async function createAlertEvent(email, product) {
  try {
    const res = await fetch(`${KLAVIYO_API}/events/`, {
      method: 'POST',
      headers: klaviyoHeaders(),
      body: JSON.stringify({
        data: {
          type: 'event',
          attributes: {
            metric: {
              data: {
                type: 'metric',
                attributes: { name: 'Back In Stock Alert' }
              }
            },
            profile: {
              data: {
                type: 'profile',
                attributes: { email }
              }
            },
            properties: {
              ProductID: product.id,
              ProductTitle: product.title,
              ProductHandle: product.handle,
              ProductURL: product.url,
              ProductImage: product.image,
              InventoryQuantity: product.inventory,
              AlertDate: new Date().toISOString(),
            }
          }
        }
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`Alert failed for ${email}:`, err);
      return false;
    }

    console.log(`Alert sent for ${email}`);
    return true;

  } catch (error) {
    console.error(`Error creating alert for ${email}:`, error);
    return false;
  }
}

// Look up product details from Shopify
async function getProductDetails(variantId) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!domain || !token || !variantId) return null;

  // Extract numeric ID
  let numericId = variantId;
  if (variantId.includes('gid://')) {
    numericId = variantId.split('/').pop();
  }

  try {
    // Get variant to find product ID
    const variantRes = await fetch(
      `https://${domain}/admin/api/2024-01/variants/${numericId}.json`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
      }
    );

    if (!variantRes.ok) return null;

    const variantData = await variantRes.json();
    const productId = variantData.variant?.product_id;
    if (!productId) return null;

    // Get product details
    const productRes = await fetch(
      `https://${domain}/admin/api/2024-01/products/${productId}.json`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
      }
    );

    if (!productRes.ok) return null;

    const productData = await productRes.json();
    const product = productData.product;

    const inventory = (product.variants || []).reduce(
      (sum, v) => sum + (v.inventory_quantity || 0), 0
    );

    const storeDomain = domain.replace('.myshopify.com', '.com');

    return {
      id: product.id.toString(),
      title: product.title,
      handle: product.handle,
      url: `https://${storeDomain}/products/${product.handle}`,
      image: product.image?.src || product.images?.[0]?.src || '',
      inventory,
    };

  } catch (error) {
    console.error('Error fetching product:', error);
    return null;
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    console.log('Webhook received:', JSON.stringify(body, null, 2));

    // Extract product info from payload
    // Shopify Flow can send different formats
    let productId = body.product_id || body.productId || body.id;
    let productTitle = body.product_title || body.productTitle || body.title || '';
    let productHandle = body.product_handle || body.productHandle || body.handle || '';
    let inventory = body.inventory_quantity || body.inventoryQuantity || body.quantity;
    let productUrl = body.product_url || body.productUrl || '';
    let productImage = body.product_image || body.productImage || body.image || '';
    const variantId = body.variant_id || body.variantId;

    // If we only have variant_id, look up the product
    if (!productId && variantId) {
      console.log('Looking up product from variant:', variantId);
      const details = await getProductDetails(variantId);
      if (details) {
        productId = details.id;
        productTitle = productTitle || details.title;
        productHandle = productHandle || details.handle;
        productUrl = productUrl || details.url;
        productImage = productImage || details.image;
        inventory = inventory ?? details.inventory;
      }
    }

    if (!productId) {
      return NextResponse.json(
        { error: 'Missing product_id or variant_id' },
        { status: 400 }
      );
    }

    console.log(`Processing: product=${productId} (${productTitle}), inventory=${inventory}`);

    // Only send alerts if inventory > 0
    if (inventory <= 0) {
      console.log('Inventory <= 0, no alerts to send');
      return NextResponse.json({
        success: true,
        message: 'Inventory not positive, no alerts sent',
        alertsSent: 0
      });
    }

    // Find subscribers for this product
    const subscribers = await findSubscribers(productId, variantId);
    console.log(`Found ${subscribers.length} subscribers`);

    if (subscribers.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No subscribers found',
        alertsSent: 0
      });
    }

    // Send alert to each subscriber
    const product = {
      id: productId,
      title: productTitle,
      handle: productHandle,
      url: productUrl,
      image: productImage,
      inventory,
    };

    let alertsSent = 0;
    for (const sub of subscribers) {
      const success = await createAlertEvent(sub.email, product);
      if (success) alertsSent++;
    }

    console.log(`Sent ${alertsSent} alerts`);

    return NextResponse.json({
      success: true,
      message: `Sent ${alertsSent} alerts`,
      alertsSent,
      subscribersFound: subscribers.length,
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET for testing
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Inventory webhook ready. POST product data to trigger alerts.',
    example: {
      product_id: '123456789',
      product_title: 'Product Name',
      product_handle: 'product-name',
      inventory_quantity: 10,
    }
  });
}
