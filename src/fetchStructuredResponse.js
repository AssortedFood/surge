import 'dotenv/config';
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function fetchStructuredResponse(model, systemMessage, userMessage, zodSchemaObject) {
    const completion = await openai.beta.chat.completions.parse({
        model: model,
        messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userMessage },
        ],
        response_format: zodResponseFormat(zodSchemaObject, "response"),
        });
    
        const response = completion.choices[0]?.message?.parsed;
        return response
}

export { fetchStructuredResponse };