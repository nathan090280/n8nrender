# SuperSpeech Frontend

This directory contains the frontend files for the SuperSpeech application.

## Questionnaire Data

The `js/questionnaire-data.js` file contains the complete questionnaire configuration with:

### All Event Types (13 total):

**Wedding & Romance:**
- wedding-guest-toast
- anniversary-party  
- engagement-party

**Corporate or Professional:**
- company-anniversary
- retirement-party

**Milestone Celebrations:**
- baby-shower
- achievement-celebration

**Memorials & Tributes:**
- eulogy
- celebration-of-life
- charity-gala
- tribute-to-mentor
- thank-you-speech
- legacy-event

### Tones (4 per event):
- Serious
- Humorous
- Emotional
- Pure Banter

### Tiers (3 per tone):
- Toast (2 questions)
- Speech (6 questions)
- Keynote (6 questions)

## Total Questions: 260+

Each event × tone × tier combination has its own specific set of questions tailored to that exact context.

## Deployment

The questionnaire-data.js file is deployed to:
- **Production**: https://superspeech.biz
- **Netlify Site ID**: f71912bd-523d-46a1-a0b3-19ec7bdd5b16

## Last Updated

2026-09-29 - Added all 260+ questions for all events, tones, and tiers
