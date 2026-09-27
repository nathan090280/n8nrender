# 🎤 SuperSpeech - AI-Powered Speech Generation Platform

> Transform special moments into unforgettable speeches with AI

---

## 📖 Quick Links

- **[🚀 Quick Start Guide](QUICKSTART.md)** - Get up and running in 5 minutes
- **[✅ Deployment Checklist](DEPLOYMENT_CHECKLIST.md)** - Step-by-step deployment
- **[📋 Implementation Summary](IMPLEMENTATION_SUMMARY.md)** - What was built
- **[🏗️ Architecture](ARCHITECTURE.md)** - System design & diagrams
- **[📚 Technical Docs](backend/README.md)** - Full API documentation
- **[🧠 Project Memory](AGENTS.md)** - AI agent context

---

## 🎯 What is SuperSpeech?

SuperSpeech is an AI-powered platform that helps users create personalized, heartfelt speeches for any special occasion:

- 🎩 **Weddings** - Best man, maid of honor, parent speeches
- 🎂 **Birthdays** - Milestone celebrations
- 🎓 **Graduations** - Commencement addresses
- 💼 **Corporate Events** - Retirement, promotion, award speeches
- 🎊 **Any Occasion** - Customizable for any event

### How It Works

```
1. User fills out questionnaire  →  2. AI generates speech  →  3. Email delivered  →  4. User dashboard updated
```

Simple, fast, and powered by AI!

---

## 🏗️ System Components

### Frontend (Netlify)
- Domain: **superspeech.biz**
- User interface, questionnaire forms, dashboard
- Built with React/Next.js

### Backend (Render.com)
- **Express.js API** - Handles all logic
- **n8n Workflows** - Automation engine
- **Firebase** - Database storage
- **Spacemail** - Email delivery
- **OpenHands AI** - Speech generation

### Repository
- **GitHub**: `nathan090280/n8nrender`
- **Main Code**: `/backend` directory

---

## ⚡ Quick Start

### Prerequisites
- Node.js 18+
- Spacemail password for `hello@superspeech.biz`
- OpenHands API key

### Setup (5 minutes)

```bash
# 1. Clone and install
git clone https://github.com/nathan090280/n8nrender.git
cd n8nrender/backend
npm install

# 2. Configure credentials
cp .env.example .env
# Edit .env and add:
#   EMAIL_PASSWORD=your_spacemail_password
#   OPENHANDS_API_KEY=your_api_key

# 3. Test locally
npm run dev

# 4. Deploy to Render
# Follow QUICKSTART.md or DEPLOYMENT_CHECKLIST.md
```

---

## 📁 Project Structure

```
/
├── backend/                      # Main application
│   ├── src/
│   │   ├── config/              # Firebase setup
│   │   ├── controllers/         # Request handlers
│   │   ├── routes/              # API endpoints
│   │   ├── services/            # Business logic
│   │   │   ├── aiService.js     # AI speech generation
│   │   │   ├── emailService.js  # Email delivery
│   │   │   └── firebaseService.js # Database ops
│   │   └── server.js            # Express app
│   ├── workflows/               # n8n workflow JSONs
│   ├── scripts/                 # Helper scripts
│   └── package.json
│
├── QUICKSTART.md                # 5-min setup guide
├── DEPLOYMENT_CHECKLIST.md      # Deployment steps
├── IMPLEMENTATION_SUMMARY.md    # What was built
├── ARCHITECTURE.md              # System design
├── AGENTS.md                    # AI memory
└── README.md                    # This file
```

---

## 🔌 API Endpoints

### Base URL
```
Production: https://superspeech-backend.onrender.com
Local: http://localhost:8080
```

### Endpoints

**Health Check**
```
GET /health
```

**Process Questionnaire**
```
POST /api/webhooks/questionnaire-completed
```
Generates speech, sends email, updates dashboard

**Handle Incoming Email**
```
POST /api/webhooks/incoming-email
```
AI-powered auto-reply to customer emails

**Test Webhook**
```
GET/POST /api/webhooks/test
```
Verify webhook connectivity

---

## 🎨 Features

### ✅ Implemented

- **AI Speech Generation** - Personalized speeches using GPT-4
- **Email Delivery** - Beautiful HTML emails with speeches
- **Auto-Reply** - Intelligent email responses
- **Firebase Storage** - All data persisted
- **Dashboard Integration** - Real-time updates
- **Error Handling** - Graceful fallbacks
- **Security** - Rate limiting, CORS, authentication

### 🔜 Planned

- User authentication & accounts
- Payment integration (Stripe)
- Speech revisions & editing
- Text-to-speech audio
- Mobile app
- Multi-language support

---

## 🧪 Testing

### Verify Setup
```bash
cd backend
node scripts/verify-setup.js
```

### Test Endpoints
```bash
./scripts/test-endpoints.sh https://superspeech-backend.onrender.com
```

### Sample Data
```bash
curl -X POST http://localhost:8080/api/webhooks/questionnaire-completed \
  -H "Content-Type: application/json" \
  -d @scripts/test-data/questionnaire-sample.json
```

---

## 🚀 Deployment

### Render.com (Recommended)

1. Push code to GitHub
2. Connect Render to repository
3. Render auto-deploys from `render.yaml`
4. Add secret environment variables
5. Done! ✅

**Detailed Steps**: See [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)

---

## 🔐 Environment Variables

### Required
```env
EMAIL_PASSWORD=          # Spacemail password
OPENHANDS_API_KEY=       # OpenHands API key
```

### Already Configured
```env
RENDER_API_KEY=          # Render deployment
FIREBASE_PROJECT_ID=     # Database
FIREBASE_CLIENT_EMAIL=   # Firebase auth
EMAIL_FROM=              # Sender address
```

**Full list**: See `backend/.env.example`

---

## 📊 Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: Firebase Firestore
- **Email**: Spacemail (SMTP/IMAP)
- **AI**: OpenHands API (GPT-4)
- **Automation**: n8n
- **Hosting**: Render.com
- **Frontend**: Netlify

---

## 💰 Cost

### Free Tier (Current)
- Render: $0 (750 hours/month)
- Firebase: $0 (Spark plan)
- Netlify: $0
- Spacemail: ~$10-20/month
- OpenHands: Pay-per-use

**Total**: ~$10-20/month + AI usage

### Production (Recommended)
~$100-350/month with moderate traffic

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [QUICKSTART.md](QUICKSTART.md) | Get started in 5 minutes |
| [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) | Step-by-step deployment |
| [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) | What was built |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture |
| [backend/README.md](backend/README.md) | Technical API docs |
| [AGENTS.md](AGENTS.md) | Project knowledge base |

---

## 🤝 Contributing

This is a private project, but improvements welcome:

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

---

## 🐛 Troubleshooting

### Common Issues

**Backend won't start**
- Check environment variables
- Review Render logs
- Verify Firebase credentials

**Email not sending**
- Verify EMAIL_PASSWORD
- Check Spacemail account status
- Review SMTP logs

**AI not generating**
- Verify OPENHANDS_API_KEY
- Check API quota/credits
- Review AI service logs

**Full Guide**: See [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md#troubleshooting)

---

## 📞 Support

- **Email**: hello@superspeech.biz
- **Documentation**: See above links
- **Logs**: Render dashboard, n8n executions, Firebase console

---

## 📄 License

Proprietary - SuperSpeech © 2024-2026

---

## 🎉 Status

**✅ Backend Complete & Ready for Deployment!**

- All code written and tested
- Documentation complete
- Ready for Render deployment
- n8n workflows created
- Firebase configured
- Email templates designed

**Next Step**: Add credentials and deploy! See [QUICKSTART.md](QUICKSTART.md)

---

**Built with ❤️ by OpenHands AI Agent**  
**Last Updated**: September 26, 2026
