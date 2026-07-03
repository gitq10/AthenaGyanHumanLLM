import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

type Phase = "intake" | "outcome" | "context" | "report" | "followup" | "companion" | "enhance";

// Keywords that signal a live-web query is needed
const WEB_SEARCH_TRIGGERS = [
  /\bjob[s]?\b/i, /\bhiring\b/i, /\bvacancy|vacancies\b/i, /\brecruit/i,
  /\bsalary\b/i, /\blatest\b/i, /\bcurrent\b/i, /\btoday\b/i, /\bnews\b/i,
  /\bprice[s]?\b/i, /\bstock\b/i, /\bweather\b/i, /\brecent\b/i,
  /\b2025\b/, /\b2026\b/, /\bright now\b/i, /\bthis week\b/i, /\bthis month\b/i,
  /\bwhat is happening\b/i, /\btrending\b/i, /\blaunch(ed)?\b/i,
  /\breview[s]?\b/i, /\brating[s]?\b/i, /\bhow much does\b/i,
];

function needsWebSearch(text: string): boolean {
  return WEB_SEARCH_TRIGGERS.some(r => r.test(text));
}

async function braveSearch(query: string, braveKey: string): Promise<string> {
  const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=5&text_decorations=false`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": braveKey,
    },
  });
  if (!res.ok) return "";

  const data = await res.json();
  const results = (data.web?.results || []) as Array<{
    title: string;
    description: string;
    url: string;
    age?: string;
  }>;

  if (results.length === 0) return "";

  return results
    .slice(0, 5)
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.description || ""}\nSource: ${r.url}${r.age ? ` (${r.age})` : ""}`)
    .join("\n\n");
}

// System prompts for each phase
const PHASE_PROMPTS: Record<Phase, string> = {
  intake: "", // never called directly — frontend triggers outcome phase

  enhance: `You are a prompt engineering expert for Athena GYAN, an AI intelligence platform. The user has typed a rough, initial prompt. Your job is to transform it into 3 significantly improved versions that will produce a far better, more focused, and more personalized response from the AI.

Each enhanced prompt must:
- Preserve 100% of the user's original intent — never change what they are asking about
- Add specificity: who the user likely is, their likely context, what they actually need
- Add clarity: remove ambiguity, tighten the language
- Add depth cues: signal the kind of answer they want (actionable steps, analysis, examples, etc.)
- Be written in first person from the user's perspective
- Be 2-4 sentences long — substantial but not overwhelming
- Each version should take a DIFFERENT angle: e.g., one tactical, one strategic, one personal/emotional

CRITICAL: These must be genuinely superior prompts that would produce noticeably better AI responses. Do NOT produce generic, padded, or placeholder prompts. The quality of the final AI report depends entirely on these.

Return ONLY valid JSON in this exact format, nothing else:
{
  "enhancedPrompts": [
    "First enhanced version...",
    "Second enhanced version...",
    "Third enhanced version..."
  ]
}`,

  outcome: `You are Gyan, a warm, deeply intelligent AI from Athena GYAN. The user has just shared what is on their mind.

Your job right now has TWO parts:

PART 1 — Write a SHORT warm acknowledgment (1-2 sentences max) showing you understood what they shared.

PART 2 — Generate EXACTLY 4 outcome chips. These are short, specific phrases (6-10 words each) representing 4 different things the user might want to achieve based on what they just said. Make them concrete, actionable, and varied so the user can instantly recognize which one fits them.

VERY IMPORTANT: You MUST return a valid JSON response in this exact format and nothing else:
{
  "reply": "Your 1-2 sentence warm acknowledgment here",
  "outcomeChips": ["Chip 1 phrase", "Chip 2 phrase", "Chip 3 phrase", "Chip 4 phrase"]
}

Think of the chips like: if someone says "I want to grow my business", good chips might be:
- "Get my first 100 paying customers"
- "Increase monthly revenue by 50%"
- "Build a team and delegate effectively"
- "Launch a second income stream"

Always tailor the chips tightly to what the user actually said.`,

  context: `You are Gyan, a warm intelligent AI from Athena GYAN. You now know the user's desired outcome.

Ask ONE short, focused question to understand their current situation better. This will help you give a much more relevant and personalized final answer.

The question should be:
- Specific to their situation, not generic
- Easy to answer in 1-2 sentences
- Something that meaningfully changes what advice you would give

Keep your entire response under 3 sentences. Be warm and encouraging. End with the question.

Return plain text only — no JSON needed here.`,

  report: `You are Gyan, a powerfully knowledgeable AI from Athena GYAN. You now have full context: the user's initial message, their desired outcome, and their situation.

Deliver a comprehensive, well-structured INTELLIGENCE REPORT. This is your main event — give them real value.

Requirements:
- Open with "Here is your Gyan Intelligence Report:" or similar
- Use clear section headings or numbered points
- Give specific, actionable insights — not vague advice
- Include 2-3 concrete examples, data points, or real-world facts
- End with 1 empowering closing sentence
- Be thorough but scannable — depth with clarity
- Aim for 400-600 words

This is what separates GYAN from any basic chatbot. Make it exceptional.

Return plain text only.`,

  followup: `You are Gyan, a warm intelligent AI from Athena GYAN. The user has just received their Intelligence Report and wants to explore further.

They may be asking a follow-up question, or you may have been asked to suggest next questions.

If they asked a specific question: answer it clearly and concisely, then generate 3 suggested follow-up questions.

If they asked you to "suggest relevant follow-up questions": generate 4 highly relevant follow-up questions based on their report topic. Each should open a new angle worth exploring.

ALWAYS return a valid JSON in this exact format:
{
  "reply": "Your answer or intro text here",
  "suggestedQuestions": ["Question 1?", "Question 2?", "Question 3?"]
}

Make suggested questions specific to what was in their report — not generic.`,

  companion: `You are Gyan, a warm, brilliant, and deeply knowledgeable AI companion from Athena GYAN. The user has chosen Companion Mode — a free-flowing conversation.

Respond naturally, like a knowledgeable friend who happens to be an expert in anything they need. Be conversational, insightful, occasionally ask follow-up questions, and build on the context of the full conversation history.

This is their personal Life OS companion. Make every exchange feel valuable and human.

Return plain text only.`,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const {
      message,
      phase,
      sessionId,
      userId,
      userName,
      conversationHistory = [],
      isChipSelection = false,
      desiredOutcome = "",
      fileContent = "",
    } = await req.json();

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "Anthropic API key not configured. Please add ANTHROPIC_API_KEY to Supabase Edge Function secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const braveKey = Deno.env.get("BRAVE_SEARCH_API_KEY") || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Memory: inject past context for report phase
    let memoryContext = "";
    let usedMemory = false;

    if (userId && phase === "report") {
      try {
        const { data: pastConvos } = await supabase
          .from("conversations")
          .select("content, role, created_at")
          .eq("user_id", userId)
          .not("session_id", "eq", sessionId)
          .eq("role", "assistant")
          .in("phase", ["report", "companion"])
          .order("created_at", { ascending: false })
          .limit(3);

        if (pastConvos && pastConvos.length > 0) {
          memoryContext = `\n\nFor additional personalization, here is relevant context from ${userName}'s previous GYAN conversations:\n` +
            pastConvos.map((c: { content: string }) => `- ${c.content.slice(0, 250)}...`).join("\n");
          usedMemory = true;
        }
      } catch {
        // Non-fatal
      }
    }

    const currentPhase: Phase = (phase as Phase) || "outcome";

    // ── Enhance phase: fast prompt improvement, no history needed ──
    if (currentPhase === "enhance") {
      const enhancePrompt = PHASE_PROMPTS["enhance"];
      const enhanceResponse = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 800,
          system: enhancePrompt,
          messages: [{ role: "user", content: `Original prompt: "${message}"` }],
        }),
      });
      if (!enhanceResponse.ok) {
        return new Response(
          JSON.stringify({ error: "Enhancement failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const enhanceData = await enhanceResponse.json();
      const rawEnhance = enhanceData.content?.[0]?.text || "";
      try {
        const jsonMatch = rawEnhance.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return new Response(
            JSON.stringify({ enhancedPrompts: parsed.enhancedPrompts || [] }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch { /* fall through */ }
      return new Response(
        JSON.stringify({ enhancedPrompts: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Web search: check if live data would help ──
    let webSearchContext = "";
    let usedWebSearch = false;
    const searchablePhases: Phase[] = ["report", "companion", "followup"];

    if (braveKey && searchablePhases.includes(currentPhase) && needsWebSearch(message)) {
      try {
        const searchQuery = message.length > 120 ? message.slice(0, 120) : message;
        const results = await braveSearch(searchQuery, braveKey);
        if (results) {
          webSearchContext = `\n\n--- LIVE WEB SEARCH RESULTS (fetched right now) ---\n${results}\n--- END OF SEARCH RESULTS ---\n\nIMPORTANT: Use these live results to ground your answer with current, real information. Cite sources where helpful. Tell the user you searched the web for them.`;
          usedWebSearch = true;
        }
      } catch {
        // Non-fatal — degrade gracefully without search
      }
    }

    const basePrompt = PHASE_PROMPTS[currentPhase];
    const outcomeContext = desiredOutcome
      ? `\n\nCRITICAL — The user's desired outcome for this conversation is: "${desiredOutcome}". Every response you give MUST be laser-focused on helping them achieve this exact outcome. Do not drift from it.`
      : "";
    const fileContext = fileContent
      ? `\n\nThe user has attached a file. Here is the file content for your reference:\n---\n${fileContent}\n---\nRefer to and analyze this content in your response as relevant.`
      : "";
    const systemPrompt = basePrompt +
      `\n\nThe user's name is ${userName}. Address them by name naturally once or twice.` +
      outcomeContext +
      fileContext +
      (webSearchContext || "") +
      (memoryContext || "");

    // Build message history for API
    const apiMessages = conversationHistory.map((m: { role: string; content: string }) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));

    const userContent = isChipSelection
      ? `My desired outcome is: ${message}`
      : message;

    apiMessages.push({ role: "user", content: userContent });

    const maxTokens = phase === "report" ? 1800 : phase === "followup" ? 800 : 600;

    const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: apiMessages,
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", errText);
      let userMessage = `Anthropic API error: ${anthropicResponse.status}`;
      if (anthropicResponse.status === 401) {
        userMessage = "Invalid Anthropic API key. Please check your ANTHROPIC_API_KEY secret in Supabase.";
      } else if (anthropicResponse.status === 403) {
        userMessage = "Anthropic API key does not have permission to use this model.";
      } else if (anthropicResponse.status === 429) {
        userMessage = "Anthropic API rate limit exceeded. Please try again in a moment.";
      } else {
        try {
          const errJson = JSON.parse(errText);
          if (errJson?.error?.message) userMessage = errJson.error.message;
        } catch { /* ignore */ }
      }
      return new Response(
        JSON.stringify({ error: userMessage }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anthropicData = await anthropicResponse.json();
    const rawText = anthropicData.content?.[0]?.text || "";

    // Parse JSON responses for phases that return structured data
    if (phase === "outcome" || phase === "followup") {
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return new Response(
            JSON.stringify({
              reply: parsed.reply || rawText,
              outcomeChips: parsed.outcomeChips || undefined,
              suggestedQuestions: parsed.suggestedQuestions || undefined,
              usedMemory,
              usedWebSearch,
              phase: currentPhase,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch {
        // Fall through to plain text response
      }
    }

    return new Response(
      JSON.stringify({ reply: rawText, usedMemory, usedWebSearch, phase: currentPhase }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
