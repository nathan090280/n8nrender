# SuperSpeech Project - AI Agent Memory

## Project Overview

SuperSpeech is a web application that generates custom speeches for special occasions using AI. The system consists of:

1. **Frontend**: Hosted on Netlify (superspeech.biz)
2. **Backend**: Node.js/Express API hosted on Render
3. **n8n Workflows**: Automation workflows on Render
4. **Firebase**: Firestore database for data storage
5. **Spacemail**: Email service (hello@superspeech.biz)
6. **OpenHands AI**: Speech generation and email reply automation

## Architecture Flow

```
User fills questionnaire → Sends to n8n webhook → n8n calls Backend API → 
Backend generates speech with AI → Email sent to customer → Data saved to Firebase → 
Dashboard loads user's orders/speeches/messages
```

## Frontend Details

### Website (superspeech.biz)
- **Hosted on**: Netlify
- **Repository**: Local at `/workspace/superspeech/`
- **Framework**: Vanilla JavaScript + HTML/CSS
- **Key Features**:
  - Pricing tiers with hover effects
  - Dynamic questionnaire based on occasion & tone
  - User authentication via Netlify Identity
  - Dashboard showing orders, speeches in progress, completed speeches, and messages
  - Form sends questionnaire data directly to n8n webhook

### Frontend Files
- `index.html` - Main form with dashboard section
- `js/superspeech.js` - Questionnaire logic, form handling, pricing cards
- `js/auth.js` - Netlify Identity integration, n8n submission, dashboard loading
- `js/app.js` - Navigation, smooth scrolling
- `css/superspeech.css` - Styling for all components

### Form Submission Flow
1. User fills form → selects occasion → dynamic questions appear
2. Clicks "Submit Order" → form collects all questionnaire answers
3. Data sent to n8n webhook: `https://n8n-service-4kze.onrender.com/webhook/questionnaire-completed`
4. n8n receives → calls backend API → generates speech → sends email
5. Success message shown, JSON backup downloaded
6. Dashboard can be viewed after login

## Key Components

### Backend API (`/backend`)
- **Framework**: Express.js (Node.js)
- **Port**: 8080
- **Hosted on**: Render.com
- **GitHub Repo**: nathan090280/n8nrender

### API Endpoints
1. `POST /api/webhooks/questionnaire-completed` - Processes questionnaire and generates speech
2. `POST /api/webhooks/incoming-email` - Handles incoming emails and sends AI replies
3. `GET /api/dashboard/:email` - Fetches user's orders, speeches, and messages from Firebase
4. `GET /health` - Health check endpoint
5. `GET/POST /api/webhooks/test` - Test webhook connectivity

### Firebase Configuration
- **Project ID**: superspeech-e7bde
- **Collections**:
  - `questionnaires`: Submitted questionnaires
  - `speeches`: Generated speeches
  - `emailInteractions`: Email logs
  - `users/{userId}/dashboard`: User dashboard data

### Email Configuration
- **Service**: Spacemail
- **Email**: hello@superspeech.biz
- **SMTP Host**: spacemail.com
- **Port**: 587

### Environment Variables (Critical)
```
RENDER_API_KEY=rnd_jt2UcbqmpK9TsFpexdqPxfQfoxZ7
EMAIL_FROM=hello@superspeech.biz
EMAIL_USER=hello@superspeech.biz
EMAIL_PASSWORD=(to be configured)
OPENHANDS_API_KEY=(to be configured)
FIREBASE_PROJECT_ID=superspeech-e7bde
```

## n8n Workflows (Hosted on Render)

### 1. Questionnaire Completion Workflow
- **File**: `backend/workflows/questionnaire-workflow.json`
- **URL**: Render n8n service at `https://n8n-service-4kze.onrender.com`
- **Webhook Path**: `/webhook/questionnaire-completed`
- **Trigger**: POST request from frontend form
- **Flow**:
  1. Webhook receives questionnaire data (customer info, package, tone, occasion, questions/answers)
  2. Calls backend: `POST /api/webhooks/questionnaire-completed`
  3. Backend generates speech with AI
  4. Email sent to customer email address
  5. Data saved to Firebase (`questionnaires` collection)
  6. User dashboard updated

### 2. Email Auto-Reply Workflow
- **File**: `backend/workflows/email-auto-reply-workflow.json`
- **Trigger**: IMAP email received at hello@superspeech.biz
- **Flow**:
  1. Monitor inbox for incoming emails
  2. Filter out internal emails
  3. Call backend API for AI reply generation
  4. Send automated response to sender
  5. Log interaction to Firebase (`emailInteractions` collection)

## Deployment Process

### Backend Deployment to Render
1. Push code to GitHub: `nathan090280/n8nrender`
2. Render auto-deploys from `render.yaml` blueprint
3. Configure secret environment variables in Render dashboard
4. Service URL: `https://superspeech-backend.onrender.com`

### n8n Setup
1. Import workflow JSON files from `backend/workflows/`
2. Configure webhook URLs with Render backend URL
3. Set up IMAP credentials for email monitoring
4. Activate both workflows

## DNS Configuration (Optional)

If email DNS needs to be set up via Netlify:

```
MX Record: @ → spacemail.com (Priority 0)
TXT Record: @ → v=spf1 include:spacemail.com ~all
TXT Record: spacemail._domainkey → (DKIM from Spacemail)
```

## Development Workflow

### Local Development
```bash
cd backend
npm install
cp .env.example .env
# Configure .env with credentials
npm run dev
```

### Testing
```bash
# Test health endpoint
curl http://localhost:8080/health

# Test questionnaire processing
curl -X POST http://localhost:8080/api/webhooks/questionnaire-completed \
  -H "Content-Type: application/json" \
  -d @test-data.json
```

## File Structure
```
/workspace/project/
├── backend/
│   ├── src/
│   │   ├── config/firebase.js
│   │   ├── controllers/webhookController.js
│   │   ├── routes/webhooks.js
│   │   ├── services/
│   │   │   ├── aiService.js
│   │   │   ├── emailService.js
│   │   │   └── firebaseService.js
│   │   └── server.js
│   ├── workflows/
│   │   ├── questionnaire-workflow.json
│   │   └── email-auto-reply-workflow.json
│   ├── package.json
│   ├── render.yaml
│   ├── .env
│   └── firebase-service-account.json
└── AGENTS.md (this file)
```

## Important Notes

### Security
- Never commit `.env` or `firebase-service-account.json` to version control
- Both files are in `.gitignore`
- Set sensitive variables as Render environment variables

### Email Auto-Reply Logic
- AI generates helpful, actionable responses
- Does NOT automatically approve refunds
- Maintains professional, friendly tone
- All interactions logged to Firebase

### Speech Generation
- Uses OpenHands AI API
- Fallback speech if AI fails
- Sends HTML-formatted email with speech
- Saves copy to user's dashboard
- Stores in Firebase for history

## Troubleshooting

### Common Issues
1. **Email not sending**: Check EMAIL_PASSWORD in Render env vars
2. **AI generation failing**: Verify OPENHANDS_API_KEY is valid
3. **Firebase errors**: Ensure service account JSON is present
4. **n8n webhook not triggering**: Verify URL and workflow is activated

### Logs
- **Backend logs**: Render dashboard → Service → Logs
- **n8n logs**: n8n dashboard → Executions
- **Firebase logs**: Firebase Console → Firestore → Activity

## Current Status (Completed)

### ✅ Completed
- [x] Backend deployed to Render (superspeech-backend.onrender.com)
- [x] n8n deployed to Render (n8n-service-4kze.onrender.com)
- [x] Frontend deployed to Netlify (superspeech.biz)
- [x] Firebase Firestore configured
- [x] Email service configured (Spacemail)
- [x] Frontend form connects to n8n webhook
- [x] Dashboard displays orders, speeches, messages
- [x] User authentication with Netlify Identity
- [x] Cosmetic website improvements
- [x] Form validation and error handling

### 🔄 In Progress
- [ ] Configure EMAIL_PASSWORD in Render for email sending
- [ ] Set up OPENHANDS_API_KEY for AI speech generation
- [ ] Test end-to-end questionnaire flow
- [ ] Test email auto-reply flow
- [ ] Fine-tune speech generation prompts

### 📋 Next Steps
1. Test form submission end-to-end
2. Verify n8n receives questionnaire data
3. Check backend processes and saves to Firebase
4. Verify email delivery
5. Test dashboard loads user data
6. Monitor logs for any errors
7. Fine-tune AI prompts for better speeches
8. Add monitoring and alerts

## Recent Changes (Latest Session)

### Frontend Improvements
1. **Helper text repositioned**: "💡 Leave blank if you like..." now appears AFTER "Tell Us More" heading
2. **Dashboard navigation fixed**: Clicking "My Dashboard" now opens in main window and scrolls to it
3. **Form submission corrected**: Fixed error collecting questionnaire answers from dynamic questions
4. **Console logging added**: Debug messages help track form → n8n → backend flow
5. **Questionnaire expanded**: Added more options to each occasion category (14-12 items per category)
6. **Pricing tier styling**: Blue border added to middle tier on hover
7. **Home button**: Now smoothly scrolls to top when clicked

### Backend Improvements
1. **Dashboard API endpoint**: `GET /api/dashboard/:email` fetches user's data from Firebase
2. **Error handling**: Improved timeout and fallback logic for API calls

### Form Data Collection
- Frontend now collects ALL questionnaire answers from dynamic form inputs
- Sends JSON payload to n8n webhook with structure:
  ```json
  {
    "timestamp": "ISO string",
    "customer": { "name": "", "email": "" },
    "order": { "package": "", "tone": "", "category": "", "specificOccasion": "" },
    "questionnaire": { "field1": "answer1", ... }
  }
  ```

## Contact

**Project**: SuperSpeech
**Email**: hello@superspeech.biz
**Domain**: superspeech.biz
**Frontend URL**: https://superspeech.biz
**Backend URL**: https://superspeech-backend.onrender.com
**n8n URL**: https://n8n-service-4kze.onrender.com
**GitHub**: nathan090280/n8nrender
**Firebase Project**: superspeech-e7bde
