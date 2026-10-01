const Stripe = require('stripe');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Package tier -> Stripe Price ID (only the tier name ever crosses the wire;
// prices are resolved server-side so the amount cannot be tampered with)
const PRICE_IDS = {
  toast: process.env.STRIPE_PRICE_TOAST || 'price_1ULeaJRJyyjdKutN2xSK83BG',
  main: process.env.STRIPE_PRICE_MAIN || 'price_1ULeeZRJyyjdKutN8SLoX6H6',
  keynote: process.env.STRIPE_PRICE_KEYNOTE || 'price_1ULefPRJyyjdKutNVhzc9ZR2'
};

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://superspeech.biz';

// Addresses allowed to skip payment (testing). Comma-separated env var.
function isBypassed(email) {
  const list = (process.env.BYPASS_PAYMENT_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes((email || '').toLowerCase());
}

function isEnabled() {
  return !!stripe;
}

function priceForTier(tier) {
  return PRICE_IDS[tier] || PRICE_IDS.main;
}

async function createCheckoutSession({ questionnaireId, packageTier, email, occasionLabel }) {
  const session = await stripe.checkout.sessions.create({
    ui_mode: 'embedded_page',
    mode: 'payment',
    customer_email: email,
    line_items: [{ price: priceForTier(packageTier), quantity: 1 }],
    return_url: `${FRONTEND_URL}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    metadata: { questionnaireId },
    payment_intent_data: { metadata: { questionnaireId } }
  });
  return { clientSecret: session.client_secret, sessionId: session.id };
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

module.exports = { isEnabled, isBypassed, createCheckoutSession, constructWebhookEvent };
