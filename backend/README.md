# SuperSpeech Backend

AI-powered backend service for SuperSpeech - integrates n8n workflows, Firebase database, email automation, and AI speech generation.

## 🏗️ Architecture

```
┌─────────────────┐
│   Frontend      │
│  (Netlify)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────┐
│      n8n        │─────▶│  This Backend    │
│  (Render.com)   │      │   (Express.js)   │
└─────────────────┘      └────────┬─────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐      ┌──────────────────┐
│   Spacemail     │      │    Firebase      │
│  (Email SMTP)   │      │   (Database)     │
└─────────────────┘      └──────────────────┘
         │
         ▼
┌─────────────────┐
│  OpenHands AI   │
│  (Speech Gen)   │
└─────────────────┘
```

## 🚀 Features

- **Questionnaire Processing**: Receives completed questionnaires and generates custom speeches
- **AI Speech Generation**: Uses OpenHands API to create personalized speeches
- **Email Automation**: Sends speeches to customers via Spacemail
- **Email Auto-Reply**: Automatically responds to customer emails with helpful information
- **Firebase Integration**: Stores all data (questionnaires, speeches, email interactions)
- **Dashboard Updates**: Syncs generated content to user dashboards
- **n8n Webhooks**: Provides endpoints for n8n workflow automation

## 📋 Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Firebase project with Firestore enabled
- Spacemail account (hello@superspeech.biz)
- OpenHands API key
- Render.com account (for deployment)
- n8n instance (can be hosted on Render)

## 🔧 Installation

### 1. Clone and Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:
- `RENDER_API_KEY`: Your Render.com API key
- `EMAIL_PASSWORD`: Spacemail password for hello@superspeech.biz
- `OPENHANDS_API_KEY`: Your OpenHands API key for AI generation
- `N8N_API_KEY`: n8n authentication key (optional)

### 3. Set Up Firebase

The `firebase-service-account.json` file is already configured. Ensure it has the correct credentials.

### 4. Run Locally

```bash
npm run dev  # Development mode with auto-reload
# or
npm start    # Production mode
```

The server will start on `http://localhost:8080`

## 📡 API Endpoints

### Health Check
```
GET /health
```
Returns server health status

### Questionnaire Completion Webhook
```
POST /api/webhooks/questionnaire-completed
```

**Body:**
```json
{
  "userId": "user123",
  "email": "customer@example.com",
  "name": "John Doe",
  "occasionType": "Wedding",
  "speakerName": "Jane Doe",
  "relationship": "Sister",
  "tone": "Heartfelt and emotional",
  "duration": 5,
  "keyPoints": ["Childhood memories", "College years"],
  "specialMoments": "When they first met...",
  "audienceSize": "100-200",
  "customDetails": "Additional context..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Speech generated and sent successfully",
  "questionnaireId": "abc123",
  "emailSent": true,
  "dashboardUpdated": true
}
```

### Incoming Email Webhook
```
POST /api/webhooks/incoming-email
```

**Body:**
```json
{
  "from": "customer@example.com",
  "subject": "Question about my speech",
  "text": "Email content here...",
  "html": "<p>Email content here...</p>"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Email reply sent successfully",
  "replySent": true
}
```

### Test Webhook
```
GET/POST /api/webhooks/test
```
Test endpoint to verify webhook connectivity

## 🔄 n8n Workflow Setup

### Import Workflows

1. Log into your n8n instance
2. Go to **Workflows** → **Import from File**
3. Import these workflow files:
   - `workflows/questionnaire-workflow.json`
   - `workflows/email-auto-reply-workflow.json`

### Configure Workflows

#### Questionnaire Workflow

1. Open "SuperSpeech - Questionnaire Completion" workflow
2. Edit the **Webhook** node:
   - Set webhook path: `questionnaire-completed`
   - Copy the webhook URL
3. Edit **Call AI Agent Backend** node:
   - Set URL to: `https://your-backend-url.onrender.com/api/webhooks/questionnaire-completed`
4. Save and activate the workflow

#### Email Auto-Reply Workflow

1. Open "SuperSpeech - Email Auto Reply" workflow
2. Edit **Email Trigger - IMAP** node:
   - Host: `spacemail.com`
   - User: `hello@superspeech.biz`
   - Password: Your Spacemail password
3. Edit **Call AI Agent for Reply** node:
   - Set URL to: `https://your-backend-url.onrender.com/api/webhooks/incoming-email`
4. Save and activate the workflow

## 🌐 Deployment to Render

### Option 1: Using Render Blueprint

1. Push this code to GitHub repository `nathan090280/n8nrender`
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click **Blueprint** → **New Blueprint Instance**
4. Connect your GitHub repository
5. Render will auto-detect `render.yaml` and create the service
6. Add secret environment variables:
   - `RENDER_API_KEY`
   - `EMAIL_PASSWORD`
   - `OPENHANDS_API_KEY`

### Option 2: Manual Deployment

1. Go to Render Dashboard
2. Click **New** → **Web Service**
3. Connect GitHub repo: `nathan090280/n8nrender`
4. Configure:
   - **Name**: `superspeech-backend`
   - **Environment**: `Node`
   - **Build Command**: `cd backend && npm install`
   - **Start Command**: `cd backend && npm start`
   - **Environment Variables**: Add all from `.env`
5. Click **Create Web Service**

### Post-Deployment

1. Note your Render service URL (e.g., `https://superspeech-backend.onrender.com`)
2. Update n8n workflows with this URL
3. Test the endpoints:
   ```bash
   curl https://superspeech-backend.onrender.com/health
   ```

## 📧 Email Configuration (If Needed)

If you need to configure DNS records for Spacemail:

### Netlify DNS Setup

Add these records via Netlify API or dashboard:

**MX Records:**
```
Host: @
Priority: 0
Value: spacemail.com
```

**SPF Record (TXT):**
```
Host: @
Value: v=spf1 include:spacemail.com ~all
```

**DKIM Record (TXT):**
```
Host: spacemail._domainkey
Value: (Get from Spacemail dashboard)
```

## 🧪 Testing

### Test Questionnaire Endpoint

```bash
curl -X POST https://your-backend-url.onrender.com/api/webhooks/questionnaire-completed \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test123",
    "email": "test@example.com",
    "name": "Test User",
    "occasionType": "Birthday",
    "speakerName": "Friend",
    "relationship": "Best Friend",
    "tone": "Fun and lighthearted",
    "duration": 3
  }'
```

### Test Email Reply Endpoint

```bash
curl -X POST https://your-backend-url.onrender.com/api/webhooks/incoming-email \
  -H "Content-Type: application/json" \
  -d '{
    "from": "customer@example.com",
    "subject": "Question",
    "text": "How do I get my speech?"
  }'
```

## 📊 Firebase Collections

The backend creates and uses these Firestore collections:

- **questionnaires**: Stores submitted questionnaires
- **speeches**: Stores generated speeches
- **emailInteractions**: Logs all email interactions
- **users/{userId}/dashboard**: User-specific dashboard data

## 🔐 Security

- API rate limiting: 100 requests per 15 minutes per IP
- Helmet.js for security headers
- CORS enabled for frontend domain
- Environment variables for sensitive data
- Firebase Admin SDK for secure database access

## 🐛 Troubleshooting

### Email not sending
- Verify `EMAIL_PASSWORD` is set correctly
- Check Spacemail account is active
- Review logs: Check Render logs for email errors

### AI generation failing
- Verify `OPENHANDS_API_KEY` is valid
- Check API rate limits
- Review OpenHands API status

### Firebase errors
- Ensure `firebase-service-account.json` is present
- Verify Firebase project has Firestore enabled
- Check Firebase security rules

### n8n webhook not triggering
- Verify webhook URL is correct in n8n
- Check n8n workflow is activated
- Test with `/api/webhooks/test` endpoint first

## 📝 Development

### Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── firebase.js          # Firebase initialization
│   ├── controllers/
│   │   └── webhookController.js # Webhook handlers
│   ├── routes/
│   │   └── webhooks.js          # API routes
│   ├── services/
│   │   ├── aiService.js         # AI speech generation
│   │   ├── emailService.js      # Email sending
│   │   └── firebaseService.js   # Database operations
│   └── server.js                # Express server
├── workflows/
│   ├── questionnaire-workflow.json
│   └── email-auto-reply-workflow.json
├── package.json
├── render.yaml
└── README.md
```

### Adding New Features

1. Create new service in `src/services/`
2. Add controller in `src/controllers/`
3. Register routes in `src/routes/`
4. Update server.js if needed
5. Test locally before deploying

## 📞 Support

For issues or questions:
- Email: hello@superspeech.biz
- Check server logs in Render dashboard
- Review Firebase logs in Firebase Console

## 📄 License

Proprietary - SuperSpeech 2024
