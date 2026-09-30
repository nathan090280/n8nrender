#!/bin/bash

echo "🚀 SuperSpeech Backend - Render Deployment Script"
echo "=================================================="

if [ -z "$RENDER_API_KEY" ]; then
    echo "❌ Error: RENDER_API_KEY environment variable not set"
    echo "Please set it with: export RENDER_API_KEY=your_key_here"
    exit 1
fi

echo "✓ Render API key found"

echo ""
echo "📦 Checking repository..."

if [ ! -d ".git" ]; then
    echo "Initializing git repository..."
    git init
    git add .
    git commit -m "Initial commit - SuperSpeech backend"
fi

echo ""
echo "🔍 Checking GitHub remote..."

REMOTE_URL=$(git remote get-url origin 2>/dev/null)

if [ -z "$REMOTE_URL" ]; then
    echo "Adding GitHub remote..."
    git remote add origin https://github.com/nathan090280/n8nrender.git
else
    echo "Remote already configured: $REMOTE_URL"
fi

echo ""
echo "📤 Pushing to GitHub..."

git add .
git commit -m "Deploy SuperSpeech backend to Render" --allow-empty
git push -u origin main

echo ""
echo "✅ Code pushed to GitHub!"
echo ""
echo "📋 Next steps:"
echo "1. Go to https://dashboard.render.com"
echo "2. Click 'New' → 'Blueprint'"
echo "3. Connect to repository: nathan090280/n8nrender"
echo "4. Render will auto-detect render.yaml"
echo "5. Add these secret environment variables:"
echo "   - RENDER_API_KEY"
echo "   - EMAIL_PASSWORD"
echo "   - OPENHANDS_API_KEY"
echo "   - N8N_API_KEY (optional)"
echo "6. Click 'Apply'"
echo ""
echo "🎉 Your backend will be live at: https://superspeech-backend.onrender.com"
