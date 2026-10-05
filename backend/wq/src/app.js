const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const apiRoutes = require('./routes/api');

// The WQ HTTP surface as a mountable router. Standalone server.js mounts it
// at '/'; the shared SuperSpeech process mounts it at '/wq' via mount.js.
// Assumes the host app already provides helmet/cors/morgan/bodyParser.
const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
router.use('/api/', limiter);

router.get('/', (req, res) => {
  res.json({
    name: 'Williams Quantum Agent Core',
    version: '1.0.0',
    status: 'running',
    endpoints: { health: './health', status: './api/status', api: './api/*' }
  });
});

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// Public read-only status for the site's engine tile - exposes nothing
// sensitive, just proves the core is alive.
router.get('/api/status', (req, res) => {
  res.json({
    agent: 'ACTIVE',
    core: 'RENDER_CORE_ONLINE',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Everything else under /api requires the shared key (x-api-key header or
// ?key= so the principal can open /api/leads in a browser). /status and the
// public contact form are exempt.
router.use('/api', (req, res, next) => {
  if (req.path === '/status' || req.path === '/contact') return next();
  const configuredKey = env.API_SECRET_KEY;
  if (configuredKey && req.headers['x-api-key'] !== configuredKey && req.query.key !== configuredKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
});

router.use('/api', apiRoutes);

router.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

router.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;
