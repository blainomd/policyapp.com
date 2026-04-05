// PolicyApp Agentic System — Agent Definitions
// Each agent: type, description, tools, guardrails, system prompt builder

export type AgentType =
  | "orchestrator"
  | "scanner"
  | "organizer"
  | "alerts"
  | "advisor"
  | "sharing";

export type DocumentCategory =
  | "advance_directive"
  | "lmn"
  | "insurance"
  | "care_agreement"
  | "power_of_attorney"
  | "hipaa";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, string>;
}

export interface AgentGuardrail {
  id: string;
  description: string;
  enforcement: "block" | "warn" | "log";
}

export interface AgentDefinition {
  type: AgentType;
  name: string;
  description: string;
  tools: AgentTool[];
  guardrails: AgentGuardrail[];
}

// ---------------------------------------------------------------------------
// Agent registry
// ---------------------------------------------------------------------------

export const AGENTS: Record<AgentType, AgentDefinition> = {
  // ---- ORCHESTRATOR -------------------------------------------------------
  orchestrator: {
    type: "orchestrator",
    name: "Policy Orchestrator",
    description:
      "Routes user intent to the right specialist agent. Maintains conversation context and chains multi-step workflows across agents.",
    tools: [
      {
        name: "classify_intent",
        description:
          "Analyzes user message to determine which specialist agent should handle the request.",
        parameters: { message: "string", conversationHistory: "Message[]" },
      },
      {
        name: "delegate_to_agent",
        description:
          "Forwards the request to the identified specialist agent with relevant context.",
        parameters: { agentType: "AgentType", payload: "object" },
      },
      {
        name: "merge_responses",
        description:
          "Combines outputs from multiple agents into a single coherent response when a request spans domains.",
        parameters: { responses: "AgentResponse[]" },
      },
      {
        name: "request_clarification",
        description:
          "Asks the user a follow-up question when intent is ambiguous.",
        parameters: { options: "string[]", originalMessage: "string" },
      },
    ],
    guardrails: [
      {
        id: "orch-no-direct-action",
        description:
          "Orchestrator must never modify documents or user data directly; it only routes.",
        enforcement: "block",
      },
      {
        id: "orch-single-owner",
        description:
          "Each sub-task is delegated to exactly one specialist agent. No duplicate delegation.",
        enforcement: "block",
      },
      {
        id: "orch-context-limit",
        description:
          "Conversation context passed to sub-agents is trimmed to the last 20 messages to avoid token overflow.",
        enforcement: "warn",
      },
    ],
  },

  // ---- DOCUMENT SCANNER ---------------------------------------------------
  scanner: {
    type: "scanner",
    name: "Document Scanner",
    description:
      "Ingests uploaded documents (photos, PDFs, emails). Extracts key data: document type, parties, dates, coverage amounts, expiration, renewal terms. OCR + NLP.",
    tools: [
      {
        name: "ocr_extract",
        description:
          "Runs OCR on an uploaded image or scanned PDF and returns raw text.",
        parameters: { fileId: "string", mimeType: "string" },
      },
      {
        name: "parse_pdf",
        description:
          "Parses a digital PDF into structured text blocks with page numbers.",
        parameters: { fileId: "string" },
      },
      {
        name: "extract_fields",
        description:
          "Uses NLP to pull structured fields from raw text: document type, parties, effective date, expiration date, coverage amounts, renewal terms, premium.",
        parameters: { rawText: "string", documentHint: "string | undefined" },
      },
      {
        name: "parse_email",
        description:
          "Extracts policy-relevant data from a forwarded email (sender, subject, attachments, inline policy references).",
        parameters: { emailContent: "string", attachments: "FileRef[]" },
      },
      {
        name: "confidence_check",
        description:
          "Returns a confidence score for each extracted field. Fields below threshold are flagged for user review.",
        parameters: { extractedFields: "Record<string, unknown>", threshold: "number" },
      },
    ],
    guardrails: [
      {
        id: "scan-pii-redact-log",
        description:
          "PII (SSN, bank account numbers) must never appear in logs or error messages. Redact before logging.",
        enforcement: "block",
      },
      {
        id: "scan-max-file-size",
        description:
          "Reject files larger than 50 MB before processing to prevent resource exhaustion.",
        enforcement: "block",
      },
      {
        id: "scan-supported-formats",
        description:
          "Only process PDF, PNG, JPG, HEIC, and EML files. Return a clear error for unsupported formats.",
        enforcement: "block",
      },
      {
        id: "scan-human-review",
        description:
          "Any extracted field with confidence < 0.7 must be flagged for user confirmation before saving.",
        enforcement: "warn",
      },
    ],
  },

  // ---- VAULT ORGANIZER ----------------------------------------------------
  organizer: {
    type: "organizer",
    name: "Vault Organizer",
    description:
      "Categorizes documents into 6 types (Advance Directives, LMNs, Insurance, Care Agreements, Power of Attorney, HIPAA). Auto-tags metadata. Detects duplicates.",
    tools: [
      {
        name: "categorize_document",
        description:
          "Assigns a DocumentCategory based on extracted fields and content analysis.",
        parameters: { extractedFields: "Record<string, unknown>", rawText: "string" },
      },
      {
        name: "auto_tag",
        description:
          "Generates metadata tags: provider name, policy number, covered individuals, state/jurisdiction, document version.",
        parameters: { documentId: "string", extractedFields: "Record<string, unknown>" },
      },
      {
        name: "detect_duplicate",
        description:
          "Compares a new document against existing vault contents using content hash and fuzzy field matching. Returns match candidates.",
        parameters: { documentId: "string", contentHash: "string" },
      },
      {
        name: "merge_versions",
        description:
          "When a newer version of an existing document is detected, archives the old version and promotes the new one as current.",
        parameters: { existingDocId: "string", newDocId: "string" },
      },
      {
        name: "search_vault",
        description:
          "Full-text and metadata search across all vault documents.",
        parameters: { query: "string", filters: "VaultFilters | undefined" },
      },
    ],
    guardrails: [
      {
        id: "org-no-delete",
        description:
          "Organizer can archive but never permanently delete a document. Deletion requires explicit user confirmation via a separate flow.",
        enforcement: "block",
      },
      {
        id: "org-category-required",
        description:
          "Every document must be assigned exactly one primary category before it is saved to the vault.",
        enforcement: "block",
      },
      {
        id: "org-duplicate-confirm",
        description:
          "When a duplicate is detected, present both versions to the user before merging. Never auto-merge silently.",
        enforcement: "warn",
      },
    ],
  },

  // ---- ALERT MONITOR ------------------------------------------------------
  alerts: {
    type: "alerts",
    name: "Alert Monitor",
    description:
      "Tracks expiration dates, renewal windows, premium due dates. Sends proactive notifications. Detects coverage gaps across policies.",
    tools: [
      {
        name: "scan_deadlines",
        description:
          "Scans all vault documents for upcoming expiration dates, renewal windows, and payment due dates. Returns a sorted timeline.",
        parameters: { lookAheadDays: "number" },
      },
      {
        name: "detect_coverage_gaps",
        description:
          "Analyzes date ranges across all active policies to find periods where coverage lapses or overlaps.",
        parameters: { policyIds: "string[]" },
      },
      {
        name: "schedule_notification",
        description:
          "Creates a notification entry for a specific date/time with message content and delivery channel (push, email, SMS).",
        parameters: {
          triggerDate: "string (ISO 8601)",
          message: "string",
          channel: "'push' | 'email' | 'sms'",
        },
      },
      {
        name: "snooze_alert",
        description:
          "Postpones a scheduled alert by a specified duration.",
        parameters: { alertId: "string", snoozeDays: "number" },
      },
      {
        name: "generate_renewal_summary",
        description:
          "Produces a human-readable summary of what is renewing, when, and at what cost for a given time window.",
        parameters: { startDate: "string", endDate: "string" },
      },
    ],
    guardrails: [
      {
        id: "alert-no-spam",
        description:
          "Maximum 3 notifications per document per renewal cycle. Escalate frequency only if user has not acknowledged.",
        enforcement: "warn",
      },
      {
        id: "alert-minimum-lead",
        description:
          "First alert for any deadline must fire at least 30 days before expiration. Critical documents (advance directives) get 90 days.",
        enforcement: "block",
      },
      {
        id: "alert-quiet-hours",
        description:
          "Do not send push or SMS notifications between 10 PM and 7 AM user local time. Email is exempt.",
        enforcement: "block",
      },
    ],
  },

  // ---- COVERAGE ADVISOR ---------------------------------------------------
  advisor: {
    type: "advisor",
    name: "Coverage Advisor",
    description:
      "Analyzes all policies holistically. Identifies overlaps, gaps, under-insurance. Suggests optimization. Compares costs. Estimates savings.",
    tools: [
      {
        name: "holistic_analysis",
        description:
          "Aggregates all active policies and produces a coverage map showing what is covered, by whom, and for how much.",
        parameters: { userId: "string" },
      },
      {
        name: "identify_gaps",
        description:
          "Compares the user's coverage map against recommended minimums for their profile (age, dependents, assets) and flags shortfalls.",
        parameters: { coverageMap: "CoverageMap", userProfile: "UserProfile" },
      },
      {
        name: "identify_overlaps",
        description:
          "Detects duplicate or substantially overlapping coverage across policies and estimates annual waste.",
        parameters: { coverageMap: "CoverageMap" },
      },
      {
        name: "estimate_savings",
        description:
          "Models potential savings from consolidation, switching providers, or adjusting deductibles.",
        parameters: { currentPolicies: "PolicySummary[]", scenario: "OptimizationScenario" },
      },
      {
        name: "generate_recommendations",
        description:
          "Produces ranked, actionable recommendations with estimated impact and effort level.",
        parameters: { gaps: "Gap[]", overlaps: "Overlap[]", savings: "SavingsEstimate" },
      },
    ],
    guardrails: [
      {
        id: "adv-not-licensed",
        description:
          "All recommendations must include a disclaimer: 'This is informational only and does not constitute insurance advice. Consult a licensed agent.' Never claim to be a licensed advisor.",
        enforcement: "block",
      },
      {
        id: "adv-no-affiliate",
        description:
          "Never recommend a specific insurance provider or product by brand name. Present options generically (e.g., 'a term life policy').",
        enforcement: "block",
      },
      {
        id: "adv-data-only",
        description:
          "Recommendations must be grounded in the user's actual policy data. Never fabricate coverage details or costs.",
        enforcement: "block",
      },
      {
        id: "adv-conservative-estimates",
        description:
          "Savings estimates must use conservative assumptions. Show range (low-high) rather than a single optimistic number.",
        enforcement: "warn",
      },
    ],
  },

  // ---- SECURE SHARING -----------------------------------------------------
  sharing: {
    type: "sharing",
    name: "Secure Sharing",
    description:
      "Generates QR codes for document access. Manages who can view what. Emergency access protocols (advance directives available to ER staff). Time-limited sharing links.",
    tools: [
      {
        name: "generate_share_link",
        description:
          "Creates a time-limited, encrypted URL for accessing a specific document or document set. Configurable expiry (1 hour to 30 days).",
        parameters: {
          documentIds: "string[]",
          expiresIn: "number (seconds)",
          recipientEmail: "string | undefined",
        },
      },
      {
        name: "generate_qr_code",
        description:
          "Produces a QR code image (PNG/SVG) encoding a share link for easy mobile scanning.",
        parameters: { shareLink: "string", format: "'png' | 'svg'" },
      },
      {
        name: "manage_access_list",
        description:
          "Adds or removes individuals from a document's access list. Supports role-based access (viewer, editor, emergency).",
        parameters: {
          documentId: "string",
          action: "'add' | 'remove'",
          recipientId: "string",
          role: "'viewer' | 'editor' | 'emergency'",
        },
      },
      {
        name: "configure_emergency_access",
        description:
          "Sets up emergency access protocol for advance directives and medical POA. Allows designated ER contacts to access documents without prior link.",
        parameters: {
          documentIds: "string[]",
          emergencyContacts: "EmergencyContact[]",
          verificationMethod: "'pin' | 'sms' | 'id_verification'",
        },
      },
      {
        name: "revoke_access",
        description:
          "Immediately invalidates a share link or removes a recipient's access. Logs the revocation event.",
        parameters: { shareId: "string", reason: "string" },
      },
    ],
    guardrails: [
      {
        id: "share-max-expiry",
        description:
          "Share links must expire within 30 days maximum. Emergency access links have no expiry but require verification on each access.",
        enforcement: "block",
      },
      {
        id: "share-audit-log",
        description:
          "Every access, share creation, and revocation must be written to an immutable audit log with timestamp, actor, and action.",
        enforcement: "block",
      },
      {
        id: "share-encrypt-at-rest",
        description:
          "Shared document content must be encrypted at rest. Share links encode a decryption token; the server never stores plaintext.",
        enforcement: "block",
      },
      {
        id: "share-verify-emergency",
        description:
          "Emergency access must always require at least one verification step (PIN, SMS code, or ID check) before granting document access.",
        enforcement: "block",
      },
      {
        id: "share-notify-owner",
        description:
          "Document owner receives a notification whenever their document is accessed via a share link or emergency protocol.",
        enforcement: "warn",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

interface IntentClassification {
  agent: AgentType;
  confidence: number;
  reasoning: string;
}

const INTENT_PATTERNS: { pattern: RegExp; agent: AgentType; weight: number }[] = [
  // Scanner
  { pattern: /upload|scan|ingest|import|photo|pdf|document.*add/i, agent: "scanner", weight: 1.0 },
  { pattern: /ocr|extract.*text|read.*document/i, agent: "scanner", weight: 0.9 },

  // Organizer
  { pattern: /categorize|organize|tag|sort|find.*document|search.*vault|duplicate/i, agent: "organizer", weight: 1.0 },
  { pattern: /where.*is|locate|file.*under/i, agent: "organizer", weight: 0.8 },

  // Alerts
  { pattern: /expir|renew|due.*date|deadline|remind|alert|notification|upcoming/i, agent: "alerts", weight: 1.0 },
  { pattern: /when.*does|coverage.*gap|lapse/i, agent: "alerts", weight: 0.9 },

  // Advisor
  { pattern: /recommend|optimize|savings|overlap|gap.*coverage|under.*insured|compare|analysis/i, agent: "advisor", weight: 1.0 },
  { pattern: /should.*i|better.*plan|consolidat/i, agent: "advisor", weight: 0.8 },

  // Sharing
  { pattern: /share|qr.*code|send.*to|access.*link|emergency.*access|revoke/i, agent: "sharing", weight: 1.0 },
  { pattern: /who.*can.*see|permission|give.*access/i, agent: "sharing", weight: 0.9 },
];

export function routeToAgent(message: string): IntentClassification {
  const scores: Partial<Record<AgentType, number>> = {};

  for (const { pattern, agent, weight } of INTENT_PATTERNS) {
    if (pattern.test(message)) {
      scores[agent] = (scores[agent] ?? 0) + weight;
    }
  }

  const entries = Object.entries(scores) as [AgentType, number][];

  if (entries.length === 0) {
    return {
      agent: "orchestrator",
      confidence: 0.3,
      reasoning: "No strong intent signal detected. Routing to orchestrator for clarification.",
    };
  }

  entries.sort((a, b) => b[1] - a[1]);
  const [topAgent, topScore] = entries[0];
  const totalScore = entries.reduce((sum, [, s]) => sum + s, 0);
  const confidence = Math.min(topScore / Math.max(totalScore, 1), 1.0);

  // If confidence is too low or two agents are tied, use orchestrator
  if (confidence < 0.5 || (entries.length > 1 && entries[0][1] === entries[1][1])) {
    return {
      agent: "orchestrator",
      confidence,
      reasoning: `Ambiguous intent across ${entries.map(([a]) => a).join(", ")}. Routing to orchestrator for disambiguation.`,
    };
  }

  return {
    agent: topAgent,
    confidence,
    reasoning: `Matched intent for ${AGENTS[topAgent].name} with confidence ${confidence.toFixed(2)}.`,
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildAgentPrompt(agentType: AgentType, userMessage: string): string {
  const agent = AGENTS[agentType];

  const toolDescriptions = agent.tools
    .map((t) => `  - ${t.name}: ${t.description}`)
    .join("\n");

  const guardrailDescriptions = agent.guardrails
    .map((g) => `  - [${g.enforcement.toUpperCase()}] ${g.description}`)
    .join("\n");

  return `You are the ${agent.name} agent for PolicyApp, a personal policy and document management platform.

Role: ${agent.description}

Available tools:
${toolDescriptions}

Guardrails (you MUST follow these):
${guardrailDescriptions}

Instructions:
- Respond in plain language. Be concise and helpful.
- If a request falls outside your domain, say so clearly and suggest which agent can help.
- Never fabricate document contents, coverage details, or dates.
- Protect user privacy at all times.

User message: ${userMessage}`;
}
