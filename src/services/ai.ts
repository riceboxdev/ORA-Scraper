
import { VertexAI } from '@google-cloud/vertexai';
import { config } from '../config.js';

// Initialize client with credentials from env if available (for production)
let googleAuthOptions: any = undefined;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
        const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        googleAuthOptions = { credentials };
    } catch (error) {
        console.error('[AI] Error parsing FIREBASE_SERVICE_ACCOUNT_JSON:', error);
    }
}

// Initialize Vertex AI
const vertex_ai = new VertexAI({
    project: config.firebaseProjectId,
    location: 'us-central1',
    googleAuthOptions
});

const model = vertex_ai.getGenerativeModel({
    model: 'gemini-2.0-flash-001',
    generationConfig: {
        responseMimeType: 'application/json',
    }
});

export const aiService = {
    /**
     * Generate name, description, icon and color for a cluster of posts
     */
    async generateTopicFromCluster(context: string, keywords: string) {
        const prompt = `I have grouped similar content from a visual app into a cluster. 
Here are the descriptions of the top items in this group:

${context}

**Top Recurring Keywords**: ${keywords}

Task:
1. Identify the specific subject matter based on the descriptions AND the top keywords.
2. Generate a name using the "Pinterest Strategy":
   - MUST be 2-3 words.
   - MUST be literal and descriptive (e.g. "Dark Mode UI", "Neon Cyberpunk Art").
   - AVOID generic marketing fluff.
3. Write a short description.
4. Suggest a best-fit SF Symbol icon name.
5. Suggest a hex color code.

Return strict JSON:
{
  "ideas": [
    {
      "name": "Title",
      "description": "Description",
      "suggestedIcon": "icon.name",
      "suggestedColor": "#HEX",
      "confidence": 0.9
    }
  ]
}`;

        try {
            const result = await model.generateContent(prompt);
            const response = result.response;
            const text = response.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!text) return null;

            const parsed = JSON.parse(text);
            return parsed;
        } catch (error) {
            console.error('[AI] Gemini generation failed:', error);
            return null;
        }
    }
};
