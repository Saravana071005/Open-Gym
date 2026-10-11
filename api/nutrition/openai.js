/**
 * Server-Side OpenAI Client for Food Description Parsing
 * 
 * Rules:
 * 1. Uses OPENAI_API_KEY and configurable OPENAI_MODEL (default: gpt-4o-mini).
 * 2. Uses structured output (json_schema) strictly to extract food entities.
 * 3. NEVER asks the LLM to invent, estimate, or hallucinate macro/calorie values.
 * 4. Never logs or exposes OPENAI_API_KEY.
 * 5. Falls back to local deterministic rule-based parser if API key is not configured or on network/API failure.
 */

import OpenAI from 'openai';

let openaiClient = null;

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: apiKey.trim()
    });
  }
  return openaiClient;
}

const PARSE_MEAL_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "parse_meal_response",
    strict: true,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              raw_phrase: { type: "string" },
              food_name: { 
                type: "string", 
                description: "Standard canonical English or Indian food name, correcting typos (e.g., 'rolled oats', 'honey', 'banana', 'almonds', 'raisins', 'egg', 'roti')" 
              },
              quantity: { 
                type: "number", 
                description: "Extracted numerical quantity (e.g. 100, 150, 5, 3, 1). Default to 1 if unspecified." 
              },
              unit: { 
                type: "string", 
                description: "Measurement unit: 'g', 'kg', 'ml', 'l', 'piece', 'tbsp', 'tsp', 'cup', 'katori', 'bowl', 'plate', 'slice', or 'serving'" 
              },
              prep_state: { 
                type: "string", 
                description: "Preparation state: 'raw', 'soaked', 'boiled', 'roasted', 'cooked', 'fried', 'steamed', 'baked', etc." 
              },
              ingredients: {
                type: "array",
                items: { type: "string" },
                description: "Sub-ingredients if composite dish, otherwise empty array"
              },
              clarification_needed: { 
                type: "string", 
                description: "Clarification question if the user's intent is ambiguous; empty string if clear" 
              }
            },
            required: ["raw_phrase", "food_name", "quantity", "unit", "prep_state", "ingredients", "clarification_needed"],
            additionalProperties: false
          }
        }
      },
      required: ["items"],
      additionalProperties: false
    }
  }
};

const SYSTEM_PROMPT = `You are a clinical nutrition semantic parser for openGym.
Your sole job is to parse unstructured meal descriptions into structured food entities.

CRITICAL RULES:
1. DO NOT calculate, estimate, predict, or invent ANY calories, macros (protein, carbs, fat, fibre) or nutrient figures. Nutritional values are strictly computed server-side from verified laboratory datasets.
2. Accurately resolve colloquial Indian and regional food terms:
   - "badam" -> "almond"
   - "dry grapes" / "kishmish" / "kismis" -> "raisins"
   - "anda" / "muttai" -> "egg"
   - "chawal" / "sadam" -> "rice"
   - "dahi" -> "yogurt"
   - "paneer" -> "cottage cheese paneer"
   - "bannana" -> "banana" (correct typos)
3. Extract precise quantities and units:
   - If user writes "100 gm" or "150gm", extract quantity = 100 or 150, unit = "g".
   - If user writes count without unit like "5 badam", "5 dry grapes", "3 boiled eggs", unit = "piece".
   - If user mentions condiments/sweeteners without quantity like "with honey", "some ghee", quantity = 1, unit = "tbsp".
   - If user writes "overnight soaked oats", food_name = "rolled oats", prep_state = "soaked".
4. If an item is truly ambiguous (e.g. "curry", "protein shake", "peanuts" without prep state), provide a concise clarification question in clarification_needed.
`;

export async function parseMealWithOpenAI(text) {
  const client = getOpenAIClient();
  if (!client) {
    return null; // Signals fallback to local parser
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      response_format: PARSE_MEAL_SCHEMA,
      temperature: 0.1
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    return parsed.items || [];
  } catch (err) {
    // Log error message without sensitive details
    console.error('OpenAI meal parsing error:', err.message || err);
    return null;
  }
}
