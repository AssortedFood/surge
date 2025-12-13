// schemas/ItemExtractionSchema.js
import { z } from 'zod';

const ItemExtractionSchema = z.object({
  items: z.array(z.object({
    name: z.string().describe("The item name as it appears in-game"),
    snippet: z.string().describe("The exact sentence(s) where this item is mentioned, max 200 chars"),
    context: z.enum([
      "buff",
      "nerf",
      "supply_change",
      "new_content",
      "bug_fix",
      "mention_only"
    ]).describe("Why the item is mentioned")
  }))
});

export { ItemExtractionSchema };
