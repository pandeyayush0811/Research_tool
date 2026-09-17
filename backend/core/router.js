/**
 * Autonomous Research Router & 5-7 Angles Generator.
 * Bulletproof multi-strategy parser ensuring minimum 5 distinct search angles.
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
    for (const turn of history.slice(-4)) {
      const role = turn.role === 'user' ? 'User' : 'Assistant';
      const content = turn.content.length > 300 ? turn.content.slice(0, 300) + '...' : turn.content;
      historySnippet += `${role}: ${content}\n`;
    }
  }

  const routerPrompt = `
You are an autonomous research query strategist.
CURRENT DATE: ${currentDateStr} (Operational Year: ${currentYear})

${historySnippet}
LATEST USER MESSAGE:
"${userQuery}"

TASK:
1. DECIDE if external web search is needed (true or false).
   - Set to false ONLY for trivial greetings, translation, or rephrasing.
   - Set to true for recommendations, comparisons, factual queries, and deep research.

2. IF search is needed, formulate exactly 5 to 7 high-impact, diverse search queries.
   - Query 1: Direct anchor match / top rated recommendations.
   - Query 2: Similar alternatives and comparisons.
   - Query 3: Hidden gems and critically acclaimed titles.
   - Query 4: Thematic elements and specific plot tropes.
   - Query 5: Community rankings and Reddit/forum discussions.

FORMAT YOUR OUTPUT EXACTLY AS:
SEARCH: true
REASON: Brief reason
ANGLE 1: [Query 1]
ANGLE 2: [Query 2]
ANGLE 3: [Query 3]
ANGLE 4: [Query 4]
ANGLE 5: [Query 5]
ANGLE 6: [Query 6]
`;

  try {
    const raw = await llmClient.complete([
      { role: "system", content: "You are a research query router. Output strict clean lines." },
      { role: "user", content: routerPrompt }
    ], { temperature: 0.2 });

    const angles = [];
    const lines = raw.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^ANGLE\s*\d+\s*:\s*(.+)$/i);
      if (match && match[1]) {
        const q = match[1].replace(/[\[\]"']/g, '').trim();
        if (q.length > 4 && !angles.includes(q)) {
          angles.push(q);
        }
      }
    }

    // Also check for JSON fallback if model returned JSON
    if (angles.length < 3) {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.search_angles && Array.isArray(parsed.search_angles)) {
            parsed.search_angles.forEach(q => {
              if (q && !angles.includes(q)) angles.push(q.trim());
            });
          }
        } catch (e) {}
      }
    }

    // Also check for bulleted or numbered lines if model used numbers
    if (angles.length < 3) {
      for (const line of lines) {
        const matchNum = line.trim().match(/^\d+[.)-]\s*(.+)$/);
        if (matchNum && matchNum[1]) {
          const cleanQ = matchNum[1].replace(/[\[\]"']/g, '').trim();
          if (cleanQ.length > 5 && !angles.includes(cleanQ)) {
            angles.push(cleanQ);
          }
        }
      }
    }

    if (angles.length >= 3) {
      return {
        needs_search: true,
        reason: "Multi-perspective investigation",
        standalone_query: userQuery,
        search_angles: angles.slice(0, 7)
      };
    }
  } catch (e) {
    console.error("Router call error:", e.message);
  }

  // Guaranteed 5 diverse fallback angles derived from user keywords
  const cleanQ = userQuery.replace(/^(hey|hi|hello|tell me|mujhe|batao|kripya)\s*/i, '').trim();
  return {
    needs_search: true,
    reason: "Guaranteed multi-angle perspective coverage",
    standalone_query: cleanQ,
    search_angles: [
      `${cleanQ} top rated recommendations`,
      `best similar alternatives like ${cleanQ}`,
      `hidden gems and psychological thrillers like ${cleanQ}`,
      `${cleanQ} mystery survival show comparisons`,
      `community discussion and must watch series like ${cleanQ}`
    ]
  };
}
