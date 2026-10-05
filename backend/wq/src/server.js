require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bodyParser = require('body-parser');

const env = require('./config/env');
const wqApp = require('./app');
const emailService = require('./services/emailService');
const imapPoller = require('./services/imapPoller');
const scheduler = require('./services/scheduler');

const app = express();
const PORT = env.PORT || process.env.PORT || 8080;

app.set('trust proxy', 1); // required on Render

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// The entire WQ HTTP surface lives in app.js as a router so the same code
// can mount at /wq inside the shared SuperSpeech service (see mount.js).
app.use('/', wqApp);

async function startServer() {
  try {
    console.log('Starting Williams Quantum Agent Core...');

    const emailReady = await emailService.verifyEmailConnection();
    if (emailReady) {
      console.log('✓ Email service connected');
    } else {
      console.warn('⚠ Email service not fully configured');
    }

    // Poll the Spacemail inbox: inbound mail → lead-reply engine / approvals.
    imapPoller.start();

    // Arm the daily business-development play.
    scheduler.start();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔══════════════════════════════════════════════╗
║   WILLIAMS QUANTUM - AGENT CORE ONLINE      ║
╠══════════════════════════════════════════════╣
║  Port: ${PORT.toString().padEnd(39)}║
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(30)}║
║  Intake: ${(env.EMAIL_FROM || 'products@williamsquantum.com').padEnd(33)}║
╚══════════════════════════════════════════════╝

Endpoints:
  - GET  /                  : API info
  - GET  /health            : Health check
  - GET  /api/status        : Public agent status (site engine tile)
  - GET  /api/leads?key=    : Lead pipeline (principal view)
  - POST /api/contact       : Public website form intake
  - POST /api/agent-run     : Trigger daily play (?force=1)
  - POST /api/incoming-email: Inbound email webhook
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
