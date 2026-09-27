# 🚀 SuperSpeech Backend - Deployment Checklist

## Pre-Deployment

### ✅ Required Credentials (You Need These!)

- [ ] **Spacemail Password** for hello@superspeech.biz
  - Where to add: `.env` file → `EMAIL_PASSWORD=your_password_here`
  
- [ ] **OpenHands API Key** for AI speech generation
  - Where to get: https://openhands.com or contact OpenHands support
  - Where to add: `.env` file → `OPENHANDS_API_KEY=your_key_here`

- [ ] **GitHub Personal Access Token** (for pushing code)
  - Already have repo: nathan090280/n8nrender
  - Verify you have push access

---

## Deployment Steps

### 1. Configure Credentials

```bash
cd backend
nano .env  # or use your favorite editor
```

Add these two lines:
```
EMAIL_PASSWORD=your_spacemail_password_here
OPENHANDS_API_KEY=your_openhands_api_key_here
```

### 2. Verify Setup

```bash
node scripts/verify-setup.js
```

Should show all ✅ checks

### 3. Push to GitHub

```bash
cd ..  # Back to project root
git init
git add .
git commit -m "SuperSpeech backend - ready for deployment"
git branch -M main
git remote add origin https://github.com/nathan090280/n8nrender.git
git push -u origin main
```

### 4. Deploy to Render

**Option A: Blueprint (Recommended)**

1. Go to https://dashboard.render.com
2. Click **Blueprints** → **New Blueprint Instance**
3. Connect to GitHub: `nathan090280/n8nrender`
4. Render auto-detects `render.yaml`
5. Click **Apply**
6. Add environment secrets:
   - Go to service → **Environment** tab
   - Add `EMAIL_PASSWORD`
   - Add `OPENHANDS_API_KEY`
   - Add `RENDER_API_KEY` = rnd_jt2UcbqmpK9TsFpexdqPxfQfoxZ7
7. Service will auto-deploy

**Option B: Manual Service**

1. Go to https://dashboard.render.com
2. **New** → **Web Service**
3. Connect repo: `nathan090280/n8nrender`
4. Settings:
   - Name: `superspeech-backend`
   - Environment: `Node`
   - Build: `cd backend && npm install`
   - Start: `cd backend && npm start`
   - Plan: Free (or paid for better performance)
5. Add ALL environment variables from `.env`
6. Click **Create Web Service**

### 5. Wait for Deployment

- Initial deploy takes 3-5 minutes
- Watch the **Logs** tab
- Look for: "SuperSpeech Backend Server Running"
- Health check should pass at `/health`

### 6. Verify Deployment

```bash
# Replace with your actual Render URL
curl https://superspeech-backend.onrender.com/health

# Should return:
# {"status":"healthy","timestamp":"...","uptime":...}
```

---

## Post-Deployment

### 7. Configure n8n

Your backend URL will be:
```
https://superspeech-backend.onrender.com
```

**Import Workflows:**

1. **Questionnaire Workflow**
   - File: `backend/workflows/questionnaire-workflow.json`
   - Update HTTP Request URL: 
     `https://superspeech-backend.onrender.com/api/webhooks/questionnaire-completed`
   - Activate workflow

2. **Email Auto-Reply Workflow**
   - File: `backend/workflows/email-auto-reply-workflow.json`
   - Configure IMAP:
     - Host: `spacemail.com`
     - User: `hello@superspeech.biz`
     - Password: YOUR_SPACEMAIL_PASSWORD
   - Update HTTP Request URL:
     `https://superspeech-backend.onrender.com/api/webhooks/incoming-email`
   - Activate workflow

### 8. Test End-to-End

**Test Questionnaire Flow:**

```bash
cd backend
./scripts/test-endpoints.sh https://superspeech-backend.onrender.com
```

**Or manually:**

```bash
curl -X POST https://superspeech-backend.onrender.com/api/webhooks/questionnaire-completed \
  -H "Content-Type: application/json" \
  -d @scripts/test-data/questionnaire-sample.json
```

**Check:**
- [ ] API returns success: `{"success": true}`
- [ ] Email arrives (check test email inbox)
- [ ] Firebase shows data in `questionnaires` collection
- [ ] Firebase shows data in `speeches` collection

**Test Email Auto-Reply:**

Send an email to `hello@superspeech.biz` and verify:
- [ ] n8n workflow triggers
- [ ] AI generates reply
- [ ] Reply email is sent back

### 9. Connect Frontend

Update your Netlify frontend to use the n8n webhook URLs:

**Questionnaire Form Submission:**
```javascript
// In your frontend code
const response = await fetch('https://your-n8n.onrender.com/webhook/questionnaire-completed', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(questionnaireData)
});
```

---

## Monitoring & Maintenance

### Daily Checks

- [ ] Check Render service status: https://dashboard.render.com
- [ ] Review n8n execution logs for failures
- [ ] Monitor Firebase usage: https://console.firebase.google.com

### Weekly Checks

- [ ] Review email delivery rates (Spacemail dashboard)
- [ ] Check OpenHands API usage and costs
- [ ] Review generated speeches for quality
- [ ] Check for any customer support emails

### Monthly Checks

- [ ] Review and optimize Firebase indexes
- [ ] Check for npm package updates: `npm outdated`
- [ ] Review server logs for errors or unusual patterns
- [ ] Backup Firebase data

---

## Troubleshooting

### Backend Won't Deploy

**Check:**
- Build logs in Render dashboard
- All environment variables are set
- `firebase-service-account.json` exists in repo
- `package.json` is valid JSON

**Fix:**
```bash
# Verify locally first
cd backend
npm install
npm start
```

### Email Not Sending

**Check:**
- `EMAIL_PASSWORD` is correct in Render environment
- Spacemail account is active and not suspended
- Render logs show email attempt
- Email isn't in spam folder

**Fix:**
- Log into Spacemail and verify account status
- Test SMTP connection from local machine
- Check Spacemail sending limits

### AI Not Generating Speeches

**Check:**
- `OPENHANDS_API_KEY` is valid
- API key has remaining credits/quota
- OpenHands API status: Check their status page
- Render logs show API call attempt

**Fix:**
- Verify API key at OpenHands dashboard
- Add more credits if needed
- Check for API rate limiting
- Fallback speech will be used if AI fails

### n8n Workflow Not Triggering

**Check:**
- Workflow is **Activated** (toggle switch)
- Webhook URL is correct
- n8n service is running
- Check n8n **Executions** tab for errors

**Fix:**
- Deactivate and reactivate workflow
- Test webhook directly: `curl -X POST <webhook-url> -d '{"test":true}'`
- Check n8n logs
- Verify n8n authentication if required

### Firebase Errors

**Check:**
- Service account JSON is correct
- Firebase project ID matches
- Firestore is enabled in Firebase Console
- Firebase security rules allow writes

**Fix:**
- Download fresh service account JSON from Firebase
- Verify project ID: `superspeech-e7bde`
- Enable Firestore in Firebase Console
- Update security rules if needed

---

## Quick Reference

### Important URLs

- **Backend**: https://superspeech-backend.onrender.com
- **Backend Health**: https://superspeech-backend.onrender.com/health
- **Render Dashboard**: https://dashboard.render.com
- **Firebase Console**: https://console.firebase.google.com/project/superspeech-e7bde
- **GitHub Repo**: https://github.com/nathan090280/n8nrender

### Important Files

- **Main Server**: `backend/src/server.js`
- **AI Service**: `backend/src/services/aiService.js`
- **Email Service**: `backend/src/services/emailService.js`
- **Environment**: `backend/.env`
- **Firebase Key**: `backend/firebase-service-account.json`

### Important Commands

```bash
# Local development
cd backend && npm run dev

# Verify setup
node scripts/verify-setup.js

# Test endpoints
./scripts/test-endpoints.sh https://superspeech-backend.onrender.com

# View logs
# (Do this in Render dashboard)

# Push updates
git add . && git commit -m "Update" && git push
# (Render auto-deploys on push)
```

---

## 🎉 Success Criteria

Your deployment is successful when ALL of these work:

- ✅ Backend health check returns 200 OK
- ✅ Questionnaire submission generates speech via AI
- ✅ Speech email is sent to customer
- ✅ Data is saved in Firebase
- ✅ Email auto-reply responds to incoming emails
- ✅ Dashboard updates with generated content
- ✅ n8n workflows are activated and executing
- ✅ No errors in Render logs
- ✅ No errors in n8n execution logs
- ✅ No errors in Firebase logs

---

## Need Help?

1. Check **QUICKSTART.md** for quick setup
2. Check **AGENTS.md** for architecture details
3. Check **backend/README.md** for full API docs
4. Check Render logs for backend errors
5. Check n8n execution logs for workflow errors
6. Check Firebase console for database issues
7. Email: hello@superspeech.biz

---

**Good luck with your deployment! 🚀**
