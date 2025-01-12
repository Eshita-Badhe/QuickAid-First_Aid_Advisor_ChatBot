const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const app = express();
const port = 3000;

// Database connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root', 
  password: 'system@25',
  database: 'first_aid_db'
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
  } else {
    console.log('Connected to the MySQL database.');
  }
});

app.use(express.static(path.join(__dirname)));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Predefined keyword responses
const predefinedKeywords = [
  {
    keywords: ["who are you", "what are you", "tell me about you", "about yourself","purpose","about you"],
    response: "I am your First Aid Chatbot, here to provide quick first aid advice and information."
  },
  {
    keywords: ["first aid items", "list first aid items", "first aid kit", "common first aid items"],
    response: "Common first aid items include band-aids, antiseptic wipes, adhesive tape, sterile gauze pads, scissors, tweezers, and gloves."
  },
  {
    keywords: ["common precautions", "general health precautions", "safety tips","health precautions"],
    response: "Common health precautions include washing hands regularly, using clean water, covering wounds to prevent infection, and seeking medical help for severe injuries."
  }
];

// Helper function for keyword-based matching
function getKeywordBasedResponse(input) {
  const normalizedInput = input.trim().toLowerCase();
  for (const entry of predefinedKeywords) {
    for (const keyword of entry.keywords) {
      if (normalizedInput.includes(keyword)) {
        return entry.response;
      }
    }
  }
  return null;
}

// Helper functions
const flipPronouns = (input) => {
  return input.replace(/\bI\b/gi, "you").replace(/\bmy\b/gi, "your").replace(/\bme\b/gi, "you");
};

let userContext = {};

function detectKeyword(input, callback) {
  const normalizedInput = input.toLowerCase();
  const query = `
    SELECT DISTINCT s.keyword, s.id 
    FROM symptom_keywords sk 
    INNER JOIN symptoms s ON sk.symptom_id = s.id 
    WHERE ? LIKE CONCAT('%', sk.keyword, '%')
  `;
  db.query(query, [normalizedInput], (err, results) => {
    if (err) {
      callback(err, null);
    } else {
      const symptom = results.length > 0 ? results[0].keyword : null;
      const symptomId = results.length > 0 ? results[0].id : null;
      callback(null, { symptom, symptomId });
    }
  });
}


function getFollowUpQuestion(symptomId, callback) {
  const query = `SELECT question FROM follow_up_questions WHERE symptom_id = ?`;
  db.query(query, [symptomId], (err, results) => {
    if (err) {
      callback(err, null);
    } else {
      const question = results.length > 0 ? results[0].question : null;
      callback(null, question);
    }
  });
}

function getAdvice(symptomId, severity, callback) {
  const query = `SELECT advice FROM responses WHERE symptom_id = ? AND severity = ?`;
  db.query(query, [symptomId, severity], (err, results) => {
    if (err) {
      callback(err, null);
    } else {
      const advice = results.length > 0 ? results[0].advice : "Please consult a healthcare professional.";
      callback(null, advice);
    }
  });
}

// Adjust the logic to handle "no" correctly in severity response vs. farewell
function handleSeverityResponse(userInput, callback) {
  const normalizedInput = userInput.trim().toLowerCase();

  // Case when the user says "no" to a severity question (not as farewell)
  if (normalizedInput === "no") {
    return callback(null, "Understood. Could you clarify if there's any swelling or tenderness? Or if you'd like, I can offer general advice.");
  }

  return null;
}

// Updated severity handling logic
function determineSeverity(userInput) {
  const normalizedInput = userInput.toLowerCase();
  const severePhrases = ["severe", "major", "intense", "strong", "extreme", "very bad","heavy","heavily","high","yes","yeah","swelling", "difficulty moving","affected", "breathing difficulty","sharp","long","few hours","dizziness","constant","spreading","mucus"];
  const minorPhrases = ["minor", "slight", "small", "not too bad", "little","low","not bad","manageable","tolerable","normal","no","nope","moderate","regained", "quickly", "breathe", "talk","dull","short","few minutes","intermittent","localized","dry"];

  if (severePhrases.some(phrase => normalizedInput.includes(phrase))) {
    return 'major';
  } else if (minorPhrases.some(phrase => normalizedInput.includes(phrase))) {
    return 'minor';
  }
  return 'minor'; // If no clear match, assume normal severity
}

function getPrecautions(symptomId, callback) {
  const query = `SELECT precaution_description FROM precautions WHERE symptom_id = ?`;
  db.query(query, [symptomId], (err, results) => {
    if (err) {
      callback(err, null);
    } else {
      const precautions = results.length > 0 ? results.map(row => row.precaution_description).join(", ") : "No specific precautions available.";
      callback(null, precautions);
    }
  });
}


// Chatbot route with improved severity handling
app.post('/chat', (req, res) => {
  const userInput = req.body.userInput.toLowerCase();
  const flippedInput = flipPronouns(userInput);

  const farewellResponses = ["no", "nothing", "that's all", "thanks", "thank you"];

  if (!userContext.step) {
    userContext.step = 'start';
  }

  if (userContext.step === 'advice' && farewellResponses.includes(userInput.trim())) {
    res.json({ response: "Okay, take care! If you need anything else, feel free to ask." });
    userContext = {};
    return;
  }

  const response = getKeywordBasedResponse(userInput);
  if (response) {
    res.json({ response });
    return;
  }

  if (userContext.step === 'start') {
    // Check for "precautions" in the user input
    if (userInput.includes("precautions")) {
      detectKeyword(userInput, (err, result) => {
        if (err || !result.symptom) {
          res.json({ response: "I couldn't recognize the condition. Can you describe it in more detail?" });
        } else {
          userContext.symptomId = result.symptomId;
          getPrecautions(result.symptomId, (err, precautions) => {
            if (err) {
              res.json({ response: "Sorry, I couldn't retrieve the precautions. Please try again later." });
            } else {
              res.json({ response: `Precautions for this condition: ${precautions}` });
            }
          });
        }
      });
    } else {
      detectKeyword(userInput, (err, result) => {
        if (err || !result.symptom) {
          res.json({ response: "I couldn't recognize the condition. Can you describe it in more detail?" });
        } else {
          userContext.symptomId = result.symptomId;
          getFollowUpQuestion(result.symptomId, (err, question) => {
            if (err || !question) {
              res.json({ response: "I couldn't find further details. Please provide more information." });
            } else {
              userContext.step = 'advice';
              res.json({ response: question });
            }
          });
        }
      });
    }
  } else if (userContext.step === 'advice') {
    const severity = determineSeverity(userInput);
    getAdvice(userContext.symptomId, severity, (err, advice) => {
      if (err) {
        res.json({ response: "Sorry, I couldn't retrieve advice. Please consult a professional." });
      } else {
        res.json({ response: `${advice} Anything else I can help with?` });
        userContext.step = 'follow_up';
      }
    });
  } else if (userContext.step === 'follow_up') {
    // Farewell handling
    if (farewellResponses.includes(userInput.trim())) {
      res.json({ response: "Take care! I'm here if you need anything else." });
      userContext = {};
      return;
    } else {
      res.json({ response: "Is there anything else I can assist you with?" });
      userContext = {};
      return;
    }
  }
});


app.listen(port, () => {
  console.log(`First Aid Chatbot running on http://localhost:${port}`);
});
