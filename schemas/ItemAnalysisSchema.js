// schemas/ItemAnalysisSchema.js
import { z } from 'zod';

const ItemAnalysisSchema = z.object({
  relevant_text_snippet: z.string(),
  expected_price_change: z.enum([
    "Price increase",
    "Price decrease",
    "No change"
  ])
});

export { ItemAnalysisSchema };