#!/bin/bash

BACKEND_URL="${1:-http://localhost:8080}"

echo "🧪 SuperSpeech Backend - API Testing Script"
echo "==========================================="
echo "Testing backend at: $BACKEND_URL"
echo ""

echo "1️⃣ Testing Health Endpoint..."
echo "--------------------------------"
curl -s "$BACKEND_URL/health" | jq '.'
echo ""

echo "2️⃣ Testing Webhook Test Endpoint..."
echo "-----------------------------------rl -s --"
cuX POST "$BACKEND_URL/api/webhooks/test" \
  -H "Content-Type: application/json" \
  -d '{"test": true, "message": "Hello from test script"}' | jq '.'
echo ""

echo "3️⃣ Testing Questionnaire Completion (Sample Data)..."
echo "-----------------------------------------------------"
if [ -f "scripts/test-data/questionnaire-sample.json" ]; then
    curl -s -X POST "$BACKEND_URL/api/webhooks/questionnaire-completed" \
      -H "Content-Type: application/json" \
      -d @scripts/test-data/questionnaire-sample.json | jq '.'
else
    echo "❌ Sample data file not found. Using inline test data..."
    curl -s -X POST "$BACKEND_URL/api/webhooks/questionnaire-completed" \
      -H "Content-Type: application/json" \
      -d '{
        "userId": "test123",
        "email": "test@example.com",
        "name": "Test User",
        "occasionType": "Birthday",
        "speakerName": "Best Friend",
        "relationship": "Friend",
        "tone": "Fun and lighthearted",
        "duration": 3,
        "keyPoints": ["Great friend", "Always there for me"],
        "specialMoments": "We had so many good times together!",
        "audienceSize": "20-30"
      }' | jq '.'
fi
echo ""

echo "4️⃣ Testing Email Auto-Reply..."
echo "-------------------------------"
curl -s -X POST "$BACKEND_URL/api/webhooks/incoming-email" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "customer@example.com",
    "subject": "Question about my speech",
    "text": "Hi, I submitted a questionnaire yesterday but haven'\''t received my speech yet. Can you help?"
  }' | jq '.'
echo ""

echo "✅ Testing complete!"
echo ""
echo "💡 Tips:"
echo "  - Install jq for pretty JSON output: sudo apt-get install jq"
echo "  - Test production: ./test-endpoints.sh https://superspeech-backend.onrender.com"
echo "  - Check logs if you see errors"
