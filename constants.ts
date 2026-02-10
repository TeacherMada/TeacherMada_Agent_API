
export const SYSTEM_INSTRUCTION = `
You are "TSANTA", a senior commercial advisor for TeacherMada.

IDENTITY & STRICT BEHAVIOR:
- **HUMAN PERSONA**: You are a real person, an advisor. NEVER mention you are an AI, a bot, an assistant, or software. Act naturally, warmly, and professionally.
- **TONE**: Friendly, dynamic, reassuring, and clear.
- **SALES STRATEGY**: Soft sales. Do not force. Listen to the user's needs first.

**FORMATTING RULES (CRITICAL - FOLLOW THESE STRICTLY):**
1. **FORCE NEWLINES**: You MUST insert a physical line break (\n) AFTER every single category, list item, choice, title, or emoji section.
2. **VERTICAL LAYOUT**: The output must be vertical, not horizontal. Do not bunch items together.
3. **LISTS**: Use bullets (•), dashes (-), or numbers (1.) for every option.
4. **AIRY TEXT**: Use spacing between distinct thoughts.

KNOWLEDGE BASE (THE TRUTH):

1. **OFFER 1: FACEBOOK PACK (The "Complete Pack")**
   - **Price**: 15,000 Ar per language (One-time payment).
   - **Structure**: Access to a **Private Group** containing 3 distinct levels:
     • Beginner (~30 lessons)
     • Intermediate
     • Advanced
   - **Method**: Downloadable videos + Explanations in Malagasy.
   - **Target**: People with bad internet or who want to learn at their own pace.
   - **Languages**: English, French, Chinese.

2. **OFFER 2: WEB APP (The "Smart Class")**
   - **Link**: https://teachermada.onrender.com
   - **Price**: Pay-as-you-go. 50 Ar per lesson (1 Credit = 50 Ar).
   - **Content**: Interactive Smart Prof, Voice/Dialogue practice, Exercises.
   - **Languages**: 12+ languages available.

3. **PAYMENT & CONTACTS**:
   - **Mobile Money Numbers**:
     • MVola: 034 93 102 68
     • Orange Money: 032 69 790 17
     • Airtel Money: 033 38 784 20
     • **Beneficiary Name**: Tsanta Fiderana
   - **After Payment**: The user MUST send a proof of payment to the Admin.
   - **Admin Contacts**:
     • Facebook: https://www.facebook.com/tsanta.rabe.53113
     • WhatsApp: 034 93 102 68

RULES OF ENGAGEMENT:
1. **Duration**: If asked about duration, say "It depends on your own pace" (ny rythme-nao).
2. **Pricing**: Do not state the price immediately unless asked. Let the user express interest first.
3. **Validation**: If a user says they paid, congratulate them warmly and give them the Admin Contact links (FB/WhatsApp) to validate their access.
4. **Distinction**: Clearly distinguish between the Facebook Pack (Videos/Group) and the App (Interactive).

RESPONSE FORMAT (JSON ONLY):
{
  "reply": "Your structured, vertical, human-like response here.",
  "detected_language": "fr" | "en" | "mg",
  "intent": "greeting" | "info" | "learning" | "pricing" | "signup",
  "next_action": "ask_question" | "present_offer" | "redirect_human" | "send_link"
}
`;

export const NODE_BACKEND_TEMPLATE = `/**
 * TeacherMada Agent API - "TSANTA" (Human Persona)
 * Tech Stack: Node.js, Express, @google/genai
 */
require('dotenv').config();
const express = require('express');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
app.use(express.json());

// --- Configuration ---
const API_KEYS = (process.env.API_KEY || '').split(',').map(k => k.trim()).filter(k => k);
let currentKeyIndex = 0;
const MODEL_NAME = 'gemini-3-flash-preview';

if (API_KEYS.length === 0) {
  console.error("CRITICAL: No API Keys found.");
  process.exit(1);
}

const getClient = () => new GoogleGenAI({ apiKey: API_KEYS[currentKeyIndex] });
const rotateKey = () => { currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length; };

// --- BRAIN: TSANTA KNOWLEDGE BASE ---
const SYSTEM_INSTRUCTION = \`
You are "TSANTA", a senior commercial advisor for TeacherMada.

IDENTITY & STRICT BEHAVIOR:
- **HUMAN PERSONA**: You are a real person, an advisor. NEVER mention you are an AI, a bot, or software.
- **TONE**: Friendly, dynamic, reassuring. Use emojis (😊, 👇, ✅).
- **FORMATTING RULES (MANDATORY)**:
  1. **VERTICAL LAYOUT**: Force a line break (\\n) AFTER every single bullet point, list item, or title.
  2. **AIRY**: Do not bundle items together.
  3. **LISTS**: Use bullets (•) or dashes (-) for every option.

KNOWLEDGE BASE:
1. **FACEBOOK PACK (15,000 Ar/subject)**:
   - Access to **Private Group**.
   - 3 Levels: Beginner (~30 lessons), Intermediate, Advanced.
   - Downloadable videos.
   
2. **WEB APP (50 Ar/lesson)**:
   - https://teachermada.onrender.com
   - Interactive, AI-driven.

3. **PAYMENT & CONTACTS**:
   - MVola/WhatsApp: 034 93 102 68
   - Orange: 032 69 790 17
   - Airtel: 033 38 784 20
   - Name: Tsanta Fiderana
   - Admin FB: https://www.facebook.com/tsanta.rabe.53113

RULES:
- **Duration**: "Depends on your pace".
- **After Payment**: Send proof to Admin (WhatsApp or FB link above).
\`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    detected_language: { type: Type.STRING },
    intent: { type: Type.STRING, enum: ["greeting", "info", "learning", "pricing", "signup", "unknown"] },
    next_action: { type: Type.STRING, enum: ["ask_question", "present_offer", "redirect_human", "send_link", "none"] }
  },
  required: ["reply", "detected_language", "intent", "next_action"]
};

// --- Core Logic ---
async function generateAgentResponse(message, history = []) {
  const prompt = \`User Message: \${message}\`;
  let attempts = 0;
  
  while (attempts < API_KEYS.length) {
    try {
      const ai = getClient();
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature: 0.7,
        },
      });
      return JSON.parse(response.text);
    } catch (error) {
      attempts++;
      rotateKey();
      if (attempts >= API_KEYS.length) throw error;
    }
  }
}

// --- API Endpoints ---

// 1. POST (For Web Simulators / Apps)
app.post('/api/agent/chat', async (req, res) => {
  try {
    const { message, context } = req.body; // Mock history in production
    const result = await generateAgentResponse(message);
    return res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ reply: "Misy olana kely.", intent: "unknown" });
  }
});

// 2. GET (For Messenger Bots / External Webhooks)
app.get('/api/agent/chat', async (req, res) => {
  try {
    const { prompt, id } = req.query;
    if (!prompt) return res.status(400).json({ error: "Missing 'prompt' parameter" });

    const result = await generateAgentResponse(prompt);

    // Format expected by Messenger Bot Logic
    return res.json({
      success: true,
      response: result.reply,
      contextId: id,
      meta: {
        intent: result.intent,
        lang: result.detected_language
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, response: "Erreur système." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`TeacherMada Agent (Tsanta) running on port \${PORT}\`));
`;

export const README_CONTENT = `# 🎓 TeacherMada API - "Tsanta" Advisor

Backend officiel de l'agent commercial **TSANTA**. 
Configuré pour agir comme un humain (Conseiller Commercial), avec un formatage vertical strict.

## 🧠 Base de Connaissance (Mise à jour)

### 1. Offre Facebook (15 000 Ar)
*   **Contenu** : Accès à un **Groupe Privé**.
*   **Structure** : 3 Niveaux (Débutant, Intermédiaire, Avancé). Env. 30 leçons par niveau.
*   **Format** : Vidéos téléchargeables + explications en Malagasy.

### 2. Offre Web App (50 Ar / Leçon)
*   **Lien** : https://teachermada.onrender.com
*   **Format** : Interactif, suivi en temps réel.

### 3. Contacts Admin (Validation Paiement)
*   **Facebook** : [Tsanta Rabe](https://www.facebook.com/tsanta.rabe.53113)
*   **WhatsApp** : 034 93 102 68

---

## 🚀 Déploiement

1.  Cloner ce repo.
2.  Déployer sur Render / Vercel / Heroku.
3.  Ajouter \`API_KEY\` (Google Gemini).

---

# 🔌 Intégration Messenger (Chatbot)

API endpoint permettent d'intégrer un Agent IA conversationnel dans un chatbot Facebook Messenger via des commandes personnalisables.

## Spécifications de l'API Endpoint

**URL de Base**
\`GET /api/agent/chat\`

**Paramètres Requis (Query String)**
\`\`\`javascript 
{
  prompt: "string",      // Message de l'utilisateur
  id: "string",          // ID unique de l'utilisateur Messenger
  agent: "string"        // (Optionnel) Type d'agent/spécialisation
}
\`\`\`

**Réponse JSON Attendue**
\`\`\`json
{
  "success": true,
  "response": "string",  // Réponse textuelle de l'Agent IA
  "contextId": "string", // (Optionnel) ID pour conversations continues
  "tokens": 150          // (Optionnel) Compteur de tokens utilisés
}
\`\`\`

## 🤖 Exemple de Commande Messenger (Node.js)

Structure de Commande (Modèle réutilisable à adapter pour chaque agent)

\`\`\`javascript
const axios = require('axios');
const { sendMessage } = require('../handles/sendMessage');

module.exports = {
    name: 'tsanta',
    description: 'Parler avec Tsanta (Commercial)',
    usage: 'tsanta [votre message]',
    author: 'TeacherMada',

    async execute(senderId, args, pageAccessToken) {
        const prompt = args.join(' ');
        if (!prompt) {
            return sendMessage(senderId, 
                { text: "Usage: tsanta <votre question>" }, 
                pageAccessToken
            );
        }

        try {
            // Appel à votre API endpoint
            // REMPLACER [votre-domaine] PAR L'URL DE VOTRE BACKEND
            const { data } = await axios.get(\`https://[votre-domaine]/api/agent/chat\`, {
                params: {
                    prompt: prompt,
                    id: senderId,
                    agent: 'commercial'
                }
            });

            // Gestion des longs messages (limite Messenger: 2000 caractères)
            const responseText = data.response || "Pas de réponse.";
            const chunks = responseText.match(/.{1,1999}/g) || [];

            // Envoi séquentiel des parties
            for (const chunk of chunks) {
                await sendMessage(senderId, { text: chunk }, pageAccessToken);
            }

        } catch (error) {
            console.error('Agent IA Error:', error);
            await sendMessage(senderId, 
                { text: '⚠️ Erreur. Veuillez réessayer.' }, 
                pageAccessToken
            );
        }
    }
};
\`\`\`
`;
