// schemas/PricePredictionSchema.js
import { z } from 'zod';

const PricePredictionSchema = z.object({
  direction: z.enum([
    "Price increase",
    "Price decrease",
    "No change"
  ]),
  reasoning: z.string().describe("Brief explanation, max 100 chars")
});

export { PricePredictionSchema };
