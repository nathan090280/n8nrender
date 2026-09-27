#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 SuperSpeech Backend - Setup Verification\n');
console.log('='.repeat(50));

let hasErrors = false;

function checkFile(filePath, description) {
  const fullPath = path.join(__dirname, '..', filePath);
  const exists = fs.existsSync(fullPath);
  console.log(`${exists ? '✅' : '❌'} ${description}`);
  if (!exists) hasErrors = true;
  return exists;
}

function checkEnvVar(varName, required = true) {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  const exists = !!process.env[varName];
  const value = process.env[varName];
  const masked = value ? (value.substring(0, 8) + '...') : 'NOT SET';
  
  if (required) {
    console.log(`${exists ? '✅' : '❌'} ${varName} = ${masked}`);
    if (!exists) hasErrors = true;
  } else {
    console.log(`${exists ? '✅' : '⚠️ '} ${varName} = ${masked} ${!exists ? '(optional)' : ''}`);
  }
  return exists;
}

console.log('\n📁 File Structure:');
console.log('-'.repeat(50));
checkFile('package.json', 'package.json');
checkFile('src/server.js', 'src/server.js');
checkFile('src/config/firebase.js', 'Firebase config');
checkFile('src/services/aiService.js', 'AI service');
checkFile('src/services/emailService.js', 'Email service');
checkFile('src/services/firebaseService.js', 'Firebase service');
checkFile('src/controllers/webhookController.js', 'Webhook controller');
checkFile('src/routes/webhooks.js', 'Webhook routes');
checkFile('firebase-service-account.json', 'Firebase service account');
checkFile('.env', 'Environment variables file');

console.log('\n📦 Node Modules:');
console.log('-'.repeat(50));
const hasNodeModules = checkFile('node_modules', 'node_modules directory');
if (!hasNodeModules) {
  console.log('   Run: npm install');
}

console.log('\n🔧 Environment Variables:');
console.log('-'.repeat(50));
checkEnvVar('PORT', false);
checkEnvVar('NODE_ENV', false);
checkEnvVar('RENDER_API_KEY');
checkEnvVar('FIREBASE_PROJECT_ID');
checkEnvVar('FIREBASE_CLIENT_EMAIL');
checkEnvVar('EMAIL_FROM');
checkEnvVar('EMAIL_HOST');
checkEnvVar('EMAIL_USER');
checkEnvVar('EMAIL_PASSWORD'); // Will likely be empty
checkEnvVar('OPENHANDS_API_KEY'); // Will likely be empty

console.log('\n📂 Workflow Files:');
console.log('-'.repeat(50));
checkFile('workflows/questionnaire-workflow.json', 'Questionnaire workflow');
checkFile('workflows/email-auto-reply-workflow.json', 'Email auto-reply workflow');

console.log('\n🧪 Test Files:');
console.log('-'.repeat(50));
checkFile('scripts/test-endpoints.sh', 'Test script');
checkFile('scripts/test-data/questionnaire-sample.json', 'Sample test data');

console.log('\n' + '='.repeat(50));

if (hasErrors) {
  console.log('❌ Setup incomplete - please fix the errors above\n');
  process.exit(1);
} else {
  console.log('✅ Setup looks good!\n');
  console.log('📋 Next Steps:');
  console.log('   1. Add EMAIL_PASSWORD to .env (Spacemail password)');
  console.log('   2. Add OPENHANDS_API_KEY to .env (OpenHands API key)');
  console.log('   3. Run: npm run dev');
  console.log('   4. Test: ./scripts/test-endpoints.sh\n');
  process.exit(0);
}
