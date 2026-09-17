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

  // EXACT ORIGINAL ROUTER PROMPT (0.0001% change)
  const routerPrompt = `
You are an autonomous research query router and strategist.
CURRENT DATE: ${currentDateStr} (Operational Year: ${currentYear})

${historySnippet}
LATEST USER MESSAGE:
"${userQuery}"

TASK:
1. DECIDE \`needs_search\` (true or false):
   - Set to \`false\` if the user is asking to:
     * Translate, format, rephrase, or summarize something already discussed above.
     * Ask a follow-up or clarification that can be answered entirely from the existing conversation history.
     * Casual banter, thanks, or feedback.
   - Set to \`true\` if the user is asking for:
     * New external facts, recent news, updates, or a new topic.
     * Deeper external verification or specific new questions about a person, entity, or event.

2. IF \`needs_search\` is true:
   - \`core_terms\`: Identify the exact specific subject noun phrases, technical concepts, or entities from the user's message (e.g. "AI harness", "Kafka tombstone", "Pell's equation", "CRISPR Cas12").
   - \`standalone_query\`: Resolve any ambiguous pronouns ("he", "that case", "they", "point 2") using conversation history, while strictly preserving the core subject terms.
   - \`search_angles\`: Provide 5 to 7 distinct, high-signal search queries (minimum 4, maximum 9) covering diverse angles of this specific topic.
     * UNIVERSAL LEXICAL INTEGRITY (Zero-Generalization Rule):
       NEVER drop, delete, or over-generalize specific technical terms, named entities, or jargon into broad parent categories!
       (e.g., NEVER turn 'AI harness' into generic 'AI', NEVER turn 'Kafka tombstone' into generic 'database', NEVER turn 'Pell's equation' into generic 'math').
       Every generated query MUST explicitly contain or directly focus on the specific core terms!
     * ANCHOR QUERY RULE:
       Query #1 MUST ALWAYS be a direct, targeted definition/explainer search of the exact core terms (e.g., "[core terms] definition meaning explained").
     * TEMPORAL SENSITIVITY:
       - If TIME-SENSITIVE ('now', 'latest', modern models, news): Anchor to ${currentYear} or freshness terms. NEVER use 2023/2024!
       - If TIMELESS/SCIENTIFIC/HISTORICAL: Do not force ${currentYear}. Search naturally.

OUTPUT STRICTLY IN VALID JSON:
{
  "needs_search": true or false,
  "reason": "Brief explanation",
  "core_terms": "The exact subject terms identified",
  "standalone_query": "Context-resolved query string",
  "search_angles": ["query 1 (anchor definition)", "query 2", "query 3", "query 4", "query 5", "query 6", "query 7"]
}
`;

  try {
    const raw = await llmClient.complete([
      { role: "system", content: "You are a JSON-only query routing engine." },
      { role: "user", content: routerPrompt }
    ], { temperature: 0.2, jsonMode: true });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Router error:", e);
  }

  return {
    needs_search: true,
    reason: "Default investigative search",
    standalone_query: userQuery,
    search_angles: [userQuery]
  };
}
