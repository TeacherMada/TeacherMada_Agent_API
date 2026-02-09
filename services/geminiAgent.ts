import { GoogleGenAI, Type } from "@google/genai";
import { AgentRequest, AgentResponse } from "../types";
import { SYSTEM_INSTRUCTION } from "../constants";

interface HistoryContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export class GeminiAgentService {
  private apiKeys: string[];
  private currentKeyIndex: number = 0;
  private modelName = 'gemini-3-flash-preview';
  // Memory store: Map<UserId, History[]>
  private memories: Map<string, HistoryContent[]> = new Map();
  
  // Settings for summarization
  private readonly HISTORY_LIMIT = 10; // Number of messages before triggering summary
  private readonly RETAIN_COUNT = 4;   // Number of recent messages to keep raw

  constructor(apiKeyString: string) {
    // Parse comma-separated keys and clean them
    this.apiKeys = apiKeyString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    
    if (this.apiKeys.length === 0) {
      console.warn("No API keys provided to GeminiAgentService");
    } else {
      console.log(`Initialized with ${this.apiKeys.length} API Key(s)`);
    }
  }

  private getClient(): GoogleGenAI {
    const key = this.apiKeys[this.currentKeyIndex];
    return new GoogleGenAI({ apiKey: key });
  }

  private rotateKey() {
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    console.log(`Quota/Error detected. Switching to API Key index: ${this.currentKeyIndex}`);
  }

  private async summarizeHistory(history: HistoryContent[]): Promise<HistoryContent[]> {
    if (history.length <= this.HISTORY_LIMIT) return history;

    console.log("History limit reached. Summarizing conversation...");
    
    const messagesToSummarize = history.slice(0, history.length - this.RETAIN_COUNT);
    const recentMessages = history.slice(history.length - this.RETAIN_COUNT);

    // Create a readable transcript for the model
    const transcript = messagesToSummarize.map(m => `${m.role.toUpperCase()}: ${m.parts[0].text}`).join('\n');
    const prompt = `Summarize the key facts, user intent, language preference, and status from the following conversation history. Be concise.\n\n${transcript}`;

    try {
      // Use the current client to generate a summary
      // We don't use strict JSON here, just text
      const ai = this.getClient();
      const response = await ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
      });

      const summaryText = response.text || "Previous conversation summary unavailable.";

      // Replace old messages with the summary injected as a system context (simulated via User/Model turn)
      const summaryTurn: HistoryContent[] = [
        { 
          role: 'user', 
          parts: [{ text: `[SYSTEM: Previous Conversation Summary]: ${summaryText}` }] 
        },
        { 
          role: 'model', 
          parts: [{ text: "Acknowledged. I will use this summary as context." }] 
        }
      ];

      return [...summaryTurn, ...recentMessages];

    } catch (error) {
      console.error("Summarization failed:", error);
      // In case of error, just return the truncated list or original to avoid data loss, 
      // but here we return original to be safe.
      return history;
    }
  }

  async processMessage(request: AgentRequest): Promise<AgentResponse> {
    // 1. Retrieve existing history or initialize
    let history = this.memories.get(request.userId) || [];

    // 2. Check and Summarize if necessary
    if (history.length >= this.HISTORY_LIMIT) {
      history = await this.summarizeHistory(history);
      // Update memory with summarized version immediately
      this.memories.set(request.userId, history);
    }

    // 3. Construct the user content
    const contextStr = request.context 
      ? `[System Context: Language=${request.context.language}, Stage=${request.context.stage}] ` 
      : '';
    
    const userMessageText = `${contextStr}${request.message}`;
    
    const userContent: HistoryContent = {
      role: 'user',
      parts: [{ text: userMessageText }]
    };

    // Combine history with new message
    const contents = [...history, userContent];

    // 4. Execute with Retry Logic (Key Rotation)
    let attempts = 0;
    
    while (attempts < this.apiKeys.length) {
      try {
        const ai = this.getClient();
        
        const response = await ai.models.generateContent({
          model: this.modelName,
          contents: contents,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: { 
                  type: Type.STRING, 
                  description: "The text response to be sent to the user on Messenger. Keep it concise." 
                },
                detected_language: { 
                  type: Type.STRING, 
                  description: "The detected language of the user message (e.g., 'fr', 'en', 'mg')." 
                },
                intent: { 
                  type: Type.STRING, 
                  enum: ["greeting", "info", "learning", "pricing", "signup", "unknown"],
                  description: "The intent of the user message."
                },
                next_action: { 
                  type: Type.STRING, 
                  enum: ["ask_question", "present_offer", "redirect_human", "send_link", "none"],
                  description: "The recommended next action for the bot."
                }
              },
              required: ["reply", "detected_language", "intent", "next_action"]
            }
          },
        });

        if (!response.text) {
          throw new Error("No response text received from Gemini");
        }

        const parsedResponse = JSON.parse(response.text) as AgentResponse;

        // 5. Update Memory on Success
        const modelContent: HistoryContent = {
          role: 'model',
          parts: [{ text: response.text }]
        };
        this.memories.set(request.userId, [...contents, modelContent]);

        return parsedResponse;

      } catch (error) {
        console.error(`Error with API Key index ${this.currentKeyIndex}:`, error);
        
        attempts++;
        
        // If we have more keys to try, rotate and continue loop
        if (attempts < this.apiKeys.length) {
          this.rotateKey();
          continue;
        }

        // If all keys failed, return fallback
        return {
          reply: "Désolé, nos serveurs sont actuellement surchargés. Veuillez réessayer dans un instant.",
          detected_language: "fr",
          intent: "unknown",
          next_action: "none"
        };
      }
    }

    return {
        reply: "System Error: All API keys exhausted.",
        detected_language: "en",
        intent: "unknown",
        next_action: "none"
    };
  }
}