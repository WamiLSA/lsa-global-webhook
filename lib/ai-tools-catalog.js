const AI_TOOLS_CATALOG = [
  {
    key: "writing_assistant",
    title: "AI Writing Assistant",
    description: "Draft professional replies, follow-ups, proposals, and internal admin communication.",
    status: "functional",
    integrations: ["inbox", "settings"],
    route: "/inbox"
  },
  {
    key: "translation_assistant",
    title: "AI Translation Assistant",
    description: "Support multilingual internal drafting and adaptation for staff-safe delivery.",
    status: "functional",
    integrations: ["inbox"],
    route: "/inbox"
  },
  {
    key: "summarizer",
    title: "AI Summarizer",
    description: "Summarize inbox threads, provider submissions, and long internal notes.",
    status: "functional",
    integrations: ["inbox", "providers", "kb"],
    route: "/reports"
  },
  {
    key: "knowledge_formatter",
    title: "AI Knowledge Formatter",
    description: "Convert raw capture text into KB-ready structure with title, keywords, and answer format.",
    status: "functional",
    integrations: ["kb", "capture"],
    route: "/kb"
  },
  {
    key: "provider_extractor",
    title: "AI Provider Extractor",
    description: "Extract and normalize provider profile fields from pasted or uploaded source material.",
    status: "functional",
    integrations: ["providers"],
    route: "/providers"
  },
  {
    key: "duplicate_similarity",
    title: "AI Duplicate/Similarity Assistant",
    description: "Flag likely duplicates and related entities across providers and knowledge entries.",
    status: "functional",
    integrations: ["providers", "kb"],
    route: "/providers"
  },
  {
    key: "matching_assistant",
    title: "AI Matching Assistant",
    description: "Support provider-job matching, request interpretation, and service-fit ranking logic.",
    status: "functional",
    integrations: ["providers", "reports"],
    route: "/providers"
  },
  {
    key: "retrieval_test_lab",
    title: "AI Retrieval Test Lab",
    description: "Controlled test environment for retrieval behavior, entity detection, and extraction shaping.",
    status: "functional",
    integrations: ["inbox", "reports"],
    route: "/reports"
  },
  {
    key: "prompt_studio",
    title: "AI Prompt Studio",
    description: "Manage and test reusable internal prompt templates for future LSA instruction sets.",
    status: "scaffolded",
    integrations: ["ai-tools"],
    route: "/ai-tools"
  },
  {
    key: "insights_recommendations",
    title: "AI Insights / Recommendations",
    description: "Surface operational patterns, demand signals, and internal next-step recommendations.",
    status: "functional",
    integrations: ["reports", "inbox", "providers", "kb"],
    route: "/reports"
  }
];

module.exports = { AI_TOOLS_CATALOG };
