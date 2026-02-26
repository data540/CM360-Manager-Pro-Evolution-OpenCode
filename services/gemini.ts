
import { GoogleGenAI, Type } from "@google/genai";

let ai: GoogleGenAI | null = null;

const getAiClient = () => {
  if (ai) return ai;

  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  ai = new GoogleGenAI({ apiKey });
  return ai;
};

export const getAdOpsAssistantResponse = async (prompt: string, history: { role: 'user' | 'model', parts: { text: string }[] }[]) => {
  try {
    const client = getAiClient();
    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      // Fix: Structured contents for the multi-turn conversation.
      contents: [
        ...history,
        { role: 'user', parts: [{ text: prompt }] }
      ],
      config: {
        systemInstruction: `You are a Senior AdOps Specialist (CM360 expert). 
        You help users with placement naming conventions, campaign structuring, and data normalization.
        Keep responses concise, professional, and data-oriented.
        Always provide actionable advice or structured snippets (like CSV-ready strings or naming templates).`,
        temperature: 0.7,
      },
    });

    // Fix: Accessing .text property directly (not a method).
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "AI helper is unavailable. Configure GEMINI_API_KEY in your environment and redeploy.";
  }
};

export const normalizeNamingRules = async (names: string[]) => {
  const prompt = `Normalize the following AdOps placement names to a standard format (e.g., SITE_SIZE_FORMAT_CAMPAIGN). 
  Fix casing (all upper), replace spaces with underscores, and remove special characters.
  Return only the list of normalized names, one per line.
  Names: ${names.join(', ')}`;

  try {
    const client = getAiClient();
    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    // Fix: Accessing .text property directly.
    return response.text?.split('\n').filter(n => n.trim()) || [];
  } catch (error) {
    console.error("Gemini Error:", error);
    return names;
  }
};
