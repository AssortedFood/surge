// src/contentCleaner.js
// Cleans post content to remove predictable noise before LLM processing

/**
 * Patterns to strip from post content
 */

// JMod signature block at the end of every post
// "Mods Abe, Abyss, Acorn, ... & Yume\n\nThe Old School Team."
const JMOD_SIGNATURE_PATTERN =
  /\n*Mods?\s+[A-Z][a-z]+(?:,?\s*[A-Z][a-z]+)*(?:\s*&\s*[A-Z][a-z]+)?\s*\n+The Old School Team\.?/gi;

// Image/video placeholders
// "If you can't see the image above, click here!"
const MEDIA_PLACEHOLDER_PATTERN =
  /If you can'?t see the (?:image|video) above,? click here\.?!?/gi;

// Social links boilerplate at the end
// "You can also discuss this update on the 2007Scape subreddit..."
const SOCIAL_BOILERPLATE_PATTERN =
  /You can also discuss this (?:update|merch release) on the 2007Scape subreddit[^\n]*(?:\n|$)/gi;

// "For more info on the above content, check out the official Old School Wiki."
const WIKI_LINK_PATTERN =
  /For more info on the above content,? check out the official Old School Wiki\.?/gi;

// PvP World Rota sections (tables of world numbers) - captures the whole section
const PVP_ROTA_PATTERN =
  /(?:PvP World Rota|The PvP rota has moved to Period [A-Z]:?)[\s\S]*?(?:this (?:rota|week)\.?)\n*/gi;

// "CLICK HERE TO SHOW" for expandable sections (already expanded by Puppeteer)
const CLICK_TO_SHOW_PATTERN = /CLICK HERE TO SHOW\n*/gi;

// Multiple consecutive newlines (normalize to max 2)
const EXCESSIVE_NEWLINES = /\n{3,}/g;

/**
 * Cleans post content by removing predictable noise
 * @param {string} rawContent - The raw post content from Puppeteer
 * @returns {string} - Cleaned content ready for LLM processing
 */
export function cleanPostContent(rawContent) {
  if (!rawContent) return '';

  let cleaned = rawContent;

  // Remove patterns in order (some patterns depend on others being present)
  cleaned = cleaned.replace(MEDIA_PLACEHOLDER_PATTERN, '');
  cleaned = cleaned.replace(CLICK_TO_SHOW_PATTERN, '');
  cleaned = cleaned.replace(PVP_ROTA_PATTERN, '');
  cleaned = cleaned.replace(SOCIAL_BOILERPLATE_PATTERN, '');
  cleaned = cleaned.replace(WIKI_LINK_PATTERN, '');
  cleaned = cleaned.replace(JMOD_SIGNATURE_PATTERN, '');

  // Normalize whitespace
  cleaned = cleaned.replace(EXCESSIVE_NEWLINES, '\n\n');
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Estimates token count reduction from cleaning
 * Useful for debugging/logging
 * @param {string} original - Original content
 * @param {string} cleaned - Cleaned content
 * @returns {object} - Stats about the cleaning
 */
export function getCleaningStats(original, cleaned) {
  const originalLength = original.length;
  const cleanedLength = cleaned.length;
  const reduction = originalLength - cleanedLength;
  const reductionPercent =
    originalLength > 0 ? ((reduction / originalLength) * 100).toFixed(1) : 0;

  return {
    originalLength,
    cleanedLength,
    reduction,
    reductionPercent: `${reductionPercent}%`,
  };
}
