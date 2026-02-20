
import { GoogleGenAI, Type } from "@google/genai";

// Fix: Initializing GoogleGenAI correctly using named parameter and process.env.API_KEY directly.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getAdOpsAssistantResponse = async (prompt: string, history: { role: 'user' | 'model', parts: { text: string }[] }[]) => {
  try {
    const response = await ai.models.generateContent({
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
    return "I'm having trouble connecting to my reasoning core. Please try again or check your API configuration.";
  }
};

export const normalizeNamingRules = async (names: string[]) => {
  const prompt = `Normalize the following AdOps placement names to a standard format (e.g., SITE_SIZE_FORMAT_CAMPAIGN). 
  Fix casing (all upper), replace spaces with underscores, and remove special characters.
  Return only the list of normalized names, one per line.
  Names: ${names.join(', ')}`;

  try {
    const response = await ai.models.generateContent({
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
