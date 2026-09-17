/**
 * Autonomous Research Router & 5-7 Angles Generator.
 * Preserves 100% exact lexical integrity, anchor query rules, and temporal sensitivity.
 */

export async function routeIntent(llmClient, userQuery, history = [], currentYear = 2026, currentDateStr = "March 2026") {
  const lowerQ = userQuery.toLowerCase().trim();
  const greetings = ["hi", "hello", "hey", "sup", "kaisa hai", "kaise ho", "help"];
  if (greetings.includes(lowerQ)) {
    return {
      needs_search: false,
      reason: "Greeting or casual conversational check.",
      standalone_query: userQuery,
      search_angles: []
    };
  }

  let historySnippet = "";
  if (history && history.length > 0) {
    historySnippet = "RECENT CONVERSATION HISTORY:\n";
    for (const turn of history.slice(-6)) {
      const role = turn.role === 'user' ? 'User' : 'Assistant';
      const content = turn.content.length > 500 ? turn.content.slice(0, 500) + '... [truncated]' : turn.content;
      historySnippet += `${role}: ${content}\n`;
    }
  }

  // EXACT ORIGINAL ROUTER PROMPT
  const routerPrompt = `
You are an autonomous research query router and strategist.
CURRENT DATE: ${currentDateStr} (Operational Year: ${currentYear})

${historySnippet}
LATEST USER MESSAGE:
"${userQuery}"

TASK:
1. DECIDE \`needs_search\` (true or false):
   - Set to \`false\` ONLY if the user is asking to translate, format, rephrase, or casual banter.
   - Set to \`true\` for recommendations, comparisons, factual questions, or exploratory topics.

2. IF \`needs_search\` is true:
   - \`core_terms\`: Exact specific subject keywords.
   - \`standalone_query\`: Context-resolved query string.
   - \`search_angles\`: Provide exactly 5 to 7 distinct, high-signal search queries covering diverse angles.
     * Query #1: Direct anchor definition / primary match.
     * Query #2: Comparative / similar alternatives.
     * Query #3: Critical acclaim / top rated lists.
     * Query #4: Deep dive / hidden gems.
     * Query #5: Thematic elements / specific subgenre tropes.
     * Query #6 & #7: Community recommendations & discussions.

OUTPUT STRICTLY IN VALID JSON:
{
  "needs_search": true,
  "reason": "Brief explanation",
  "core_terms": "subject terms",
  "standalone_query": "resolved query string",
  "search_angles": ["query 1", "query 2", "query 3", "query 4", "query 5", "query 6"]
}
`;

  try {
    const raw = await llmClient.complete([
      { role: "system", content: "You are a JSON-only query routing engine. Output valid JSON only." },
      { role: "user", content: routerPrompt }
    ], { temperature: 0.2 });

    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.search_angles && Array.isArray(parsed.search_angles) && parsed.search_angles.length >= 4) {
        return parsed;
      }
      if (parsed.needs_search) {
        const base = parsed.standalone_query || parsed.core_terms || userQuery;
        parsed.search_angles = [
          `${base} top rated recommendations`,
          `best similar alternatives like ${base}`,
          `hidden gems and shows like ${base}`,
          `${base} mystery survival thriller comparisons`,
          `must watch psychological series like ${base}`,
          `discussion and rankings for shows like ${base}`
        ];
        return parsed;
      }
      return parsed;
    }
  } catch (e) {
    console.error("Router error:", e);
  }

  // Fallback guaranteeing 5-6 diverse angles
  return {
    needs_search: true,
    reason: "Autonomous multi-perspective search",
    standalone_query: userQuery,
    search_angles: [
      `${userQuery} top recommendations`,
      `best similar alternatives like ${userQuery}`,
      `hidden gems and shows like ${userQuery}`,
      `${userQuery} mystery survival thriller comparisons`,
      `must watch psychological series like ${userQuery}`,
      `discussion and rankings for ${userQuery}`
    ]
  };
}
