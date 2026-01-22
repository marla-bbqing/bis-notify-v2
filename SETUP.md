# Back in Stock Notification System - Setup Guide

## Overview

This system has 3 parts:
1. **Shopify Form** - Customers sign up for notifications
2. **Vercel Dashboard** - View subscribers and alert status
3. **Klaviyo Flow** - Sends the actual emails

## How It Works

```
Customer fills form → "Back In Stock Signup" event → Added to Klaviyo list
                                                              ↓
Inventory restocks → Shopify Flow → Webhook → "Back In Stock Alert" event
                                                              ↓
                                              Klaviyo Flow sends email
```

---

## Step 1: Deploy to Vercel

1. Push to GitHub:
```bash
cd bis-notify-v2
git init
git add .
git commit -m "Initial commit"
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo

3. Add Environment Variables in Vercel:
   - `KLAVIYO_PUBLIC_KEY` = your-klaviyo-public-key
   - `KLAVIYO_LIST_ID` = your-klaviyo-list-id
   - `KLAVIYO_PRIVATE_API_KEY` = your-klaviyo-private-key
   - `SHOPIFY_STORE_DOMAIN` = your-store.myshopify.com
   - `SHOPIFY_ADMIN_TOKEN` = your-shopify-admin-token

4. Deploy!

Your dashboard will be at: `https://your-project.vercel.app`
Your webhook will be at: `https://your-project.vercel.app/api/inventory-webhook`

---

## Step 2: Add Form to Shopify Theme

1. Go to Shopify Admin → Online Store → Themes → Edit Code

2. Create new snippet: `notify-me-form.liquid`

3. Copy contents from `/shopify/notify-me-form.liquid`

4. Add to your product template (usually `sections/product-template.liquid` or `main-product.liquid`):
```liquid
{% render 'notify-me-form', product: product %}
```

5. Add to your product variants the metafield: `custom.variant_sub_status` = `PRE`
   - Only variants with this metafield will show the form

---

## Step 3: Create Shopify Flow

1. Go to Shopify Admin → Apps → Flow → Create workflow

2. Trigger: **Inventory quantity changed**

3. Condition:
   - `Inventory item > Inventory level > Available` **is greater than** `0`
   - AND `Inventory item > Inventory level > Previous available quantity` **equals** `0`

4. Action: **Send HTTP request**
   - Method: POST
   - URL: `https://your-project.vercel.app/api/inventory-webhook`
   - Headers: `Content-Type: application/json`
   - Body:
```json
{
  "variant_id": "{{ inventoryLevel.variant.legacyResourceId }}",
  "inventory_quantity": {{ inventoryLevel.quantities.available }}
}
```

5. Save and Turn ON

---

## Step 4: Create Klaviyo Flow

1. Go to Klaviyo → Flows → Create Flow → Create from Scratch

2. Trigger: **Metric** → Select **"Back In Stock Alert"**
   - (This metric is created automatically when the webhook fires)

3. Add Email action with your back-in-stock template

4. Use these variables in your email:
   - `{{ event.ProductTitle }}`
   - `{{ event.ProductURL }}`
   - `{{ event.ProductImage }}`
   - `{{ event.InventoryQuantity }}`

5. Set flow to LIVE

---

## Testing

1. **Test the webhook manually:**
```bash
curl -X POST https://your-project.vercel.app/api/inventory-webhook \
  -H "Content-Type: application/json" \
  -d '{"product_id": "123", "product_title": "Test", "inventory_quantity": 5}'
```

2. **Test the form:** Visit a product with a PRE variant, enter your email

3. **Check dashboard:** Go to your Vercel URL to see subscribers

---

## Troubleshooting

**Form not showing?**
- Check variant has `custom.variant_sub_status = PRE` metafield
- Check browser console for JS errors

**Emails not sending?**
- Check Klaviyo Flow is LIVE and triggered by "Back In Stock Alert"
- Check Vercel logs for webhook errors
- Verify Shopify Flow is ON

**Dashboard empty?**
- Check KLAVIYO_PRIVATE_API_KEY is set correctly
- Look at Vercel function logs for errors

---

## Files Overview

```
bis-notify-v2/
├── app/
│   ├── layout.js              # App layout
│   ├── page.js                # Dashboard UI
│   └── api/
│       ├── subscribers/route.js    # Fetches subscriber data
│       └── inventory-webhook/route.js  # Handles inventory changes
├── shopify/
│   └── notify-me-form.liquid  # Shopify theme snippet
├── .env.local                 # Local environment variables
└── package.json
```

## Events Created

| Event | When | Purpose |
|-------|------|---------|
| Back In Stock Signup | Customer fills form | Track who wants notifications |
| Back In Stock Alert | Inventory restocks | Trigger email flow |
