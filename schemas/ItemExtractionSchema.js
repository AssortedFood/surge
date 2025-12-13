// schemas/ItemExtractionSchema.js
import { z } from 'zod';

const ItemExtractionSchema = z.object({
  items: z.array(z.object({
    name: z.string().describe("The item name exactly as it appears in-game, including any variant notation like (4), (inactive), (p++)"),
    snippet: z.string().describe("The exact sentence(s) where this item is mentioned, max 400 chars"),
    context: z.enum([
      "buff",
      "nerf",
      "supply_change",
      "new_content",
      "bug_fix",
      "mention_only"
    ]).describe("Why the item is mentioned"),
    confidence: z.number().min(0).max(1).describe("How confident you are this is a tradeable OSRS item (0.0-1.0)"),
    mentionType: z.enum([
      "direct",
      "implied",
      "category_expansion"
    ]).describe("How the item was identified: direct mention, implied from context, or expanded from a category like 'pickaxes'"),
    variantCategory: z.string().optional().describe("If this item is part of a category expansion (e.g., 'nails', 'pickaxes', 'potions'), name the category")
  }))
});

export { ItemExtractionSchema };
