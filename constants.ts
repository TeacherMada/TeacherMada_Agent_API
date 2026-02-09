export const SYSTEM_INSTRUCTION = `
You are the "TeacherMada AI Agent", an intelligent educational advisor for TeacherMada, an online language learning platform.

Your Role:
- Welcome new users warmly.
- Identify the user's preferred language (English, French, or Malagasy) and reply in that language.
- Act as a motivator and soft-sales agent.
- Answer questions about pricing, methods, and duration.
- Guide users towards enrollment or a human advisor.

Tone:
- Professional but approachable.
- Encouraging and empathetic.
- Concise (optimized for Facebook Messenger).

Key Tasks & Logic:
1. **Language Detection**: If the user speaks Malagasy, reply in Malagasy. If French, in French. If English, in English.
2. **Intent Recognition**: Classify the user's message into: 'greeting', 'info', 'learning', 'pricing', 'signup'.
3. **Action Selection**: Decide the next best step: 'ask_question' (to qualify), 'present_offer' (if ready), 'redirect_human' (complex queries), 'send_link' (for signup).
4. **Error Handling**: If the input is vague (e.g., "ok", "thumbs up"), acknowledge politely and ask a guiding question like "How can I help you improve your language skills today?"

Response Format:
You MUST return a JSON object adhering to this structure:
{
  "reply": "The actual text message to send to the user",
  "detected_language": "The detected language code (en, fr, mg)",
  "intent": "The classified intent",
  "next_action": "The determined next action"
}
`;

export const NODE_BACKEND_TEMPLATE = `/**
 * TeacherMada AI Agent API
 * Tech Stack: Node.js, Express, @google/genai
 */
require('dotenv').config();
const express = require('express');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
app.use(express.json());

// --- API Key Management (Rotation & Failover) ---
// Expects API_KEY to be a comma-separated list of keys: "key1,key2,key3"
const API_KEYS = (process.env.API_KEY || '').split(',').map(k => k.trim()).filter(k => k);
let currentKeyIndex = 0;

if (API_KEYS.length === 0) {
  console.error("CRITICAL: No API Keys found in .env variable API_KEY");
  process.exit(1);
}

const getGenAIClient = () => {
  const key = API_KEYS[currentKeyIndex];
  return new GoogleGenAI({ apiKey: key });
};

const rotateKey = () => {
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  console.log(\`Switching to API Key index \${currentKeyIndex}\`);
};

const MODEL_NAME = 'gemini-3-flash-preview';

// --- Memory & Rate Limiting ---
const conversationStore = new Map();
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 20;

// Summarization Config
const HISTORY_LIMIT = 10;
const RETAIN_COUNT = 4;

const checkRateLimit = (ip) => {
  const now = Date.now();
  const userHistory = rateLimit.get(ip) || [];
  const validRequests = userHistory.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  if (validRequests.length >= MAX_REQUESTS) return false;
  
  validRequests.push(now);
  rateLimit.set(ip, validRequests);
  return true;
};

// --- System Prompt ---
const SYSTEM_INSTRUCTION = \`
You are the TeacherMada AI Agent. Your goal is to assist users in choosing a language course.
Identify language (Fr, En, Mg) and reply in that language.
Be concise, motivating, and helpful.
\`;

// --- Response Schema ---
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING, description: "Text response for Messenger" },
    detected_language: { type: Type.STRING, description: "Language code: en, fr, mg" },
    intent: { 
      type: Type.STRING, 
      enum: ["greeting", "info", "learning", "pricing", "signup", "unknown"] 
    },
    next_action: { 
      type: Type.STRING, 
      enum: ["ask_question", "present_offer", "redirect_human", "send_link", "none"] 
    }
  },
  required: ["reply", "detected_language", "intent", "next_action"]
};

// --- Helper: Summarize History ---
async function summarizeHistory(history) {
  if (history.length <= HISTORY_LIMIT) return history;
  
  console.log("Summarizing conversation history...");
  const toSummarize = history.slice(0, history.length - RETAIN_COUNT);
  const recent = history.slice(history.length - RETAIN_COUNT);
  
  const transcript = toSummarize.map(m => \`\${m.role.toUpperCase()}: \${m.parts[0].text}\`).join('\\n');
  const prompt = \`Summarize this conversation concisely, preserving key info (language, intent, user details):\\n\${transcript}\`;
  
  try {
    const ai = getGenAIClient();
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt
    });
    
    const summary = response.text || "Summary unavailable";
    return [
      { role: 'user', parts: [{ text: \`[SYSTEM: Previous Conversation Summary]: \${summary}\` }] },
      { role: 'model', parts: [{ text: "Acknowledged." }] },
      ...recent
    ];
  } catch (err) {
    console.error("Summarization error:", err);
    return history;
  }
}

// --- Main Chat Endpoint ---
app.post('/api/agent/chat', async (req, res) => {
  try {
    if (!checkRateLimit(req.ip)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { userId, message, context } = req.body;
    
    if (!userId || !message) {
      return res.status(400).json({ error: 'Missing userId or message' });
    }

    // 1. Prepare Context & History
    let history = conversationStore.get(userId) || [];
    
    // 2. Summarize if needed
    history = await summarizeHistory(history);
    conversationStore.set(userId, history); // Update store with summary

    const chatContext = context ? \`[System Context: Language=\${context.language}, Stage=\${context.stage}] \` : '';
    const userContent = { role: 'user', parts: [{ text: \`\${chatContext}\${message}\` }] };
    const promptContents = [...history, userContent];

    // 3. Retry Loop for API Key Rotation
    let attempts = 0;
    let success = false;
    let jsonResponse;
    let rawResponseText;

    while (attempts < API_KEYS.length && !success) {
      try {
        const ai = getGenAIClient();
        
        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: promptContents,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            temperature: 0.7,
          },
        });

        rawResponseText = response.text;
        jsonResponse = JSON.parse(rawResponseText);
        success = true;

      } catch (error) {
        console.error(\`Attempt failed with Key Index \${currentKeyIndex}: \`, error.message);
        attempts++;
        if (attempts < API_KEYS.length) {
          rotateKey(); // Switch key and retry
        } else {
          throw new Error("All API keys exhausted or service unavailable.");
        }
      }
    }

    // 4. Save history on success
    if (success && jsonResponse) {
      const modelContent = { role: 'model', parts: [{ text: rawResponseText }] };
      conversationStore.set(userId, [...promptContents, modelContent]);
      
      console.log(\`User: \${userId}, Intent: \${jsonResponse.intent}\`);
      res.json(jsonResponse);
    }

  } catch (error) {
    console.error('Final Agent Error:', error);
    res.status(500).json({ 
      reply: "Désolé, je rencontre un problème technique. Un conseiller humain va prendre le relais.",
      next_action: "redirect_human"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`TeacherMada Agent API running on port \${PORT}\`);
  console.log(\`Loaded \${API_KEYS.length} API Keys for rotation.\`);
});
`;

export const README_CONTENT = `# 🤖 TeacherMada AI Agent API (Backend)

An enterprise-grade, stateful AI backend designed for high-availability conversational agents. Built with Node.js, Express, and Google Gemini 1.5/2.0 Flash.

## 🚀 Key Features

### 🧠 Intelligent Context Memory
- **Session Persistence**: Maintains conversation history by \`userId\`.
- **Auto-Summarization**: Automatically compresses long conversations into concise summaries to save tokens and maintain context over long periods.
- **Language Awareness**: Detects and sticks to the user's preferred language (MG, FR, EN).

### 🛡️ High Availability & Reliability
- **API Key Rotation**: Supports multiple Gemini API keys.
- **Auto-Failover**: If a key hits a rate limit or quota, the system instantly switches to the next available key without interrupting the user experience.
- **Rate Limiting**: Built-in protection against DDoS and spam (default: 20 msg/min per IP).

### ⚡ Optimized for Messenger/WhatsApp
- **Structured JSON**: Outputs strict JSON ready for webhook integration.
- **Intent Classification**: Automatically tags messages (e.g., \`pricing\`, \`signup\`, \`support\`).
- **Action Guidance**: Suggests the next best logic step (e.g., \`redirect_human\`, \`present_offer\`).

---

## 🛠️ Installation & Setup

### 1. Prerequisites
- Node.js v18+
- Google Cloud Project with Gemini API enabled
- API Keys (Get them from [Google AI Studio](https://aistudio.google.com/))

### 2. Clone & Install
\`\`\`bash
mkdir teachermada-backend
cd teachermada-backend
npm init -y
npm install express @google/genai dotenv
\`\`\`

### 3. Configuration (.env)
Create a \`.env\` file in the root directory. You can provide multiple API keys separated by commas for rotation.

\`\`\`env
PORT=3000
# Add multiple keys for failover support
API_KEY="AIzaSy...Key1, AIzaSy...Key2, AIzaSy...Key3"
\`\`\`

### 4. Run the Server
\`\`\`bash
node server.js
\`\`\`

---

## 📡 API Documentation

### POST \`/api/agent/chat\`

Main endpoint to interact with the agent.

#### Request Body
\`\`\`json
{
  "userId": "10024928",
  "message": "Ohatrinona ny cours?",
  "context": {
    "language": "mg", 
    "stage": "lead" 
  }
}
\`\`\`

| Field | Type | Description |
|-------|------|-------------|
| \`userId\` | string | **Required**. Unique identifier for the user (e.g., Facebook PSID). |
| \`message\` | string | **Required**. The text message sent by the user. |
| \`context\` | object | Optional. Metadata about the user (language, funnel stage). |

#### Response Body
\`\`\`json
{
  "reply": "Ny sarany dia 50,000 Ar isam-bolana. Te hisoratra anarana ve ianao?",
  "detected_language": "mg",
  "intent": "pricing",
  "next_action": "present_offer"
}
\`\`\`

---

## 🏗️ Architecture details

### Token Management Strategy
To ensure the bot remains cost-effective and doesn't crash on long conversations, we implement a **Rolling Summary Buffer**:
1. The bot keeps the last 10 messages in raw format.
2. Once the limit is reached, older messages are sent to a background process to be summarized.
3. The context window is updated with \`[System Summary: ...]\` replacing the old logs.

### Failover Logic
1. Request comes in.
2. System tries \`Key_1\`.
3. If \`429 Too Many Requests\` or \`Quota Exceeded\` occurs:
4. System logs error, switches index to \`Key_2\`, and retries immediately.
5. User perceives no downtime.

---

## 🚢 Deployment

### Vercel / Railway / Render
This project is ready to deploy. Ensure you set the \`API_KEY\` environment variable in your cloud provider's dashboard.

**Note on Serverless**: Since this implementation uses in-memory \`Map()\` for storage, memory will be wiped on serverless cold starts. For production, replace \`conversationStore\` with Redis or MongoDB.
`;