// Namespaced environment for the Williams Quantum agent core.
//
// This backend shares a Node process (the SuperSpeech Render service) with
// another application whose env var names we originally inherited. Every WQ
// variable is therefore read ONLY from its WQ_-prefixed name - a missing var
// can never silently fall through to SuperSpeech's mailbox, credentials or
// approval list.
//
// Sole exception: the AI provider key/model may fall back to the shared
// ANTHROPIC_API_KEY / OPENHANDS_API_KEY names - that's billing identity, not
// business identity, and sharing it is intentional.

const e = (name) => process.env[`WQ_${name}`];

module.exports = {
  // standalone-mode port (unused when mounted inside another app)
  PORT: e('PORT') || process.env.WQ_PORT,

  // Spacemail corporate mailbox (SMTP out + IMAP in)
  EMAIL_FROM: e('EMAIL_FROM') || 'products@williamsquantum.com',
  EMAIL_FROM_NAME: e('EMAIL_FROM_NAME') || 'Williams Quantum',
  EMAIL_HOST: e('EMAIL_HOST') || 'mail.spacemail.com',
  EMAIL_PORT: e('EMAIL_PORT'),
  EMAIL_SECURE: e('EMAIL_SECURE'),
  EMAIL_USER: e('EMAIL_USER'),
  EMAIL_PASSWORD: e('EMAIL_PASSWORD'),

  // IMAP polling
  IMAP_HOST: e('IMAP_HOST') || 'mail.spacemail.com',
  IMAP_PORT: e('IMAP_PORT'),
  IMAP_POLL_INTERVAL_MS: e('IMAP_POLL_INTERVAL_MS'),

  // Contract gate - who receives approval requests
  APPROVER_EMAILS: e('APPROVER_EMAILS'),

  // Daily play trigger (Europe/London)
  AGENT_HOUR: e('AGENT_HOUR'),
  AGENT_MINUTE: e('AGENT_MINUTE'),

  // Feature switches
  ENABLE_IMAP_POLLING: e('ENABLE_IMAP_POLLING'),
  ENABLE_AGENT: e('ENABLE_AGENT'),

  // Guards /api/* (except public /status + /contact)
  API_SECRET_KEY: e('API_SECRET_KEY'),

  // JSON store location (point at a Render Disk for durability)
  STORE_FILE: e('STORE_FILE'),

  // AI provider - WQ-specific first, shared host keys as fallback
  ANTHROPIC_API_KEY: e('ANTHROPIC_API_KEY')
    || process.env.ANTHROPIC_API_KEY
    || process.env.OPENHANDS_API_KEY,
  ANTHROPIC_MODEL: e('ANTHROPIC_MODEL') || 'claude-sonnet-4-5-20250929'
};
