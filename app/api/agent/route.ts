import { type NextRequest } from "next/server";
import {
  routeToAgent,
  buildAgentPrompt,
  AGENTS,
  type AgentType,
} from "@/lib/agents";

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

interface AgentRequest {
  message: string;
  agent?: AgentType; // optional override — skip routing
  context?: Record<string, unknown>;
}

interface AgentResponse {
  agent: AgentType;
  agentName: string;
  response: string;
  routing: {
    confidence: number;
    reasoning: string;
  };
  tools_invoked: string[];
  guardrails_applied: string[];
}

// ---------------------------------------------------------------------------
// Placeholder agent execution
// ---------------------------------------------------------------------------

function executePlaceholder(
  agentType: AgentType,
  message: string
): { response: string; tools_invoked: string[]; guardrails_applied: string[] } {
  const agent = AGENTS[agentType];

  const placeholders: Record<AgentType, string> = {
    orchestrator: `I've analyzed your request and determined the best specialist to help. Let me route this for you.`,
    scanner: `I'll process your document now. I can handle PDFs, photos (PNG/JPG/HEIC), and forwarded emails. Once extracted, I'll pass the structured data to the Vault Organizer for categorization.`,
    organizer: `I'll categorize this document and check for duplicates in your vault. Your document will be tagged with relevant metadata and filed under the appropriate category.`,
    alerts: `I've scanned your vault for upcoming deadlines. I'll set up notifications so you never miss a renewal or expiration date.`,
    advisor: `I'll analyze your full coverage portfolio and look for gaps, overlaps, and savings opportunities. Note: this is informational only and does not constitute insurance advice. Consult a licensed agent for binding decisions.`,
    sharing: `I'll generate a secure, time-limited link for sharing this document. All access is logged and you'll be notified when someone views it.`,
  };

  return {
    response: placeholders[agentType],
    tools_invoked: agent.tools.slice(0, 2).map((t) => t.name),
    guardrails_applied: agent.guardrails.map((g) => g.id),
  };
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AgentRequest;

    if (!body.message || typeof body.message !== "string") {
      return Response.json(
        { error: "Missing or invalid 'message' field." },
        { status: 400 }
      );
    }

    // Route to agent (or use explicit override)
    const routing = body.agent
      ? {
          agent: body.agent,
          confidence: 1.0,
          reasoning: `Explicit agent override: ${body.agent}`,
        }
      : routeToAgent(body.message);

    // Validate agent type
    if (!AGENTS[routing.agent]) {
      return Response.json(
        { error: `Unknown agent type: ${routing.agent}` },
        { status: 400 }
      );
    }

    // Build the system prompt (would be sent to LLM in production)
    const _systemPrompt = buildAgentPrompt(routing.agent, body.message);

    // Execute placeholder logic
    const result = executePlaceholder(routing.agent, body.message);

    const response: AgentResponse = {
      agent: routing.agent,
      agentName: AGENTS[routing.agent].name,
      response: result.response,
      routing: {
        confidence: routing.confidence,
        reasoning: routing.reasoning,
      },
      tools_invoked: result.tools_invoked,
      guardrails_applied: result.guardrails_applied,
    };

    return Response.json(response);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
