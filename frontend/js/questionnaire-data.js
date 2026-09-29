/**
 * SuperSpeech - Complete Questionnaire Data
 * All events, all tones, all questions
 */

const QUESTIONNAIRE_DATA = {
  
  // ========================================
  // WEDDING & ROMANCE
  // ========================================
  
  'wedding-guest-toast': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'coupleNames', label: 'Names of the couple', type: 'text', required: true },
      { id: 'relationshipToCouple', label: 'How do you know the couple?', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'What do you most respect or admire about the couple and the relationship they have built together?', type: 'textarea' },
        { id: 'q2', label: 'What moment or experience best demonstrates the strength of their relationship?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How did you first meet the couple, and what was your immediate impression of them?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest story from your time knowing either of them?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most meaningful memory of either of the newlyweds?', type: 'textarea' },
        { id: 'q2', label: 'When did you first realise that their relationship was something genuinely special?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What is the absolute worst thing you can truthfully say about either of them that will still get a laugh rather than end the marriage?', type: 'textarea' },
        { id: 'q2', label: 'What ridiculous story, disaster or moment of questionable judgement involving the couple deserves to be immortalised in the speech?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'What do you most respect or admire about the couple and the relationship they have built together?', type: 'textarea' },
        { id: 'q2', label: 'What moment or experience best demonstrates the strength of their relationship?', type: 'textarea' },
        { id: 'q3', label: 'What qualities do they each bring to the relationship that make them such a good match?', type: 'textarea' },
        { id: 'q4', label: 'How have you seen them support or influence each other over the years?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular memory that captures what their relationship means to you?', type: 'textarea' },
        { id: 'q6', label: 'What sincere wish or piece of advice would you like to leave them with for their married life?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How did you first meet the couple, and what was your immediate impression of them?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest story from your time knowing either of them?', type: 'textarea' },
        { id: 'q3', label: 'What amusing habits, quirks or weaknesses does either of them have that their partner has somehow learned to tolerate?', type: 'textarea' },
        { id: 'q4', label: 'What embarrassing or ridiculous incident involving the couple could make a great story in front of a wedding audience?', type: 'textarea' },
        { id: 'q5', label: 'What is the most questionable decision either of them has made that you can safely bring up today?', type: 'textarea' },
        { id: 'q6', label: 'If you could give them one piece of deliberately terrible marital advice, what would it be?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most meaningful memory of either of the newlyweds?', type: 'textarea' },
        { id: 'q2', label: 'When did you first realise that their relationship was something genuinely special?', type: 'textarea' },
        { id: 'q3', label: 'What have you witnessed between them that has moved or inspired you?', type: 'textarea' },
        { id: 'q4', label: 'How has having them in your life changed or enriched your own life?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular moment that shows how deeply they care for each other?', type: 'textarea' },
        { id: 'q6', label: 'What do you hope they will always remember about this time in their lives and about the love they share?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What is the absolute worst thing you can truthfully say about either of them that will still get a laugh rather than end the marriage?', type: 'textarea' },
        { id: 'q2', label: 'What ridiculous story, disaster or moment of questionable judgement involving the couple deserves to be immortalised in the speech?', type: 'textarea' },
        { id: 'q3', label: 'What are their most obvious flaws, weird habits or deeply irritating personality traits — and which one is going to drive the other insane first?', type: 'textarea' },
        { id: 'q4', label: 'What did you think when they first got together — and, looking back, how badly did you predict what was going to happen?', type: 'textarea' },
        { id: 'q5', label: 'If their relationship came with a warning label, instruction manual or set of terms and conditions, what would it say?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'What do you most respect or admire about the couple and the relationship they have built together?', type: 'textarea' },
        { id: 'q2', label: 'What moment or experience best demonstrates the strength of their relationship?', type: 'textarea' },
        { id: 'q3', label: 'What qualities do they each bring to the relationship that make them such a good match?', type: 'textarea' },
        { id: 'q4', label: 'How have you seen them support or influence each other over the years?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular memory that captures what their relationship means to you?', type: 'textarea' },
        { id: 'q6', label: 'What sincere wish or piece of advice would you like to leave them with for their married life?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How did you first meet the couple, and what was your immediate impression of them?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest story from your time knowing either of them?', type: 'textarea' },
        { id: 'q3', label: 'What amusing habits, quirks or weaknesses does either of them have that their partner has somehow learned to tolerate?', type: 'textarea' },
        { id: 'q4', label: 'What embarrassing or ridiculous incident involving the couple could make a great story in front of a wedding audience?', type: 'textarea' },
        { id: 'q5', label: 'What is the most questionable decision either of them has made that you can safely bring up today?', type: 'textarea' },
        { id: 'q6', label: 'If you could give them one piece of deliberately terrible marital advice, what would it be?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most meaningful memory of either of the newlyweds?', type: 'textarea' },
        { id: 'q2', label: 'When did you first realise that their relationship was something genuinely special?', type: 'textarea' },
        { id: 'q3', label: 'What have you witnessed between them that has moved or inspired you?', type: 'textarea' },
        { id: 'q4', label: 'How has having them in your life changed or enriched your own life?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular moment that shows how deeply they care for each other?', type: 'textarea' },
        { id: 'q6', label: 'What do you hope they will always remember about this time in their lives and about the love they share?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What is the absolute worst thing you can truthfully say about either of them that will still get a laugh rather than end the marriage?', type: 'textarea' },
        { id: 'q2', label: 'What ridiculous story, disaster or moment of questionable judgement involving the couple deserves to be immortalised in the speech?', type: 'textarea' },
        { id: 'q3', label: 'What are their most obvious flaws, weird habits or deeply irritating personality traits — and which one is going to drive the other insane first?', type: 'textarea' },
        { id: 'q4', label: 'What did you think when they first got together — and, looking back, how badly did you predict what was going to happen?', type: 'textarea' },
        { id: 'q5', label: 'If their relationship came with a warning label, instruction manual or set of terms and conditions, what would it say?', type: 'textarea' }
      ]
    }
  },

  'anniversary-party': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'coupleNames', label: 'Names of the couple', type: 'text', required: true },
      { id: 'relationshipToCouple', label: 'How do you know the couple?', type: 'text', required: true },
      { id: 'anniversaryYears', label: 'How many years are they celebrating?', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'What do you admire most about the couple and the life they have built together?', type: 'textarea' },
        { id: 'q2', label: 'What moment or period in their relationship best demonstrates their commitment to one another?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What do you remember about the couple when they first got together, and what has changed most since then?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest story you can remember from their years together?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most treasured memory of the couple or their life together?', type: 'textarea' },
        { id: 'q2', label: 'Was there a particular moment when you realised just how deeply they cared for each other?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'After all these years, what is the funniest thing you can say about them that they absolutely cannot deny?', type: 'textarea' },
        { id: 'q2', label: 'What ridiculous story from their relationship has somehow survived all these years and still deserves to be dragged out tonight?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'What do you admire most about the couple and the life they have built together?', type: 'textarea' },
        { id: 'q2', label: 'What moment or period in their relationship best demonstrates their commitment to one another?', type: 'textarea' },
        { id: 'q3', label: 'How have you seen them support each other through the different stages of their life together?', type: 'textarea' },
        { id: 'q4', label: 'What qualities have helped their relationship endure and grow over the years?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular memory that captures what their relationship has meant to you or to those around them?', type: 'textarea' },
        { id: 'q6', label: 'What would you like to wish them for the years they still have ahead of them together?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What do you remember about the couple when they first got together, and what has changed most since then?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest story you can remember from their years together?', type: 'textarea' },
        { id: 'q3', label: 'What habits or quirks have they somehow managed to put up with in each other all these years?', type: 'textarea' },
        { id: 'q4', label: 'What memorable mishap, argument, holiday, celebration or disaster involving the couple could make a great story?', type: 'textarea' },
        { id: 'q5', label: 'What is something they did years ago that would be completely out of character for them now?', type: 'textarea' },
        { id: 'q6', label: 'If you could give them one piece of humorous advice for surviving the next chapter of their relationship, what would it be?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most treasured memory of the couple or their life together?', type: 'textarea' },
        { id: 'q2', label: 'Was there a particular moment when you realised just how deeply they cared for each other?', type: 'textarea' },
        { id: 'q3', label: 'What have you witnessed in their relationship that has stayed with you over the years?', type: 'textarea' },
        { id: 'q4', label: 'How have they influenced your life or the lives of the people around them?', type: 'textarea' },
        { id: 'q5', label: 'What do you think has allowed their love and commitment to endure through the years?', type: 'textarea' },
        { id: 'q6', label: 'If you could give them one message to carry with them into the next chapter of their life together, what would you say?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'After all these years, what is the funniest thing you can say about them that they absolutely cannot deny?', type: 'textarea' },
        { id: 'q2', label: 'What ridiculous story from their relationship has somehow survived all these years and still deserves to be dragged out tonight?', type: 'textarea' },
        { id: 'q3', label: 'Which of their habits or personality traits would have had you placing bets on the marriage not making it this far?', type: 'textarea' },
        { id: 'q4', label: 'What have they argued about, disagreed over or stubbornly refused to admit defeat on that could now be safely turned into a joke?', type: 'textarea' },
        { id: 'q5', label: 'If their years together were reviewed like a badly managed business, what would be their biggest success, biggest failure and most questionable decision?', type: 'textarea' },
        { id: 'q6', label: 'If they had to publish an instruction manual for surviving another anniversary, what absolutely essential rule would you put on page one?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'What do you admire most about the couple and the life they have built together?', type: 'textarea' },
        { id: 'q2', label: 'What moment or period in their relationship best demonstrates their commitment to one another?', type: 'textarea' },
        { id: 'q3', label: 'How have you seen them support each other through the different stages of their life together?', type: 'textarea' },
        { id: 'q4', label: 'What qualities have helped their relationship endure and grow over the years?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular memory that captures what their relationship has meant to you or to those around them?', type: 'textarea' },
        { id: 'q6', label: 'What would you like to wish them for the years they still have ahead of them together?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What do you remember about the couple when they first got together, and what has changed most since then?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest story you can remember from their years together?', type: 'textarea' },
        { id: 'q3', label: 'What habits or quirks have they somehow managed to put up with in each other all these years?', type: 'textarea' },
        { id: 'q4', label: 'What memorable mishap, argument, holiday, celebration or disaster involving the couple could make a great story?', type: 'textarea' },
        { id: 'q5', label: 'What is something they did years ago that would be completely out of character for them now?', type: 'textarea' },
        { id: 'q6', label: 'If you could give them one piece of humorous advice for surviving the next chapter of their relationship, what would it be?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most treasured memory of the couple or their life together?', type: 'textarea' },
        { id: 'q2', label: 'Was there a particular moment when you realised just how deeply they cared for each other?', type: 'textarea' },
        { id: 'q3', label: 'What have you witnessed in their relationship that has stayed with you over the years?', type: 'textarea' },
        { id: 'q4', label: 'How have they influenced your life or the lives of the people around them?', type: 'textarea' },
        { id: 'q5', label: 'What do you think has allowed their love and commitment to endure through the years?', type: 'textarea' },
        { id: 'q6', label: 'If you could give them one message to carry with them into the next chapter of their life together, what would you say?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'After all these years, what is the funniest thing you can say absolu about tely cathem thnnot deat theyny?', type: 'textarea' },
        { id: 'q2', label: 'What ridiculous story from their relationship has somehow survived all these years and still deserves to be dragged out tonight?', type: 'textarea' },
        { id: 'q3', label: 'Which of their habits or personality traits would have had you placing bets on the marriage not making it this far?', type: 'textarea' },
        { id: 'q4', label: 'What have they argued about, disagreed over or stubbornly refused to admit defeat on that could now be safely turned into a joke?', type: 'textarea' },
        { id: 'q5', label: 'If their years together were reviewed like a badly managed business, what would be their biggest success, biggest failure and most questionable decision?', type: 'textarea' },
        { id: 'q6', label: 'If they had to publish an instruction manual for surviving another anniversary, what absolutely essential rule would you put on page one?', type: 'textarea' }
      ]
    }
  },

  'engagement-party': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'coupleNames', label: 'Names of the couple', type: 'text', required: true },
      { id: 'relationshipToCouple', label: 'How do you know the couple?', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'How did you first meet the couple, and what was your first impression of each of them?', type: 'textarea' },
        { id: 'q2', label: 'When did you first realise that their relationship was becoming something serious?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How did they meet, and what did you honestly think when you first heard they were getting together?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest or most ridiculous thing you\'ve witnessed since they became a couple?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most meaningful memory of the couple since they first got together?', type: 'textarea' },
        { id: 'q2', label: 'When did you first see how deeply they cared for one another?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'How did these two actually get together, and at what point did you realise this was going to become everyone else\'s problem?', type: 'textarea' },
        { id: 'q2', label: 'What is the most ridiculous thing either of them has done since they became a couple?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'How did you first meet the couple, and what was your first impression of each of them?', type: 'textarea' },
        { id: 'q2', label: 'When did you first realise that their relationship was becoming something serious?', type: 'textarea' },
        { id: 'q3', label: 'What qualities do they each bring to the relationship that make them well suited to one another?', type: 'textarea' },
        { id: 'q4', label: 'What moment or experience best demonstrates the strength of their relationship?', type: 'textarea' },
        { id: 'q5', label: 'How have you seen them support or influence each other since they got together?', type: 'textarea' },
        { id: 'q6', label: 'What sincere wish or piece of advice would you like to give them as they begin this next chapter together?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How did they meet, and what did you honestly think when you first heard they were getting together?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest or most ridiculous thing you\'ve witnessed since they became a couple?', type: 'textarea' },
        { id: 'q3', label: 'What habit, quirk or personality trait does one of them have that the other has somehow agreed to tolerate?', type: 'textarea' },
        { id: 'q4', label: 'Was there a moment when you thought, "Yep, these two are definitely going to get married"?', type: 'textarea' },
        { id: 'q5', label: 'What embarrassing, awkward or questionable story about either of them can safely be told in front of both families?', type: 'textarea' },
        { id: 'q6', label: 'What piece of deliberately unhelpful relationship advice would you give them before the wedding?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most meaningful memory of the couple since they first got together?', type: 'textarea' },
        { id: 'q2', label: 'When did you first see how deeply they cared for one another?', type: 'textarea' },
        { id: 'q3', label: 'What have you witnessed in their relationship that has particularly moved or inspired you?', type: 'textarea' },
        { id: 'q4', label: 'How has their relationship changed or enriched the lives of the people around them?', type: 'textarea' },
        { id: 'q5', label: 'What qualities do you think will help them build a happy life together?', type: 'textarea' },
        { id: 'q6', label: 'If you could give them one heartfelt message to carry with them towards their wedding and beyond, what would you say?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'How did these two actually get together, and at what point did you realise this was going to become everyone else\'s problem?', type: 'textarea' },
        { id: 'q2', label: 'What is the most ridiculous thing either of them has done since they became a couple?', type: 'textarea' },
        { id: 'q3', label: 'Which of their habits or personality defects makes you wonder how they have made it this far?', type: 'textarea' },
        { id: 'q4', label: 'What is the most embarrassing story about either of them that is technically safe to tell now that they\'re engaged?', type: 'textarea' },
        { id: 'q5', label: 'If their relationship came with a warning label, what would it say?', type: 'textarea' },
        { id: 'q6', label: 'What brutally honest piece of advice would you give them before they make the catastrophic decision to get married?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'How did you first meet the couple, and what was your first impression of each of them?', type: 'textarea' },
        { id: 'q2', label: 'When did you first realise that their relationship was becoming something serious?', type: 'textarea' },
        { id: 'q3', label: 'What qualities do they each bring to the relationship that make them well suited to one another?', type: 'textarea' },
        { id: 'q4', label: 'What moment or experience best demonstrates the strength of their relationship?', type: 'textarea' },
        { id: 'q5', label: 'How have you seen them support or influence each other since they got together?', type: 'textarea' },
        { id: 'q6', label: 'What sincere wish or piece of advice would you like to give them as they begin this next chapter together?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How did they meet, and what did you honestly think when you first heard they were getting together?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest or most ridiculous thing you\'ve witnessed since they became a couple?', type: 'textarea' },
        { id: 'q3', label: 'What habit, quirk or personality trait does one of them have that the other has somehow agreed to tolerate?', type: 'textarea' },
        { id: 'q4', label: 'Was there a moment when you thought, "Yep, these two are definitely going to get married"?', type: 'textarea' },
        { id: 'q5', label: 'What embarrassing, awkward or questionable story about either of them can safely be told in front of both families?', type: 'textarea' },
        { id: 'q6', label: 'What piece of deliberately unhelpful relationship advice would you give them before the wedding?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most meaningful memory of the couple since they first got together?', type: 'textarea' },
        { id: 'q2', label: 'When did you first see how deeply they cared for one another?', type: 'textarea' },
        { id: 'q3', label: 'What have you witnessed in their relationship that has particularly moved or inspired you?', type: 'textarea' },
        { id: 'q4', label: 'How has their relationship changed or enriched the lives of the people around them?', type: 'textarea' },
        { id: 'q5', label: 'What qualities do you think will help them build a happy life together?', type: 'textarea' },
        { id: 'q6', label: 'If you could give them one heartfelt message to carry with them towards their wedding and beyond, what would you say?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'How did these two actually get together, and at what point did you realise this was going to become everyone else\'s problem?', type: 'textarea' },
        { id: 'q2', label: 'What is the most ridiculous thing either of them has done since they became a couple?', type: 'textarea' },
        { id: 'q3', label: 'Which of their habits or personality defects makes you wonder how they have made it this far?', type: 'textarea' },
        { id: 'q4', label: 'What is the most embarrassing story about either of them that is technically safe to tell now that they\'re engaged?', type: 'textarea' },
        { id: 'q5', label: 'If their relationship came with a warning label, what would it say?', type: 'textarea' },
        { id: 'q6', label: 'What brutally honest piece of advice would you give them before they make the catastrophic decision to get married?', type: 'textarea' }
      ]
    }
  },

  'baby-shower': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'parentsNames', label: 'Names of the parents-to-be', type: 'text', required: true },
      { id: 'relationshipToParents', label: 'How do you know the parents-to-be?', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'What is your relationship to the parents-to-be, and how long have you known them?', type: 'textarea' },
        { id: 'q2', label: 'What qualities do they each have that you think will make them good parents?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How do you know the parents-to-be, and what was your immediate reaction when you heard they were going to have a baby?', type: 'textarea' },
        { id: 'q2', label: 'Which of the parents is most likely to be the organised one — and which is going to need adult supervision?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most meaningful memory of the parents-to-be and their journey together?', type: 'textarea' },
        { id: 'q2', label: 'When did you first realise how much they were looking forward to becoming parents?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'Which parent is actually going to be in charge once the baby arrives, and what evidence do you have?', type: 'textarea' },
        { id: 'q2', label: 'Who is most likely to panic at 3 a.m., and who is most likely to Google the symptoms and make everything considerably worse?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'What is your relationship to the parents-to-be, and how long have you known them?', type: 'textarea' },
        { id: 'q2', label: 'What qualities do they each have that you think will make them good parents?', type: 'textarea' },
        { id: 'q3', label: 'What moment during their journey towards becoming parents has stood out to you?', type: 'textarea' },
        { id: 'q4', label: 'What have you seen in their relationship that gives you confidence in the family they are about to build?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular memory or experience that you hope they will carry with them into parenthood?', type: 'textarea' },
        { id: 'q6', label: 'What sincere wish would you like to make for the parents and their new baby?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How do you know the parents-to-be, and what was your immediate reaction when you heard they were going to have a baby?', type: 'textarea' },
        { id: 'q2', label: 'Which of the parents is most likely to be the organised one — and which is going to need adult supervision?', type: 'textarea' },
        { id: 'q3', label: 'What funny habit, personality trait or questionable life choice do you predict their baby will have to put up with?', type: 'textarea' },
        { id: 'q4', label: 'What is the funniest or most ridiculous thing either parent has done that might give us some indication of what is coming?', type: 'textarea' },
        { id: 'q5', label: 'Which piece of conventional parenting advice are they least likely to follow?', type: 'textarea' },
        { id: 'q6', label: 'What humorous piece of completely unsolicited advice would you give them before the baby arrives?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most meaningful memory of the parents-to-be and their journey together?', type: 'textarea' },
        { id: 'q2', label: 'When did you first realise how much they were looking forward to becoming parents?', type: 'textarea' },
        { id: 'q3', label: 'What qualities in them make you particularly excited for this baby to join their family?', type: 'textarea' },
        { id: 'q4', label: 'Is there a moment that showed you how much love they already have for their unborn child?', type: 'textarea' },
        { id: 'q5', label: 'What do you hope their child will grow up knowing about the people and family who welcomed them into the world?', type: 'textarea' },
        { id: 'q6', label: 'What heartfelt wish would you like to make for this new family as they begin this next chapter?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'Which parent is actually going to be in charge once the baby arrives, and what evidence do you have?', type: 'textarea' },
        { id: 'q2', label: 'Who is most likely to panic at 3 a.m., and who is most likely to Google the symptoms and make everything considerably worse?', type: 'textarea' },
        { id: 'q3', label: 'What existing habit, personality flaw or questionable lifestyle choice is the baby about to inherit?', type: 'textarea' },
        { id: 'q4', label: 'What is the funniest thing either parent has ever done that makes you think, "Christ, they\'re responsible for a child now"?', type: 'textarea' },
        { id: 'q5', label: 'If the baby could read the parents\' history before being born, what would they immediately have questions about?', type: 'textarea' },
        { id: 'q6', label: 'What brutally honest piece of advice would you give the parents before they discover that absolutely nobody knows what they\'re doing?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'What is your relationship to the parents-to-be, and how long have you known them?', type: 'textarea' },
        { id: 'q2', label: 'What qualities do they each have that you think will make them good parents?', type: 'textarea' },
        { id: 'q3', label: 'What moment during their journey towards becoming parents has stood out to you?', type: 'textarea' },
        { id: 'q4', label: 'What have you seen in their relationship that gives you confidence in the family they are about to build?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular memory or experience that you hope they will carry with them into parenthood?', type: 'textarea' },
        { id: 'q6', label: 'What sincere wish would you like to make for the parents and their new baby?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How do you know the parents-to-be, and what was your immediate reaction when you heard they were going to have a baby?', type: 'textarea' },
        { id: 'q2', label: 'Which of the parents is most likely to be the organised one — and which is going to need adult supervision?', type: 'textarea' },
        { id: 'q3', label: 'What funny habit, personality trait or questionable life choice do you predict their baby will have to put up with?', type: 'textarea' },
        { id: 'q4', label: 'What is the funniest or most ridiculous thing either parent has done that might give us some indication of what is coming?', type: 'textarea' },
        { id: 'q5', label: 'Which piece of conventional parenting advice are they least likely to follow?', type: 'textarea' },
        { id: 'q6', label: 'What humorous piece of completely unsolicited advice would you give them before the baby arrives?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your most meaningful memory of the parents-to-be and their journey together?', type: 'textarea' },
        { id: 'q2', label: 'When did you first realise how much they were looking forward to becoming parents?', type: 'textarea' },
        { id: 'q3', label: 'What qualities in them make you particularly excited for this baby to join their family?', type: 'textarea' },
        { id: 'q4', label: 'Is there a moment that showed you how much love they already have for their unborn child?', type: 'textarea' },
        { id: 'q5', label: 'What do you hope their child will grow up knowing about the people and family who welcomed them into the world?', type: 'textarea' },
        { id: 'q6', label: 'What heartfelt wish would you like to make for this new family as they begin this next chapter?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'Which parent is actually going to be in charge once the baby arrives, and what evidence do you have?', type: 'textarea' },
        { id: 'q2', label: 'Who is most likely to panic at 3 a.m., and who is most likely to Google the symptoms and make everything considerably worse?', type: 'textarea' },
        { id: 'q3', label: 'What existing habit, personality flaw or questionable lifestyle choice is the baby about to inherit?', type: 'textarea' },
        { id: 'q4', label: 'What is the funniest thing either parent has ever done that makes you think, "Christ, they\'re responsible for a child now"?', type: 'textarea' },
        { id: 'q5', label: 'If the baby could read the parents\' history before being born, what would they immediately have questions about?', type: 'textarea' },
        { id: 'q6', label: 'What brutally honest piece of advice would you give the parents before they discover that absolutely nobody knows what they\'re doing?', type: 'textarea' }
      ]
    }
  },

  // ========================================
  // CORPORATE OR PROFESSIONAL
  // ========================================

  'company-anniversary': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'companyName', label: 'Company name', type: 'text', required: true },
      { id: 'yearsOfService', label: 'How long have you been with the company?', type: 'text', required: true },
      { id: 'anniversaryYears', label: 'How many years is the company celebrating?', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'How long have you been with the company, and what has your role or position been during that time?', type: 'textarea' },
        { id: 'q2', label: 'What do you remember most clearly about the company when you first joined, and what has changed since then?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How long have you worked here, what was your job when you started, and how different is your role now?', type: 'textarea' },
        { id: 'q2', label: 'What is the biggest change you\'ve witnessed since joining — apart from the number of meetings?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'How long have you been part of the company, and what has your journey through the business meant to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What moment during your time here made you feel particularly proud to be part of the company?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'How long have you been here, what did you actually do when you started, and how much of that job do you still understand?', type: 'textarea' },
        { id: 'q2', label: 'What is the most ridiculous thing that has happened at the company during your time here?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'How long have you been with the company, and what has your role or position been during that time?', type: 'textarea' },
        { id: 'q2', label: 'What do you remember most clearly about the company when you first joined, and what has changed since then?', type: 'textarea' },
        { id: 'q3', label: 'What achievement, milestone or period of growth stands out most to you during your time with the business?', type: 'textarea' },
        { id: 'q4', label: 'What people, teams or individuals have made a particularly significant contribution to the company\'s journey?', type: 'textarea' },
        { id: 'q5', label: 'What do you think is most important to recognise or celebrate about the company at this anniversary?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How long have you worked here, what was your job when you started, and how different is your role now?', type: 'textarea' },
        { id: 'q2', label: 'What is the biggest change you\'ve witnessed since joining — apart from the number of meetings?', type: 'textarea' },
        { id: 'q3', label: 'What memorable mistake, mishap, office tradition or bizarre incident from your time here still gets talked about?', type: 'textarea' },
        { id: 'q4', label: 'Who or what has provided the most entertainment during your time at the company?', type: 'textarea' },
        { id: 'q5', label: 'If you could describe the company\'s journey so far using one ridiculous analogy, what would it be?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'How long have you been part of the company, and what has your journey through the business meant to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What moment during your time here made you feel particularly proud to be part of the company?', type: 'textarea' },
        { id: 'q3', label: 'Which colleagues, mentors or teams have had the greatest impact on you during your time here?', type: 'textarea' },
        { id: 'q4', label: 'Is there a particular challenge, achievement or period of change that brought the people in the company together?', type: 'textarea' },
        { id: 'q5', label: 'When you look back at the company\'s journey, what are you most grateful to have been part of?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'How long have you been here, what did you actually do when you started, and how much of that job do you still understand?', type: 'textarea' },
        { id: 'q2', label: 'What is the most ridiculous thing that has happened at the company during your time here?', type: 'textarea' },
        { id: 'q3', label: 'Which colleague, department or company habit deserves the dubious honour of being the biggest source of workplace chaos?', type: 'textarea' },
        { id: 'q4', label: 'What company decision, policy or change from the past makes you wonder what the people in charge were smoking?', type: 'textarea' },
        { id: 'q5', label: 'If you had to give the company a brutally honest review after all these years, what would the headline be?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'How long have you been with the company, and what has your role or position been during that time?', type: 'textarea' },
        { id: 'q2', label: 'What do you remember most clearly about the company when you first joined, and what has changed since then?', type: 'textarea' },
        { id: 'q3', label: 'What achievement, milestone or period of growth stands out most to you during your time with the business?', type: 'textarea' },
        { id: 'q4', label: 'What people, teams or individuals have made a particularly significant contribution to the company\'s journey?', type: 'textarea' },
        { id: 'q5', label: 'What do you think is most important to recognise or celebrate about the company at this anniversary?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How long have you worked here, what was your job when you started, and how different is your role now?', type: 'textarea' },
        { id: 'q2', label: 'What is the biggest change you\'ve witnessed since joining — apart from the number of meetings?', type: 'textarea' },
        { id: 'q3', label: 'What memorable mistake, mishap, office tradition or bizarre incident from your time here still gets talked about?', type: 'textarea' },
        { id: 'q4', label: 'Who or what has provided the most entertainment during your time at the company?', type: 'textarea' },
        { id: 'q5', label: 'If you could describe the company\'s journey so far using one ridiculous analogy, what would it be?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'How long have you been part of the company, and what has your journey through the business meant to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What moment during your time here made you feel particularly proud to be part of the company?', type: 'textarea' },
        { id: 'q3', label: 'Which colleagues, mentors or teams have had the greatest impact on you during your time here?', type: 'textarea' },
        { id: 'q4', label: 'Is there a particular challenge, achievement or period of change that brought the people in the company together?', type: 'textarea' },
        { id: 'q5', label: 'When you look back at the company\'s journey, what are you most grateful to have been part of?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'How long have you been here, what did you actually do when you started, and how much of that job do you still understand?', type: 'textarea' },
        { id: 'q2', label: 'What is the most ridiculous thing that has happened at the company during your time here?', type: 'textarea' },
        { id: 'q3', label: 'Which colleague, department or company habit deserves the dubious honour of being the biggest source of workplace chaos?', type: 'textarea' },
        { id: 'q4', label: 'What company decision, policy or change from the past makes you wonder what the people in charge were smoking?', type: 'textarea' },
        { id: 'q5', label: 'If you had to give the company a brutally honest review after all these years, what would the headline be?', type: 'textarea' }
      ]
    }
  },

  'retirement-party': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'retireeName', label: 'Name of person retiring', type: 'text', required: true },
      { id: 'relationshipToRetiree', label: 'How do you know them?', type: 'text', required: true },
      { id: 'yearsOfService', label: 'How long have they worked here?', type: 'text' }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'What is your relationship to the retiree, and how long have you known or worked with them?', type: 'textarea' },
        { id: 'q2', label: 'What has their role or contribution to the organisation meant to you and those around them?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How long have you known or worked with the retiree, and what was your first impression of them?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest, strangest or most memorable thing that happened during their working life?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your relationship with the retiree, and what has knowing or working with them meant to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What moment or experience from their career has stayed with you most strongly?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'How long have you known or worked with them, and how much of their actual job do you think they have been successfully avoiding all these years?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest incident, workplace disaster or spectacular bit of nonsense from their career that absolutely has to be mentioned tonight?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'What is your relationship to the retiree, and how long have you known or worked with them?', type: 'textarea' },
        { id: 'q2', label: 'What has their role or contribution to the organisation meant to you and those around them?', type: 'textarea' },
        { id: 'q3', label: 'What achievement, project or period during their career stands out as particularly significant?', type: 'textarea' },
        { id: 'q4', label: 'What qualities have made them such a valued colleague, leader, mentor or friend?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular moment from their career that you think deserves to be remembered and celebrated?', type: 'textarea' },
        { id: 'q6', label: 'What would you like to wish them as they begin this next chapter of their life?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How long have you known or worked with the retiree, and what was your first impression of them?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest, strangest or most memorable thing that happened during their working life?', type: 'textarea' },
        { id: 'q3', label: 'What workplace habit or personality trait are everyone going to miss — or finally be relieved to escape?', type: 'textarea' },
        { id: 'q4', label: 'What is the most questionable decision, mishap or piece of advice from their career that can safely be mentioned tonight?', type: 'textarea' },
        { id: 'q5', label: 'What do you think they will actually do with all their newfound free time?', type: 'textarea' },
        { id: 'q6', label: 'If you could give them one piece of humorous advice for surviving retirement, what would it be?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your relationship with the retiree, and what has knowing or working with them meant to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What moment or experience from their career has stayed with you most strongly?', type: 'textarea' },
        { id: 'q3', label: 'How have they made a difference to the people they have worked with or the organisation they have been part of?', type: 'textarea' },
        { id: 'q4', label: 'Is there a particular quality, kindness or act of support from them that you will always remember?', type: 'textarea' },
        { id: 'q5', label: 'What do you think their colleagues, friends or family will miss most about having them around?', type: 'textarea' },
        { id: 'q6', label: 'What heartfelt wish would you like to give them as they leave working life behind and begin their next chapter?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'How long have you known or worked with them, and how much of their actual job do you think they have been successfully avoiding all these years?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest incident, workplace disaster or spectacular bit of nonsense from their career that absolutely has to be mentioned tonight?', type: 'textarea' },
        { id: 'q3', label: 'What annoying habit or workplace behaviour are you secretly delighted you will never have to deal with again?', type: 'textarea' },
        { id: 'q4', label: 'What is the most suspiciously convenient excuse they have ever used to get out of doing something at work?', type: 'textarea' },
        { id: 'q5', label: 'What do you reckon they will actually do with retirement — and how long before they start annoying everyone at home?', type: 'textarea' },
        { id: 'q6', label: 'If retirement came with an employee exit interview, what would their final review say?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'What is your relationship to the retiree, and how long have you known or worked with them?', type: 'textarea' },
        { id: 'q2', label: 'What has their role or contribution to the organisation meant to you and those around them?', type: 'textarea' },
        { id: 'q3', label: 'What achievement, project or period during their career stands out as particularly significant?', type: 'textarea' },
        { id: 'q4', label: 'What qualities have made them such a valued colleague, leader, mentor or friend?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular moment from their career that you think deserves to be remembered and celebrated?', type: 'textarea' },
        { id: 'q6', label: 'What would you like to wish them as they begin this next chapter of their life?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'How long have you known or worked with the retiree, and what was your first impression of them?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest, strangest or most memorable thing that happened during their working life?', type: 'textarea' },
        { id: 'q3', label: 'What workplace habit or personality trait are everyone going to miss — or finally be relieved to escape?', type: 'textarea' },
        { id: 'q4', label: 'What is the most questionable decision, mishap or piece of advice from their career that can safely be mentioned tonight?', type: 'textarea' },
        { id: 'q5', label: 'What do you think they will actually do with all their newfound free time?', type: 'textarea' },
        { id: 'q6', label: 'If you could give them one piece of humorous advice for surviving retirement, what would it be?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is your relationship with the retiree, and what has knowing or working with them meant to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What moment or experience from their career has stayed with you most strongly?', type: 'textarea' },
        { id: 'q3', label: 'How have they made a difference to the people they have worked with or the organisation they have been part of?', type: 'textarea' },
        { id: 'q4', label: 'Is there a particular quality, kindness or act of support from them that you will always remember?', type: 'textarea' },
        { id: 'q5', label: 'What do you think their colleagues, friends or family will miss most about having them around?', type: 'textarea' },
        { id: 'q6', label: 'What heartfelt wish would you like to give them as they leave working life behind and begin their next chapter?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'How long have you known or worked with them, and how much of their actual job do you think they have been successfully avoiding all these years?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest incident, workplace disaster or spectacular bit of nonsense from their career that absolutely has to be mentioned tonight?', type: 'textarea' },
        { id: 'q3', label: 'What annoying habit or workplace behaviour are you secretly delighted you will never have to deal with again?', type: 'textarea' },
        { id: 'q4', label: 'What is the most suspiciously convenient excuse they have ever used to get out of doing something at work?', type: 'textarea' },
        { id: 'q5', label: 'What do you reckon they will actually do with retirement — and how long before they start annoying everyone at home?', type: 'textarea' },
        { id: 'q6', label: 'If retirement came with an employee exit interview, what would their final review say?', type: 'textarea' }
      ]
    }
  },

  // ========================================
  // MILESTONE CELEBRATIONS
  // ========================================

  'achievement-celebration': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'achievementName', label: 'What achievement is being celebrated?', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'What is the achievement being celebrated, and what exactly did you accomplish?', type: 'textarea' },
        { id: 'q2', label: 'What motivated you to pursue this achievement, and why was it important to you?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What exactly have you achieved, and how much of it was skill, determination and sheer luck?', type: 'textarea' },
        { id: 'q2', label: 'What was the funniest, strangest or most unexpected thing that happened while you were trying to achieve it?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is the achievement being celebrated, and what does reaching this milestone mean to you?', type: 'textarea' },
        { id: 'q2', label: 'What personal journey, sacrifice or determination lies behind the achievement that people may not have seen?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What exactly have you achieved, and let\'s be honest — how surprised are you that you actually managed it?', type: 'textarea' },
        { id: 'q2', label: 'What went spectacularly wrong on the way there, and what story absolutely has to be told tonight?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'What is the achievement being celebrated, and what exactly did you accomplish?', type: 'textarea' },
        { id: 'q2', label: 'What motivated you to pursue this achievement, and why was it important to you?', type: 'textarea' },
        { id: 'q3', label: 'What were the biggest challenges, obstacles or setbacks you had to overcome along the way?', type: 'textarea' },
        { id: 'q4', label: 'Who helped, supported or encouraged you during the journey, and what did their support mean to you?', type: 'textarea' },
        { id: 'q5', label: 'What does achieving this milestone mean to you personally, professionally or to those around you?', type: 'textarea' },
        { id: 'q6', label: 'What would you like people to take away from your achievement, and what are you hoping to do next?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What exactly have you achieved, and how much of it was skill, determination and sheer luck?', type: 'textarea' },
        { id: 'q2', label: 'What was the funniest, strangest or most unexpected thing that happened while you were trying to achieve it?', type: 'textarea' },
        { id: 'q3', label: 'What went wrong along the way, and which disaster are you now able to laugh about?', type: 'textarea' },
        { id: 'q4', label: 'Who deserves credit for helping you get there — and who made the whole process considerably harder than it needed to be?', type: 'textarea' },
        { id: 'q5', label: 'At what point did you think, "Bloody hell, I might actually pull this off"?', type: 'textarea' },
        { id: 'q6', label: 'Now that you\'ve achieved it, what completely unnecessary or ridiculous thing are you going to do next?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is the achievement being celebrated, and what does reaching this milestone mean to you?', type: 'textarea' },
        { id: 'q2', label: 'What personal journey, sacrifice or determination lies behind the achievement that people may not have seen?', type: 'textarea' },
        { id: 'q3', label: 'Was there a particular moment when you nearly gave up, or when you realised you were going to succeed?', type: 'textarea' },
        { id: 'q4', label: 'Who has supported you along the way, and what would you like them to know about the part they played?', type: 'textarea' },
        { id: 'q5', label: 'How has achieving this changed the way you see yourself, your future or what you are capable of?', type: 'textarea' },
        { id: 'q6', label: 'If you could look back at yourself before you began and say one thing, what would you want to tell that person?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What exactly have you achieved, and let\'s be honest — how surprised are you that you actually managed it?', type: 'textarea' },
        { id: 'q2', label: 'What went spectacularly wrong on the way there, and what story absolutely has to be told tonight?', type: 'textarea' },
        { id: 'q3', label: 'Who helped you achieve it, and who should probably receive some sort of formal apology for having to put up with you?', type: 'textarea' },
        { id: 'q4', label: 'What was your lowest point during the process, and how close were you to saying, "Fuck this, I\'m off"?', type: 'textarea' },
        { id: 'q5', label: 'What is the most ridiculous thing you did in pursuit of this achievement that, in hindsight, probably wasn\'t necessary?', type: 'textarea' },
        { id: 'q6', label: 'Now that you\'ve reached the summit, what is the next completely unnecessary challenge you\'re likely to set yourself?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'What is the achievement being celebrated, and what exactly did you accomplish?', type: 'textarea' },
        { id: 'q2', label: 'What motivated you to pursue this achievement, and why was it important to you?', type: 'textarea' },
        { id: 'q3', label: 'What were the biggest challenges, obstacles or setbacks you had to overcome along the way?', type: 'textarea' },
        { id: 'q4', label: 'Who helped, supported or encouraged you during the journey, and what did their support mean to you?', type: 'textarea' },
        { id: 'q5', label: 'What does achieving this milestone mean to you personally, professionally or to those around you?', type: 'textarea' },
        { id: 'q6', label: 'What would you like people to take away from your achievement, and what are you hoping to do next?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What exactly have you achieved, and how much of it was skill, determination and sheer luck?', type: 'textarea' },
        { id: 'q2', label: 'What was the funniest, strangest or most unexpected thing that happened while you were trying to achieve it?', type: 'textarea' },
        { id: 'q3', label: 'What went wrong along the way, and which disaster are you now able to laugh about?', type: 'textarea' },
        { id: 'q4', label: 'Who deserves credit for helping you get there — and who made the whole process considerably harder than it needed to be?', type: 'textarea' },
        { id: 'q5', label: 'At what point did you think, "Bloody hell, I might actually pull this off"?', type: 'textarea' },
        { id: 'q6', label: 'Now that you\'ve achieved it, what completely unnecessary or ridiculous thing are you going to do next?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What is the achievement being celebrated, and what does reaching this milestone mean to you?', type: 'textarea' },
        { id: 'q2', label: 'What personal journey, sacrifice or determination lies behind the achievement that people may not have seen?', type: 'textarea' },
        { id: 'q3', label: 'Was there a particular moment when you nearly gave up, or when you realised you were going to succeed?', type: 'textarea' },
        { id: 'q4', label: 'Who has supported you along the way, and what would you like them to know about the part they played?', type: 'textarea' },
        { id: 'q5', label: 'How has achieving this changed the way you see yourself, your future or what you are capable of?', type: 'textarea' },
        { id: 'q6', label: 'If you could look back at yourself before you began and say one thing, what would you want to tell that person?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What exactly have you achieved, and let\'s be honest — how surprised are you that you actually managed it?', type: 'textarea' },
        { id: 'q2', label: 'What went spectacularly wrong on the way there, and what story absolutely has to be told tonight?', type: 'textarea' },
        { id: 'q3', label: 'Who helped you achieve it, and who should probably receive some sort of formal apology for having to put up with you?', type: 'textarea' },
        { id: 'q4', label: 'What was your lowest point during the process, and how close were you to saying, "Fuck this, I\'m off"?', type: 'textarea' },
        { id: 'q5', label: 'What is the most ridiculous thing you did in pursuit of this achievement that, in hindsight, probably wasn\'t necessary?', type: 'textarea' },
        { id: 'q6', label: 'Now that you\'ve reached the summit, what is the next completely unnecessary challenge you\'re likely to set yourself?', type: 'textarea' }
      ]
    }
  },

  // ========================================
  // MEMORIALS & TRIBUTES
  // ========================================

  'eulogy': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'deceasedName', label: 'Name of the deceased', type: 'text', required: true },
      { id: 'relationshipToDeceased', label: 'Your relationship to the deceased', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you know them?', type: 'textarea' },
        { id: 'q2', label: 'What qualities, values or characteristics best defined them as a person?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you have to put up with them?', type: 'textarea' },
        { id: 'q2', label: 'What funny habit, personality trait or quirk of theirs could you never quite get used to?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what did they mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What is your most treasured memory of them?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what exactly did they put you through over the years?', type: 'textarea' },
        { id: 'q2', label: 'What was their most gloriously annoying habit or personality trait?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you know them?', type: 'textarea' },
        { id: 'q2', label: 'What qualities, values or characteristics best defined them as a person?', type: 'textarea' },
        { id: 'q3', label: 'What achievement, contribution or aspect of their life do you think deserves particular recognition?', type: 'textarea' },
        { id: 'q4', label: 'What is the most meaningful memory you have of them, or the moment that best captures who they were?', type: 'textarea' },
        { id: 'q5', label: 'What did they mean to you, your family, friends or wider community?', type: 'textarea' },
        { id: 'q6', label: 'What would you most like people to remember about them after today?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you have to put up with them?', type: 'textarea' },
        { id: 'q2', label: 'What funny habit, personality trait or quirk of theirs could you never quite get used to?', type: 'textarea' },
        { id: 'q3', label: 'What is the funniest, most embarrassing or most ridiculous story about them that can be told appropriately today?', type: 'textarea' },
        { id: 'q4', label: 'What was something they regularly did that would make everyone who knew them immediately think, "Yep, that\'s them"?', type: 'textarea' },
        { id: 'q5', label: 'What memorable mishap, bad decision or piece of questionable advice from them still makes you laugh?', type: 'textarea' },
        { id: 'q6', label: 'If they could hear this speech, what would they probably heckle you about for getting wrong?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what did they mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What is your most treasured memory of them?', type: 'textarea' },
        { id: 'q3', label: 'What quality, kindness or part of their character touched your life most deeply?', type: 'textarea' },
        { id: 'q4', label: 'How did they influence or shape the lives of the people around them?', type: 'textarea' },
        { id: 'q5', label: 'What do you think you will miss most about them now that they are gone?', type: 'textarea' },
        { id: 'q6', label: 'If you could say one final thing directly to them today, what would you want them to know?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what exactly did they put you through over the years?', type: 'textarea' },
        { id: 'q2', label: 'What was their most gloriously annoying habit or personality trait?', type: 'textarea' },
        { id: 'q3', label: 'What story about them would have the people who knew them best crying with laughter — rather than crying for the usual reasons?', type: 'textarea' },
        { id: 'q4', label: 'What completely ridiculous thing did they believe, do or insist upon that became part of their legend?', type: 'textarea' },
        { id: 'q5', label: 'What was their greatest piece of bad advice, questionable decision or spectacularly unnecessary bit of behaviour?', type: 'textarea' },
        { id: 'q6', label: 'If they were here now, what would they be shouting at you for saying in this speech?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you know them?', type: 'textarea' },
        { id: 'q2', label: 'What qualities, values or characteristics best defined them as a person?', type: 'textarea' },
        { id: 'q3', label: 'What achievement, contribution or aspect of their life do you think deserves particular recognition?', type: 'textarea' },
        { id: 'q4', label: 'What is the most meaningful memory you have of them, or the moment that best captures who they were?', type: 'textarea' },
        { id: 'q5', label: 'What did they mean to you, your family, friends or wider community?', type: 'textarea' },
        { id: 'q6', label: 'What would you most like people to remember about them after today?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you have to put up with them?', type: 'textarea' },
        { id: 'q2', label: 'What funny habit, personality trait or quirk of theirs could you never quite get used to?', type: 'textarea' },
        { id: 'q3', label: 'What is the funniest, most embarrassing or most ridiculous story about them that can be told appropriately today?', type: 'textarea' },
        { id: 'q4', label: 'What was something they regularly did that would make everyone who knew them immediately think, "Yep, that\'s them"?', type: 'textarea' },
        { id: 'q5', label: 'What memorable mishap, bad decision or piece of questionable advice from them still makes you laugh?', type: 'textarea' },
        { id: 'q6', label: 'If they could hear this speech, what would they probably heckle you about for getting wrong?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what did they mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What is your most treasured memory of them?', type: 'textarea' },
        { id: 'q3', label: 'What quality, kindness or part of their character touched your life most deeply?', type: 'textarea' },
        { id: 'q4', label: 'How did they influence or shape the lives of the people around them?', type: 'textarea' },
        { id: 'q5', label: 'What do you think you will miss most about them now that they are gone?', type: 'textarea' },
        { id: 'q6', label: 'If you could say one final thing directly to them today, what would you want them to know?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what exactly did they put you through over the years?', type: 'textarea' },
        { id: 'q2', label: 'What was their most gloriously annoying habit or personality trait?', type: 'textarea' },
        { id: 'q3', label: 'What story about them would have the people who knew them best crying with laughter — rather than crying for the usual reasons?', type: 'textarea' },
        { id: 'q4', label: 'What completely ridiculous thing did they believe, do or insist upon that became part of their legend?', type: 'textarea' },
        { id: 'q5', label: 'What was their greatest piece of bad advice, questionable decision or spectacularly unnecessary bit of behaviour?', type: 'textarea' },
        { id: 'q6', label: 'If they were here now, what would they be shouting at you for saying in this speech?', type: 'textarea' }
      ]
    }
  },

  'celebration-of-life': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'deceasedName', label: 'Name of the deceased', type: 'text', required: true },
      { id: 'relationshipToDeceased', label: 'Your relationship to the deceased', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you know them?', type: 'textarea' },
        { id: 'q2', label: 'What qualities, values or characteristics best defined them as a person?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you have the pleasure — or misfortune — of knowing them?', type: 'textarea' },
        { id: 'q2', label: 'What funny habit, quirk or personality trait made them unmistakably themselves?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what did they mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What is the memory of them that you treasure most?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what sort of trouble did you regularly find yourselves getting into together?', type: 'textarea' },
        { id: 'q2', label: 'What was their most ridiculous habit, obsession or personality trait that everyone who knew them will immediately recognise?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you know them?', type: 'textarea' },
        { id: 'q2', label: 'What qualities, values or characteristics best defined them as a person?', type: 'textarea' },
        { id: 'q3', label: 'What achievement, contribution or aspect of their life are you most proud to remember?', type: 'textarea' },
        { id: 'q4', label: 'What memory best captures the person they were and the life they lived?', type: 'textarea' },
        { id: 'q5', label: 'What impact did they have on the people, family, community or world around them?', type: 'textarea' },
        { id: 'q6', label: 'What would you most like everyone here to remember and carry forward about them?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you have the pleasure — or misfortune — of knowing them?', type: 'textarea' },
        { id: 'q2', label: 'What funny habit, quirk or personality trait made them unmistakably themselves?', type: 'textarea' },
        { id: 'q3', label: 'What is the funniest story about them that would have everyone who knew them saying, "That sounds exactly like them"?', type: 'textarea' },
        { id: 'q4', label: 'What memorable mishap, eccentricity or questionable decision perfectly sums up their character?', type: 'textarea' },
        { id: 'q5', label: 'What phrase, saying, joke or bit of behaviour were they particularly known for?', type: 'textarea' },
        { id: 'q6', label: 'If they were here today, what part of this speech would they probably interrupt, correct or take the piss out of you for?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what did they mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What is the memory of them that you treasure most?', type: 'textarea' },
        { id: 'q3', label: 'What quality, kindness or part of their character made such a lasting impression on you?', type: 'textarea' },
        { id: 'q4', label: 'Can you describe a moment when they made you — or someone else — feel particularly loved, supported or valued?', type: 'textarea' },
        { id: 'q5', label: 'What did they bring to the lives of their family, friends and the people around them that you hope will never be forgotten?', type: 'textarea' },
        { id: 'q6', label: 'If you could celebrate one thing about the life they lived, what would you choose and why?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what sort of trouble did you regularly find yourselves getting into together?', type: 'textarea' },
        { id: 'q2', label: 'What was their most ridiculous habit, obsession or personality trait that everyone who knew them will immediately recognise?', type: 'textarea' },
        { id: 'q3', label: 'What story about them is so ridiculous that it could only possibly be true?', type: 'textarea' },
        { id: 'q4', label: 'What completely unnecessary argument, eccentric opinion or hill were they prepared to die on?', type: 'textarea' },
        { id: 'q5', label: 'What piece of classic behaviour from them would have everyone in the room saying, "Oh God, I remember that"?', type: 'textarea' },
        { id: 'q6', label: 'If they could magically appear for five minutes during this celebration, what would they immediately take the piss out of?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you know them?', type: 'textarea' },
        { id: 'q2', label: 'What qualities, values or characteristics best defined them as a person?', type: 'textarea' },
        { id: 'q3', label: 'What achievement, contribution or aspect of their life are you most proud to remember?', type: 'textarea' },
        { id: 'q4', label: 'What memory best captures the person they were and the life they lived?', type: 'textarea' },
        { id: 'q5', label: 'What impact did they have on the people, family, community or world around them?', type: 'textarea' },
        { id: 'q6', label: 'What would you most like everyone here to remember and carry forward about them?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What was your relationship to the deceased, and how long did you have the pleasure — or misfortune — of knowing them?', type: 'textarea' },
        { id: 'q2', label: 'What funny habit, quirk or personality trait made them unmistakably themselves?', type: 'textarea' },
        { id: 'q3', label: 'What is the funniest story about them that would have everyone who knew them saying, "That sounds exactly like them"?', type: 'textarea' },
        { id: 'q4', label: 'What memorable mishap, eccentricity or questionable decision perfectly sums up their character?', type: 'textarea' },
        { id: 'q5', label: 'What phrase, saying, joke or bit of behaviour were they particularly known for?', type: 'textarea' },
        { id: 'q6', label: 'If they were here today, what part of this speech would they probably interrupt, correct or take the piss out of you for?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what did they mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What is the memory of them that you treasure most?', type: 'textarea' },
        { id: 'q3', label: 'What quality, kindness or part of their character made such a lasting impression on you?', type: 'textarea' },
        { id: 'q4', label: 'Can you describe a moment when they made you — or someone else — feel particularly loved, supported or valued?', type: 'textarea' },
        { id: 'q5', label: 'What did they bring to the lives of their family, friends and the people around them that you hope will never be forgotten?', type: 'textarea' },
        { id: 'q6', label: 'If you could celebrate one thing about the life they lived, what would you choose and why?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What was your relationship to the deceased, and what sort of trouble did you regularly find yourselves getting into together?', type: 'textarea' },
        { id: 'q2', label: 'What was their most ridiculous habit, obsession or personality trait that everyone who knew them will immediately recognise?', type: 'textarea' },
        { id: 'q3', label: 'What story about them is so ridiculous that it could only possibly be true?', type: 'textarea' },
        { id: 'q4', label: 'What completely unnecessary argument, eccentric opinion or hill were they prepared to die on?', type: 'textarea' },
        { id: 'q5', label: 'What piece of classic behaviour from them would have everyone in the room saying, "Oh God, I remember that"?', type: 'textarea' },
        { id: 'q6', label: 'If they could magically appear for five minutes during this celebration, what would they immediately take the piss out of?', type: 'textarea' }
      ]
    }
  },

  'charity-gala': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'charityName', label: 'Name of charity or cause', type: 'text', required: true },
      { id: 'yourRole', label: 'Your connection to the charity/cause', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'What charity, cause or organisation is the event supporting, and what is your connection to it?', type: 'textarea' },
        { id: 'q2', label: 'Why is this cause important to you, the organisation or the people you are here to support?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What charity, cause or organisation are we raising money for, and how did you become involved with it?', type: 'textarea' },
        { id: 'q2', label: 'What funny, unexpected or slightly chaotic thing has happened while supporting the cause?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What charity, cause or organisation are we supporting, and what is your personal connection to it?', type: 'textarea' },
        { id: 'q2', label: 'What personal experience first made this cause important to you?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What exactly are we raising money for, and how on earth did you end up getting involved?', type: 'textarea' },
        { id: 'q2', label: 'What is the most ridiculous thing you\'ve done in the name of fundraising — and would you willingly do it again?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'What charity, cause or organisation is the event supporting, and what is your connection to it?', type: 'textarea' },
        { id: 'q2', label: 'Why is this cause important to you, the organisation or the people you are here to support?', type: 'textarea' },
        { id: 'q3', label: 'What difference does the charity\'s work make, and is there a particular example that demonstrates its impact?', type: 'textarea' },
        { id: 'q4', label: 'What achievement, milestone or progress has the organisation made that deserves recognition tonight?', type: 'textarea' },
        { id: 'q5', label: 'Who deserves particular thanks for their work, support, fundraising or contribution to the cause?', type: 'textarea' },
        { id: 'q6', label: 'What would you like guests to take away from tonight and feel inspired to contribute towards?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What charity, cause or organisation are we raising money for, and how did you become involved with it?', type: 'textarea' },
        { id: 'q2', label: 'What funny, unexpected or slightly chaotic thing has happened while supporting the cause?', type: 'textarea' },
        { id: 'q3', label: 'What is the most ridiculous fundraising idea, challenge or event you\'ve encountered — and did it actually work?', type: 'textarea' },
        { id: 'q4', label: 'Who involved with the charity deserves a gentle public roasting for their particular contribution, habit or fundraising obsession?', type: 'textarea' },
        { id: 'q5', label: 'What is the strangest thing you have done, worn, eaten, endured or persuaded other people to do in the name of raising money?', type: 'textarea' },
        { id: 'q6', label: 'What can you say tonight that might persuade people to part with their money while still keeping a smile on their faces?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What charity, cause or organisation are we supporting, and what is your personal connection to it?', type: 'textarea' },
        { id: 'q2', label: 'What personal experience first made this cause important to you?', type: 'textarea' },
        { id: 'q3', label: 'Can you share a story that shows the real difference this charity makes to someone\'s life?', type: 'textarea' },
        { id: 'q4', label: 'Who has inspired you through their connection to the cause, and what have they taught you?', type: 'textarea' },
        { id: 'q5', label: 'What does the support of everyone in this room mean to the people or communities the charity serves?', type: 'textarea' },
        { id: 'q6', label: 'If you could leave everyone tonight with one heartfelt reason to support this cause, what would you want them to remember?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What exactly are we raising money for, and how on earth did you end up getting involved?', type: 'textarea' },
        { id: 'q2', label: 'What is the most ridiculous thing you\'ve done in the name of fundraising — and would you willingly do it again?', type: 'textarea' },
        { id: 'q3', label: 'What fundraising challenge, event or idea sounded absolutely terrible when suggested but somehow became a success?', type: 'textarea' },
        { id: 'q4', label: 'Who deserves to be publicly mocked tonight for their heroic, ridiculous or slightly obsessive approach to raising money?', type: 'textarea' },
        { id: 'q5', label: 'What is the strangest donation, fundraising stunt or attempt to extract money from innocent members of the public you\'ve encountered?', type: 'textarea' },
        { id: 'q6', label: 'If everyone\'s wallets could hear one final argument before tonight\'s donations, what would you say to them?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'What charity, cause or organisation is the event supporting, and what is your connection to it?', type: 'textarea' },
        { id: 'q2', label: 'Why is this cause important to you, the organisation or the people you are here to support?', type: 'textarea' },
        { id: 'q3', label: 'What difference does the charity\'s work make, and is there a particular example that demonstrates its impact?', type: 'textarea' },
        { id: 'q4', label: 'What achievement, milestone or progress has the organisation made that deserves recognition tonight?', type: 'textarea' },
        { id: 'q5', label: 'Who deserves particular thanks for their work, support, fundraising or contribution to the cause?', type: 'textarea' },
        { id: 'q6', label: 'What would you like guests to take away from tonight and feel inspired to contribute towards?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What charity, cause or organisation are we raising money for, and how did you become involved with it?', type: 'textarea' },
        { id: 'q2', label: 'What funny, unexpected or slightly chaotic thing has happened while supporting the cause?', type: 'textarea' },
        { id: 'q3', label: 'What is the most ridiculous fundraising idea, challenge or event you\'ve encountered — and did it actually work?', type: 'textarea' },
        { id: 'q4', label: 'Who involved with the charity deserves a gentle public roasting for their particular contribution, habit or fundraising obsession?', type: 'textarea' },
        { id: 'q5', label: 'What is the strangest thing you have done, worn, eaten, endured or persuaded other people to do in the name of raising money?', type: 'textarea' },
        { id: 'q6', label: 'What can you say tonight that might persuade people to part with their money while still keeping a smile on their faces?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What charity, cause or organisation are we supporting, and what is your personal connection to it?', type: 'textarea' },
        { id: 'q2', label: 'What personal experience first made this cause important to you?', type: 'textarea' },
        { id: 'q3', label: 'Can you share a story that shows the real difference this charity makes to someone\'s life?', type: 'textarea' },
        { id: 'q4', label: 'Who has inspired you through their connection to the cause, and what have they taught you?', type: 'textarea' },
        { id: 'q5', label: 'What does the support of everyone in this room mean to the people or communities the charity serves?', type: 'textarea' },
        { id: 'q6', label: 'If you could leave everyone tonight with one heartfelt reason to support this cause, what would you want them to remember?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What exactly are we raising money for, and how on earth did you end up getting involved?', type: 'textarea' },
        { id: 'q2', label: 'What is the most ridiculous thing you\'ve done in the name of fundraising — and would you willingly do it again?', type: 'textarea' },
        { id: 'q3', label: 'What fundraising challenge, event or idea sounded absolutely terrible when suggested but somehow became a success?', type: 'textarea' },
        { id: 'q4', label: 'Who deserves to be publicly mocked tonight for their heroic, ridiculous or slightly obsessive approach to raising money?', type: 'textarea' },
        { id: 'q5', label: 'What is the strangest donation, fundraising stunt or attempt to extract money from innocent members of the public you\'ve encountered?', type: 'textarea' },
        { id: 'q6', label: 'If everyone\'s wallets could hear one final argument before tonight\'s donations, what would you say to them?', type: 'textarea' }
      ]
    }
  },

  'tribute-to-mentor': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'mentorName', label: 'Name of your mentor', type: 'text', required: true },
      { id: 'mentorshipArea', label: 'What area did they mentor you in?', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'What area, subject or stage of your life or career did this person mentor you in, and what was the nature of your relationship?', type: 'textarea' },
        { id: 'q2', label: 'What knowledge, experience or guidance did they give you that had the greatest impact?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What did they mentor you in, and how did you first end up under their guidance?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest lesson, piece of advice or memorable exchange you had with them?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What did they mentor you in, and how did they come to play such an important role in your life?', type: 'textarea' },
        { id: 'q2', label: 'What did they see in you that perhaps you did not yet see in yourself?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What did they actually mentor you in, and how did you end up becoming their problem?', type: 'textarea' },
        { id: 'q2', label: 'What is the most memorable piece of advice they gave you — whether you followed it or spectacularly ignored it?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'What area, subject or stage of your life or career did this person mentor you in, and what was the nature of your relationship?', type: 'textarea' },
        { id: 'q2', label: 'What knowledge, experience or guidance did they give you that had the greatest impact?', type: 'textarea' },
        { id: 'q3', label: 'Was there a particular piece of advice or lesson from them that has stayed with you?', type: 'textarea' },
        { id: 'q4', label: 'How did their mentorship influence your development, confidence or direction?', type: 'textarea' },
        { id: 'q5', label: 'What qualities made them such an effective or respected mentor?', type: 'textarea' },
        { id: 'q6', label: 'What would you most like to thank them for, and what do you hope to carry forward from their influence?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What did they mentor you in, and how did you first end up under their guidance?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest lesson, piece of advice or memorable exchange you had with them?', type: 'textarea' },
        { id: 'q3', label: 'What habit, phrase or particular way of doing things did they repeatedly try to drum into you?', type: 'textarea' },
        { id: 'q4', label: 'What mistake did you have to watch you make before you finally listened to them?', type: 'textarea' },
        { id: 'q5', label: 'What amusing personality trait or mentoring habit made them unmistakably themselves?', type: 'textarea' },
        { id: 'q6', label: 'If they could give you one final piece of advice today, what would it probably be — and would you actually listen this time?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What did they mentor you in, and how did they come to play such an important role in your life?', type: 'textarea' },
        { id: 'q2', label: 'What did they see in you that perhaps you did not yet see in yourself?', type: 'textarea' },
        { id: 'q3', label: 'Is there a particular lesson, conversation or moment with them that fundamentally changed your direction?', type: 'textarea' },
        { id: 'q4', label: 'How did their support affect your confidence, ambitions or belief in what you could achieve?', type: 'textarea' },
        { id: 'q5', label: 'What part of their character or wisdom has stayed with you long after their guidance was needed?', type: 'textarea' },
        { id: 'q6', label: 'If you could tell them what their mentorship ultimately meant to you, what would you want them to know?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What did they actually mentor you in, and how did you end up becoming their problem?', type: 'textarea' },
        { id: 'q2', label: 'What is the most memorable piece of advice they gave you — whether you followed it or spectacularly ignored it?', type: 'textarea' },
        { id: 'q3', label: 'What mistake did you repeatedly make despite them telling you not to, and how long did it take before you finally admitted they were right?', type: 'textarea' },
        { id: 'q4', label: 'What ridiculous phrase, rule, habit or bit of wisdom did they inflict upon you so often that you can still hear them saying it?', type: 'textarea' },
        { id: 'q5', label: 'What is the funniest thing that happened between you while they were attempting to turn you into a competent human being?', type: 'textarea' },
        { id: 'q6', label: 'If they had to write your final report as their mentee, what brutally honest comment would they put at the bottom?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'What area, subject or stage of your life or career did this person mentor you in, and what was the nature of your relationship?', type: 'textarea' },
        { id: 'q2', label: 'What knowledge, experience or guidance did they give you that had the greatest impact?', type: 'textarea' },
        { id: 'q3', label: 'Was there a particular piece of advice or lesson from them that has stayed with you?', type: 'textarea' },
        { id: 'q4', label: 'How did their mentorship influence your development, confidence or direction?', type: 'textarea' },
        { id: 'q5', label: 'What qualities made them such an effective or respected mentor?', type: 'textarea' },
        { id: 'q6', label: 'What would you most like to thank them for, and what do you hope to carry forward from their influence?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What did they mentor you in, and how did you first end up under their guidance?', type: 'textarea' },
        { id: 'q2', label: 'What is the funniest lesson, piece of advice or memorable exchange you had with them?', type: 'textarea' },
        { id: 'q3', label: 'What habit, phrase or particular way of doing things did they repeatedly try to drum into you?', type: 'textarea' },
        { id: 'q4', label: 'What mistake did you have to watch you make before you finally listened to them?', type: 'textarea' },
        { id: 'q5', label: 'What amusing personality trait or mentoring habit made them unmistakably themselves?', type: 'textarea' },
        { id: 'q6', label: 'If they could give you one final piece of advice today, what would it probably be — and would you actually listen this time?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What did they mentor you in, and how did they come to play such an important role in your life?', type: 'textarea' },
        { id: 'q2', label: 'What did they see in you that perhaps you did not yet see in yourself?', type: 'textarea' },
        { id: 'q3', label: 'Is there a particular lesson, conversation or moment with them that fundamentally changed your direction?', type: 'textarea' },
        { id: 'q4', label: 'How did their support affect your confidence, ambitions or belief in what you could achieve?', type: 'textarea' },
        { id: 'q5', label: 'What part of their character or wisdom has stayed with you long after their guidance was needed?', type: 'textarea' },
        { id: 'q6', label: 'If you could tell them what their mentorship ultimately meant to you, what would you want them to know?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What did they actually mentor you in, and how did you end up becoming their problem?', type: 'textarea' },
        { id: 'q2', label: 'What is the most memorable piece of advice they gave you — whether you followed it or spectacularly ignored it?', type: 'textarea' },
        { id: 'q3', label: 'What mistake did you repeatedly make despite them telling you not to, and how long did it take before you finally admitted they were right?', type: 'textarea' },
        { id: 'q4', label: 'What ridiculous phrase, rule, habit or bit of wisdom did they inflict upon you so often that you can still hear them saying it?', type: 'textarea' },
        { id: 'q5', label: 'What is the funniest thing that happened between you while they were attempting to turn you into a competent human being?', type: 'textarea' },
        { id: 'q6', label: 'If they had to write your final report as their mentee, what brutally honest comment would they put at the bottom?', type: 'textarea' }
      ]
    }
  },

  'thank-you-speech': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'recipientName', label: 'Who are you thanking?', type: 'text', required: true },
      { id: 'reasonForThanks', label: 'What are you thanking them for?', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'Who are you thanking, and what specifically are you thanking them for?', type: 'textarea' },
        { id: 'q2', label: 'What did they do, contribute or provide that made a meaningful difference to you?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'Who are you thanking, what did they do for you, and how did you somehow end up needing their help in the first place?', type: 'textarea' },
        { id: 'q2', label: 'What funny, unexpected or slightly chaotic thing happened along the way?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'Who are you thanking, why are you thanking them, and what do they mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What did they do for you at a time when you genuinely needed their support?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'Who are you thanking, why do they deserve your thanks, and what exactly did they get themselves involved in?', type: 'textarea' },
        { id: 'q2', label: 'What ridiculous situation did they have to endure while helping you?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'Who are you thanking, and what specifically are you thanking them for?', type: 'textarea' },
        { id: 'q2', label: 'What did they do, contribute or provide that made a meaningful difference to you?', type: 'textarea' },
        { id: 'q3', label: 'Was there a particular moment when their help or support was especially important?', type: 'textarea' },
        { id: 'q4', label: 'What qualities or actions of theirs do you particularly appreciate?', type: 'textarea' },
        { id: 'q5', label: 'How has their support affected you, your situation or the outcome you are celebrating?', type: 'textarea' },
        { id: 'q6', label: 'What would you most like them to know about how genuinely grateful you are?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'Who are you thanking, what did they do for you, and how did you somehow end up needing their help in the first place?', type: 'textarea' },
        { id: 'q2', label: 'What funny, unexpected or slightly chaotic thing happened along the way?', type: 'textarea' },
        { id: 'q3', label: 'Did they have to put up with any of your bad decisions, incompetence or questionable behaviour while helping you?', type: 'textarea' },
        { id: 'q4', label: 'What amusing quality, habit or characteristic of theirs deserves a mention?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular moment when their help saved the day — or at least stopped things getting considerably worse?', type: 'textarea' },
        { id: 'q6', label: 'If you had to thank them in the most entertaining way possible, what would you absolutely have to mention?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'Who are you thanking, why are you thanking them, and what do they mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What did they do for you at a time when you genuinely needed their support?', type: 'textarea' },
        { id: 'q3', label: 'Is there a particular moment of kindness, generosity or encouragement that you will never forget?', type: 'textarea' },
        { id: 'q4', label: 'How did their actions affect you or change your circumstances?', type: 'textarea' },
        { id: 'q5', label: 'What is it about this person that makes their support particularly meaningful to you?', type: 'textarea' },
        { id: 'q6', label: 'If you could make sure they understood just one thing about how much their support meant to you, what would you say?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'Who are you thanking, why do they deserve your thanks, and what exactly did they get themselves involved in?', type: 'textarea' },
        { id: 'q2', label: 'What ridiculous situation did they have to endure while helping you?', type: 'textarea' },
        { id: 'q3', label: 'What did they have to put up with from you that probably deserves an apology alongside the thank-you?', type: 'textarea' },
        { id: 'q4', label: 'What funny habit, personality trait or moment from them absolutely has to be included?', type: 'textarea' },
        { id: 'q5', label: 'What is the most entertaining example of them saving your arse, despite probably wondering why they bothered?', type: 'textarea' },
        { id: 'q6', label: 'If this thank-you came with an award, what completely inappropriate award would you give them?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'Who are you thanking, and what specifically are you thanking them for?', type: 'textarea' },
        { id: 'q2', label: 'What did they do, contribute or provide that made a meaningful difference to you?', type: 'textarea' },
        { id: 'q3', label: 'Was there a particular moment when their help or support was especially important?', type: 'textarea' },
        { id: 'q4', label: 'What qualities or actions of theirs do you particularly appreciate?', type: 'textarea' },
        { id: 'q5', label: 'How has their support affected you, your situation or the outcome you are celebrating?', type: 'textarea' },
        { id: 'q6', label: 'What would you most like them to know about how genuinely grateful you are?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'Who are you thanking, what did they do for you, and how did you somehow end up needing their help in the first place?', type: 'textarea' },
        { id: 'q2', label: 'What funny, unexpected or slightly chaotic thing happened along the way?', type: 'textarea' },
        { id: 'q3', label: 'Did they have to put up with any of your bad decisions, incompetence or questionable behaviour while helping you?', type: 'textarea' },
        { id: 'q4', label: 'What amusing quality, habit or characteristic of theirs deserves a mention?', type: 'textarea' },
        { id: 'q5', label: 'Is there a particular moment when their help saved the day — or at least stopped things getting considerably worse?', type: 'textarea' },
        { id: 'q6', label: 'If you had to thank them in the most entertaining way possible, what would you absolutely have to mention?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'Who are you thanking, why are you thanking them, and what do they mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'What did they do for you at a time when you genuinely needed their support?', type: 'textarea' },
        { id: 'q3', label: 'Is there a particular moment of kindness, generosity or encouragement that you will never forget?', type: 'textarea' },
        { id: 'q4', label: 'How did their actions affect you or change your circumstances?', type: 'textarea' },
        { id: 'q5', label: 'What is it about this person that makes their support particularly meaningful to you?', type: 'textarea' },
        { id: 'q6', label: 'If you could make sure they understood just one thing about how much their support meant to you, what would you say?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'Who are you thanking, why do they deserve your thanks, and what exactly did they get themselves involved in?', type: 'textarea' },
        { id: 'q2', label: 'What ridiculous situation did they have to endure while helping you?', type: 'textarea' },
        { id: 'q3', label: 'What did they have to put up with from you that probably deserves an apology alongside the thank-you?', type: 'textarea' },
        { id: 'q4', label: 'What funny habit, personality trait or moment from them absolutely has to be included?', type: 'textarea' },
        { id: 'q5', label: 'What is the most entertaining example of them saving your arse, despite probably wondering why they bothered?', type: 'textarea' },
        { id: 'q6', label: 'If this thank-you came with an award, what completely inappropriate award would you give them?', type: 'textarea' }
      ]
    }
  },

  'legacy-event': {
    core: [
      { id: 'speakerName', label: 'Your full name', type: 'text', required: true },
      { id: 'legacyDescription', label: 'What legacy is being celebrated?', type: 'text', required: true },
      { id: 'occasionDetails', label: 'What is the occasion?', type: 'text', required: true }
    ],
    toast: {
      serious: [
        { id: 'q1', label: 'What is the legacy being recognised or celebrated, and what is the occasion?', type: 'textarea' },
        { id: 'q2', label: 'Who or what is at the heart of that legacy, and what have they achieved or contributed?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What exactly are we here to celebrate, and how did this whole legacy come about?', type: 'textarea' },
        { id: 'q2', label: 'Who or what is responsible for the legacy, and what is the funniest thing you remember about them or it?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What are we here to celebrate, and what does this legacy mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'Who or what has had the greatest influence on the legacy, and why has that influence mattered?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What exactly are we celebrating, and how the hell did it become a legacy?', type: 'textarea' },
        { id: 'q2', label: 'Who or what is responsible for it, and what is the most ridiculous thing associated with them or it?', type: 'textarea' }
      ]
    },
    speech: {
      serious: [
        { id: 'q1', label: 'What is the legacy being recognised or celebrated, and what is the occasion?', type: 'textarea' },
        { id: 'q2', label: 'Who or what is at the heart of that legacy, and what have they achieved or contributed?', type: 'textarea' },
        { id: 'q3', label: 'What aspect of this legacy do you think is most significant?', type: 'textarea' },
        { id: 'q4', label: 'Is there a particular achievement, story or moment that best represents what is being celebrated?', type: 'textarea' },
        { id: 'q5', label: 'How has this person, group, organisation, idea or achievement affected the people around it?', type: 'textarea' },
        { id: 'q6', label: 'What do you hope will continue or endure as a result of this legacy?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What exactly are we here to celebrate, and how did this whole legacy come about?', type: 'textarea' },
        { id: 'q2', label: 'Who or what is responsible for the legacy, and what is the funniest thing you remember about them or it?', type: 'textarea' },
        { id: 'q3', label: 'What story, incident or memorable moment best sums up what we\'re celebrating?', type: 'textarea' },
        { id: 'q4', label: 'What unusual habit, tradition, personality trait or bit of history has become part of the legacy?', type: 'textarea' },
        { id: 'q5', label: 'What would probably surprise people most about how this legacy came about?', type: 'textarea' },
        { id: 'q6', label: 'If the legacy could be summed up in one amusing story, what would you tell?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What are we here to celebrate, and what does this legacy mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'Who or what has had the greatest influence on the legacy, and why has that influence mattered?', type: 'textarea' },
        { id: 'q3', label: 'Is there a particular memory or moment that captures what this legacy means to you?', type: 'textarea' },
        { id: 'q4', label: 'How has this person, group, organisation, achievement or idea changed the lives of others?', type: 'textarea' },
        { id: 'q5', label: 'What part of the legacy do you hope will never be forgotten?', type: 'textarea' },
        { id: 'q6', label: 'What would you most like people to carry forward from what we are celebrating today?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What exactly are we celebrating, and how the hell did it become a legacy?', type: 'textarea' },
        { id: 'q2', label: 'Who or what is responsible for it, and what is the most ridiculous thing associated with them or it?', type: 'textarea' },
        { id: 'q3', label: 'What story best demonstrates the sheer nonsense, chaos or questionable decisions behind this legacy?', type: 'textarea' },
        { id: 'q4', label: 'What bizarre habit, tradition, incident or achievement has somehow survived long enough to become part of the history?', type: 'textarea' },
        { id: 'q5', label: 'What would the people responsible for this legacy absolutely not want mentioned tonight?', type: 'textarea' },
        { id: 'q6', label: 'If this legacy had to be remembered for one completely ridiculous thing, what should it be?', type: 'textarea' }
      ]
    },
    keynote: {
      serious: [
        { id: 'q1', label: 'What is the legacy being recognised or celebrated, and what is the occasion?', type: 'textarea' },
        { id: 'q2', label: 'Who or what is at the heart of that legacy, and what have they achieved or contributed?', type: 'textarea' },
        { id: 'q3', label: 'What aspect of this legacy do you think is most significant?', type: 'textarea' },
        { id: 'q4', label: 'Is there a particular achievement, story or moment that best represents what is being celebrated?', type: 'textarea' },
        { id: 'q5', label: 'How has this person, group, organisation, idea or achievement affected the people around it?', type: 'textarea' },
        { id: 'q6', label: 'What do you hope will continue or endure as a result of this legacy?', type: 'textarea' }
      ],
      humorous: [
        { id: 'q1', label: 'What exactly are we here to celebrate, and how did this whole legacy come about?', type: 'textarea' },
        { id: 'q2', label: 'Who or what is responsible for the legacy, and what is the funniest thing you remember about them or it?', type: 'textarea' },
        { id: 'q3', label: 'What story, incident or memorable moment best sums up what we\'re celebrating?', type: 'textarea' },
        { id: 'q4', label: 'What unusual habit, tradition, personality trait or bit of history has become part of the legacy?', type: 'textarea' },
        { id: 'q5', label: 'What would probably surprise people most about how this legacy came about?', type: 'textarea' },
        { id: 'q6', label: 'If the legacy could be summed up in one amusing story, what would you tell?', type: 'textarea' }
      ],
      emotional: [
        { id: 'q1', label: 'What are we here to celebrate, and what does this legacy mean to you personally?', type: 'textarea' },
        { id: 'q2', label: 'Who or what has had the greatest influence on the legacy, and why has that influence mattered?', type: 'textarea' },
        { id: 'q3', label: 'Is there a particular memory or moment that captures what this legacy means to you?', type: 'textarea' },
        { id: 'q4', label: 'How has this person, group, organisation, achievement or idea changed the lives of others?', type: 'textarea' },
        { id: 'q5', label: 'What part of the legacy do you hope will never be forgotten?', type: 'textarea' },
        { id: 'q6', label: 'What would you most like people to carry forward from what we are celebrating today?', type: 'textarea' }
      ],
      banter: [
        { id: 'q1', label: 'What exactly are we celebrating, and how the hell did it become a legacy?', type: 'textarea' },
        { id: 'q2', label: 'Who or what is responsible for it, and what is the most ridiculous thing associated with them or it?', type: 'textarea' },
        { id: 'q3', label: 'What story best demonstrates the sheer nonsense, chaos or questionable decisions behind this legacy?', type: 'textarea' },
        { id: 'q4', label: 'What bizarre habit, tradition, incident or achievement has somehow survived long enough to become part of the history?', type: 'textarea' },
        { id: 'q5', label: 'What would the people responsible for this legacy absolutely not want mentioned tonight?', type: 'textarea' },
        { id: 'q6', label: 'If this legacy had to be remembered for one completely ridiculous thing, what should it be?', type: 'textarea' }
      ]
    }
  }

};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QUESTIONNAIRE_DATA;
}
