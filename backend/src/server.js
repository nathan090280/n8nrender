require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');

const webhookRoutes = require('./routes/webhooks');
const emailService = require('./services/emailService');
const { db } = require('./config/firebase');

const app = express();
const PORT = process.env.PORT || 8080;

// Trust proxy - required for Render
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

app.get('/', (req, res) => {
  res.json({
    name: 'SuperSpeech Backend API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      webhooks: '/api/webhooks',
      health: '/health'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

app.use('/api/webhooks', webhookRoutes);

// Dashboard endpoint - fetch user's orders, speeches, and messages
app.get('/api/dashboard/:email', async (req, res) => {
  try {
    const userEmail = decodeURIComponent(req.params.email);
    
    const orders = [];
    const speeches = [];
    const messages = [];
    
    // Try to fetch orders - simplified query without orderBy to avoid index requirement
    try {
      const ordersSnapshot = await db.collection('questionnaires')
        .where('userEmail', '==', userEmail)
        .get();
      
      ordersSnapshot.forEach(doc => {
        orders.push({ id: doc.id, ...doc.data() });
      });
      
      // Sort in memory
      orders.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const bTime = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return bTime - aTime;
      });
    } catch (err) {
      console.warn('Could not fetch orders:', err.message);
    }
    
    // Try to fetch speeches
    try {
      const speechesSnapshot = await db.collection('speeches')
        .where('userEmail', '==', userEmail)
        .get();
      
      speechesSnapshot.forEach(doc => {
        speeches.push({ id: doc.id, ...doc.data() });
      });
      
      speeches.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const bTime = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return bTime - aTime;
      });
    } catch (err) {
      console.warn('Could not fetch speeches:', err.message);
    }
    
    // Try to fetch messages
    try {
      const messagesSnapshot = await db.collection('emailInteractions')
        .where('userEmail', '==', userEmail)
        .get();
      
      messagesSnapshot.forEach(doc => {
        const data = doc.data();
        messages.push({
          id: doc.id,
          from: data.fromEmail || 'SuperSpeech Team',
          body: data.body || data.message || data.reply,
          createdAt: data.createdAt
        });
      });
    } catch (err) {
      console.warn('Could not fetch messages:', err.message);
    }
    
    // Also fetch AI mailer contact replies (stored in contactInteractions)
    try {
      const contactSnapshot = await db.collection('contactInteractions')
        .where('email', '==', userEmail)
        .get();
      
      contactSnapshot.forEach(doc => {
        const data = doc.data();
        messages.push({
          id: doc.id,
          from: 'SuperSpeech Support',
          body: data.aiReply || data.message,
          subject: data.subject,
          createdAt: data.createdAt
        });
      });
    } catch (err) {
      console.warn('Could not fetch contact interactions:', err.message);
    }
    
    messages.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt) : new Date(0);
      const bTime = b.createdAt ? new Date(b.createdAt) : new Date(0);
      return bTime - aTime;
    });
    
    // Limit to 10
    messages.splice(10);
    
    res.json({
      success: true,
      orders,
      speeches,
      messages,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Dashboard error:', error);
    res.json({
      success: true,
      orders: [],
      speeches: [],
      messages: [],
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

async function startServer() {
  try {
    console.log('Starting SuperSpeech Backend Server...');
    
    const emailReady = await emailService.verifyEmailConnection();
    if (emailReady) {
      console.log('✓ Email service connected');
    } else {
      console.warn('⚠ Email service not fully configured');
    }
    
    console.log('✓ Firebase initialized');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔══════════════════════════════════════════╗
║   SuperSpeech Backend Server Running    ║
╠══════════════════════════════════════════╣
║  Port: ${PORT.toString().padEnd(35)}║
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(26)}║
║  Timestamp: ${new Date().toISOString().padEnd(28)}║
╚══════════════════════════════════════════╝

Endpoints:
  - GET  /                           : API info
  - GET  /health                     : Health check
  - GET  /api/dashboard/:email       : User dashboard data
  - POST /api/webhooks/questionnaire-completed : Handle questionnaire
  - POST /api/webhooks/incoming-email         : Handle incoming emails
  - POST /api/webhooks/test                  : Test webhook
      `);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

startServer();

module.exports = app;
