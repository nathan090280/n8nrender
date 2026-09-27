# SuperSpeech Backend - Quick Start Guide

## 🚀 Get Up and Running in 5 Minutes

### Prerequisites Check
- [ ] Node.js 18+ installed
- [ ] Git installed
- [ ] Render.com account created
- [ ] Firebase project created (superspeech-e7bde)
- [ ] Spacemail account active (hello@superspeech.biz)
- [ ] OpenHands API key obtained

---

## Step 1: Configure Environment Variables

```bash
cd backend
cp .env.example .env
```

Edit `.env` and add your missing credentials:
- `EMAIL_PASSWORD` - Your Spacemail password
- `OPENHANDS_API_KEY` - Your OpenHands API key

---

## Step 2: Test Locally (Optional but Recommended)

```bash
# Install dependencies
npm install

# Start server
npm run dev
```

Server will run at `http://localhost:8080`

### Test it works:
```bash
# In another terminal
./scripts/test-endpoints.sh
```

---

## Step 3: Deploy to Render

### Option A: Automatic (Recommended)

1. **Push to GitHub:**
```bash
git init
git add .
git commit -m "Initial SuperSpeech backend"
git branch -M main
git remote add origin https://github.com/nathan090280/n8nrender.git
git push -u origin main
```

2. **Create Render Service:**
   - Go to https://dashboard.render.com
   - Click **New** → **Blueprint**
   - Connect to repo: `nathan090280/n8nrender`
   - Render detects `render.yaml` automatically
   - Click **Apply**

3. **Add Secret Environment Variables:**
   - In Render dashboard, go to your service
   - Click **Environment**
   - Add:
     - `EMAIL_PASSWORD` = your Spacemail password
     - `OPENHANDS_API_KEY` = your OpenHands key
     - `RENDER_API_KEY` = rnd_jt2UcbqmpK9TsFpexdqPxfQfoxZ7

4. **Wait for Deployment** (2-3 minutes)

### Option B: Manual

1. Go to https://dashboard.render.com
2. Click **New** → **Web Service**
3. Connect repo `nathan090280/n8nrender`
4. Configure:
   - Name: `superspeech-backend`
   - Environment: `Node`
   - Build Command: `cd backend && npm install`
   - Start Command: `cd backend && npm start`
5. Add all environment variables from `.env`
6. Click **Create Web Service**

---

## Step 4: Set Up n8n Workflows

Your Render service URL will be:
`https://superspeech-backend.onrender.com`

### Import Workflows

1. Log into your n8n instance
2. Go to **Workflows** → **Import from File**

3. **Import Questionnaire Workflow:**
   - File: `backend/workflows/questionnaire-workflow.json`
   - Edit the HTTP Request node URL:
     ```
     https://superspeech-backend.onrender.com/api/webhooks/questionnaire-completed
     ```
   - Save and **Activate**

4. **Import Email Auto-Reply Workflow:**
   - File: `backend/workflows/email-auto-reply-workflow.json`
   - Edit Email Trigger (IMAP) node:
     - Host: `spacemail.com`
     - User: `hello@superspeech.biz`
     - Password: Your Spacemail password
   - Edit HTTP Request node URL:
     ```
     https://superspeech-backend.onrender.com/api/webhooks/incoming-email
     ```
   - Save and **Activate**

---

## Step 5: Test Production

```bash
# Test health endpoint
curl https://superspeech-backend.onrender.com/health

# Or use the test script
./backend/scripts/test-endpoints.sh https://superspeech-backend.onrender.com
```

---

## Step 6: Connect Frontend

Update your frontend (Netlify) to use the n8n webhook URL for questionnaire submissions.

The n8n questionnaire webhook URL will look like:
```
https://your-n8n-instance.onrender.com/webhook/questionnaire-completed
```

---

## ✅ Verification Checklist

- [ ] Backend deployed to Render
- [ ] Health check returns 200: `https://superspeech-backend.onrender.com/health`
- [ ] n8n questionnaire workflow imported and activated
- [ ] n8n email workflow imported and activated
- [ ] Test questionnaire submission works end-to-end
- [ ] Test email auto-reply works
- [ ] Firebase shows data in collections
- [ ] Email arrives in customer inbox

---

## 🐛 Troubleshooting

### Backend won't start on Render
- Check **Logs** tab in Render dashboard
- Verify all environment variables are set
- Ensure `firebase-service-account.json` is committed (it is in this repo)

### Email not sending
- Verify `EMAIL_PASSWORD` is correct in Render
- Check Spacemail account is active
- Look for email errors in Render logs

### AI not generating speeches
- Check `OPENHANDS_API_KEY` is valid
- Verify API key has credits/quota
- Check Render logs for API error details

### n8n workflow not triggering
- Ensure workflow is **Activated** (toggle in top right)
- Check n8n **Executions** tab for errors
- Verify webhook URL is correct
- Test with `/api/webhooks/test` endpoint first

---

## 📞 Need Help?

1. Check **AGENTS.md** for detailed architecture
2. Read **backend/README.md** for full documentation
3. View Render logs: Dashboard → Your Service → Logs
4. Check n8n execution logs: n8n → Executions
5. Email: hello@superspeech.biz

---

## 🎉 You're Done!

Your SuperSpeech backend is now live and ready to:
- ✅ Generate AI-powered speeches
- ✅ Send beautiful emails to customers
- ✅ Auto-reply to customer inquiries
- ✅ Store everything in Firebase
- ✅ Update user dashboards in real-time

**Next Steps:**
- Fine-tune the AI prompts in `backend/src/services/aiService.js`
- Customize email templates in `backend/src/services/emailService.js`
- Add more webhook endpoints as needed
- Monitor usage in Render and Firebase dashboards
