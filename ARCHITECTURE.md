# SuperSpeech Architecture

## System Overview

SuperSpeech is a microservices-based application that generates AI-powered custom speeches for special occasions.

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER INTERACTION                            │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │        Frontend (Netlify)              │
        │    • React/Next.js Application         │
        │    • Questionnaire Form                │
        │    • User Dashboard                    │
        │    • Domain: superspeech.biz           │
        └───────────┬────────────────────────────┘
                    │
                    │ HTTP POST (Questionnaire Data)
                    │
                    ▼
        ┌────────────────────────────────────────┐
        │         n8n Workflows                  │◄──── Email arrives
        │         (Render.com)                   │      via IMAP
        │                                        │
        │  1. Questionnaire Completion Flow      │
        │     • Receives form data               │
        │     • Validates input                  │
        │     • Triggers backend API             │
        │                                        │
        │  2. Email Auto-Reply Flow              │
        │     • Monitors hello@superspeech.biz   │
        │     • Filters emails                   │
        │     • Triggers backend API             │
        └───────────┬────────────────────────────┘
                    │
                    │ HTTP POST
                    │
                    ▼
        ┌────────────────────────────────────────┐
        │    Backend API (Render.com)            │
        │    Express.js Server                   │
        │    Port: 8080                          │
        │                                        │
        │    Endpoints:                          │
        │    • POST /api/webhooks/               │
        │           questionnaire-completed      │
        │    • POST /api/webhooks/               │
        │           incoming-email               │
        │    • GET  /health                      │
        │                                        │
        │    Services:                           │
        │    • AI Service ──────────┐            │
        │    • Email Service        │            │
        │    • Firebase Service     │            │
        └────┬──────────────────────┼────────────┘
             │                      │
             │                      │ HTTP POST
             │                      │
             │                      ▼
             │          ┌──────────────────────────┐
             │          │   OpenHands AI API       │
             │          │                          │
             │          │   • Speech Generation    │
             │          │   • Email Reply Gen      │
             │          │   • GPT-4 Model          │
             │          └──────────────────────────┘
             │
             ├─────────────────┐
             │                 │
             ▼                 ▼
  ┌──────────────────┐  ┌──────────────────────────┐
  │   Firebase       │  │   Spacemail              │
  │   (Firestore)    │  │   (Email Service)        │
  │                  │  │                          │
  │ Collections:     │  │   SMTP Configuration:    │
  │ • questionnaires │  │   • Host: spacemail.com  │
  │ • speeches       │  │   • Port: 587            │
  │ • email          │  │   • From:                │
  │   Interactions   │  │     hello@superspeech    │
  │ • users/         │  │           .biz           │
  │   dashboard      │  │                          │
  └──────────────────┘  └──────────────────────────┘
```

## Data Flow

### 1. Questionnaire Submission Flow

```
[User] 
  ↓ Fills out questionnaire form
[Frontend]
  ↓ Submits form data
[n8n Questionnaire Workflow]
  ↓ Validates & forwards
[Backend API] /api/webhooks/questionnaire-completed
  ↓ Processes data
[AI Service]
  ↓ Generates speech using OpenHands API
[Backend API]
  ├─→ [Email Service] → Sends speech to customer
  ├─→ [Firebase Service] → Saves questionnaire & speech
  └─→ [Frontend] ← Dashboard updated with new speech
[Customer Email]
  └─→ Receives beautifully formatted speech
```

### 2. Email Auto-Reply Flow

```
[Customer]
  ↓ Sends email to hello@superspeech.biz
[Spacemail Inbox]
  ↓ Email arrives
[n8n Email Workflow] (IMAP polling)
  ↓ Detects new email
  ↓ Filters (not from superspeech.biz)
[Backend API] /api/webhooks/incoming-email
  ↓ Processes email content
[AI Service]
  ↓ Generates helpful reply using OpenHands API
[Backend API]
  ├─→ [Email Service] → Sends reply to customer
  └─→ [Firebase Service] → Logs interaction
[Customer Email]
  └─→ Receives helpful auto-reply
```

## Technology Stack

### Frontend
- **Framework**: React / Next.js (assumed)
- **Hosting**: Netlify
- **Domain**: superspeech.biz
- **DNS**: Managed via Netlify (or Spaceship)

### Backend API
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Language**: JavaScript
- **Hosting**: Render.com
- **Port**: 8080

### Workflow Automation
- **Platform**: n8n
- **Hosting**: Render.com
- **Workflows**: 2 (Questionnaire + Email)

### Database
- **Service**: Firebase (Firestore)
- **Type**: NoSQL Document Database
- **Project**: superspeech-e7bde
- **Authentication**: Service Account

### Email
- **Provider**: Spacemail
- **Domain**: superspeech.biz
- **Address**: hello@superspeech.biz
- **Protocol**: SMTP (sending), IMAP (receiving)

### AI
- **Provider**: OpenHands
- **Model**: GPT-4 (configurable)
- **Use Cases**: 
  - Speech generation
  - Email auto-replies

## Security Architecture

### Authentication & Authorization
- **Firebase**: Service account with private key
- **OpenHands API**: API key authentication
- **Render API**: API key for deployment
- **Spacemail**: Username/password for SMTP/IMAP

### Data Protection
- Environment variables for all secrets
- `.gitignore` prevents credential commits
- Helmet.js security headers
- CORS configured for frontend domain only

### Rate Limiting
- API rate limit: 100 requests per 15 minutes per IP
- Prevents abuse and DoS attacks

## Scalability Considerations

### Current Setup (Free/Starter Tier)
- **Render Free Tier**:
  - Auto-sleeps after 15 min inactivity
  - 750 hours/month free
  - Limited to 512 MB RAM
  - Cold starts: ~30 seconds

- **Firebase Spark Plan** (Free):
  - 50K reads/day
  - 20K writes/day
  - 1 GB storage
  - 10 GB/month bandwidth

### Scaling Up
When traffic increases, consider:

1. **Render Paid Plan** ($7/month+):
   - Always on (no cold starts)
   - More RAM & CPU
   - Faster performance

2. **Firebase Blaze Plan** (Pay-as-you-go):
   - Unlimited reads/writes
   - Better for high traffic

3. **CDN** for Frontend:
   - Netlify already provides global CDN
   - Fast content delivery worldwide

4. **Caching**:
   - Add Redis for API response caching
   - Cache common speech templates

## Environment Configuration

### Development
```
NODE_ENV=development
PORT=8080
# Local testing with ngrok or similar
```

### Production (Render)
```
NODE_ENV=production
PORT=8080 (Render assigns dynamically)
# All secrets in Render environment variables
```

## Monitoring & Logging

### Backend Logs
- **Location**: Render Dashboard → Service → Logs
- **Includes**:
  - API requests (morgan middleware)
  - Errors and exceptions
  - AI generation status
  - Email sending status

### n8n Execution Logs
- **Location**: n8n Dashboard → Executions
- **Includes**:
  - Workflow triggers
  - Node execution status
  - Error messages
  - Data payloads

### Firebase Logs
- **Location**: Firebase Console → Activity
- **Includes**:
  - Database reads/writes
  - Authentication events
  - Usage metrics

### Email Logs
- **Location**: Spacemail Dashboard
- **Includes**:
  - Sent emails
  - Delivery status
  - Bounce/spam reports

## Backup & Disaster Recovery

### Database Backups
- Firebase has automatic backups
- Manual export: Firestore → Export to Cloud Storage
- Frequency: Weekly recommended

### Code Backups
- GitHub repository: nathan090280/n8nrender
- Version controlled with Git
- All code changes tracked

### Configuration Backups
- Environment variables documented
- Firebase service account backed up
- DNS settings documented

## API Endpoints Reference

### Health Check
```
GET /health
Returns: { "status": "healthy", "timestamp": "...", "uptime": 123 }
```

### Questionnaire Completion
```
POST /api/webhooks/questionnaire-completed
Body: {
  "userId": "string",
  "email": "string",
  "name": "string",
  "occasionType": "string",
  "speakerName": "string",
  "relationship": "string",
  "tone": "string",
  "duration": number,
  "keyPoints": ["string"],
  "specialMoments": "string",
  "customDetails": "string"
}
Returns: {
  "success": boolean,
  "questionnaireId": "string",
  "emailSent": boolean,
  "dashboardUpdated": boolean
}
```

### Incoming Email
```
POST /api/webhooks/incoming-email
Body: {
  "from": "string",
  "subject": "string",
  "text": "string",
  "html": "string"
}
Returns: {
  "success": boolean,
  "replySent": boolean
}
```

## Deployment Architecture

```
┌─────────────────────┐
│   Developer         │
│   Local Machine     │
└──────────┬──────────┘
           │ git push
           ▼
┌─────────────────────┐
│   GitHub            │
│   nathan090280/     │
│   n8nrender         │
└──────────┬──────────┘
           │ webhook
           ▼
┌─────────────────────┐
│   Render.com        │
│   Auto Deploy       │
│   (on git push)     │
└──────────┬──────────┘
           │ builds & deploys
           ▼
┌─────────────────────┐
│   Production        │
│   Backend API       │
│   https://          │
│   superspeech-      │
│   backend           │
│   .onrender.com     │
└─────────────────────┘
```

## Network Diagram

```
Internet
   │
   ├─── superspeech.biz (Frontend - Netlify)
   │
   ├─── superspeech-backend.onrender.com (Backend API - Render)
   │
   ├─── n8n-instance.onrender.com (n8n Workflows - Render)
   │
   ├─── firestore.googleapis.com (Firebase - Google Cloud)
   │
   ├─── spacemail.com (Email Service)
   │
   └─── api.openhands.com (AI Service)
```

## Cost Breakdown (Monthly)

### Free Tier (Current Setup)
- **Render**: $0 (Free tier, 750 hours)
- **Firebase**: $0 (Spark plan)
- **Netlify**: $0 (Starter)
- **n8n**: $0 (Self-hosted on Render)
- **Spacemail**: ~$10-20/month (typical email hosting)
- **OpenHands API**: Pay-per-use (depends on usage)

**Total**: ~$10-20/month + OpenHands usage

### Recommended Production
- **Render**: $7-21/month (Starter+ plan)
- **Firebase**: $25-100/month (Blaze, pay-as-you-go)
- **Netlify**: $0-19/month
- **Spacemail**: $10-20/month
- **OpenHands API**: $50-200/month (estimated)

**Total**: ~$100-350/month (with moderate traffic)

## Future Enhancements

### Phase 1 (Current)
- ✅ Basic speech generation
- ✅ Email delivery
- ✅ Auto-reply to emails
- ✅ Firebase storage

### Phase 2 (Planned)
- [ ] User authentication
- [ ] Payment integration (Stripe)
- [ ] Speech versioning & revisions
- [ ] Text-to-speech audio generation
- [ ] Multiple speech templates

### Phase 3 (Future)
- [ ] Mobile app (React Native)
- [ ] Speech analytics & A/B testing
- [ ] Multi-language support
- [ ] Video speech teleprompter
- [ ] Social media sharing

## Conclusion

This architecture provides:
- ✅ Scalability (can grow with demand)
- ✅ Reliability (multiple cloud providers)
- ✅ Maintainability (modular design)
- ✅ Cost-effectiveness (starts free/cheap)
- ✅ Security (proper authentication)
- ✅ Automation (n8n workflows)

The microservices approach allows each component to scale independently and be maintained/updated without affecting others.
