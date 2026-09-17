/**
 * Synthesis Engine for Grounded Research Reports.
 * Preserves 100% exact adaptive depth, natural tone, zero robotic templates, and clickable markdown citations.
 */

export function buildSynthesisPrompt(userQuery, scrapedData, history = [], currentYear = 2026, currentDateStr = "March 2026") {
  const evidenceBlocks = scrapedData.map((doc, idx) => {
    return `--- SOURCE ${idx + 1}: ${doc.title} ---
URL: ${doc.url}
RELEVANT FOR QUERY: ${doc.query_source}
CONTENT:
${doc.content}
`;
  });
  const evidenceText = evidenceBlocks.join('\n');

  let conversationContext = "";
  if (history && history.length > 0) {
    conversationContext = "\nPREVIOUS CONVERSATION CONTEXT:\n";
    for (const turn of history.slice(-4)) {
      const role = turn.role === 'user' ? 'User' : 'Assistant';
      conversationContext += `${role}: ${turn.content.slice(0, 350)}...\n`;
    }
  }

  // EXACT ORIGINAL SYNTHESIS INSTRUCTIONS (0.0001% change)
  return `
CURRENT DATE: ${currentDateStr} (Operational Year: ${currentYear})

${conversationContext}
USER'S CURRENT INQUIRY:
"${userQuery}"

CRAWLED & VERIFIED EVIDENCE POOL (${scrapedData.length} Unique Sources Crawled):
${evidenceText}

INSTRUCTIONS FOR YOUR ANSWER:
1. ADAPTIVE DEPTH:
   - If quick/casual, give a direct, punchy, conversational answer.
   - If detailed/deep-dive, give an exhaustive, nuanced breakdown.
   - Default: Give a rich, engaging, well-rounded explanation.
2. NO ROBOTIC TEMPLATES: Do NOT use artificial headers like 'Deep Inquiry Dossier' or 'Section 1...'. Structure naturally with clean markdown headers and bullet points.
3. TONE & HONESTY: Match the user's language naturally (Hinglish / English). Always be 100% honest, objective, and unbiased. If facts are disputed or evolving, state so transparently.
4. CITE SOURCES: Include direct clickable markdown links [Source Name](URL) at the bottom or inline.
`;
}
