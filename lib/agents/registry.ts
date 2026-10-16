export type AgentInfo = {
  // Matches agent_runs.agent_name.
  name: string;
  role: string;
  description: string;
  // Where the agent is used today, if it's built.
  href?: string;
  runnable?: boolean;
  // API route to POST to when running the agent from the UI.
  apiRoute?: string;
  // True for agents that stream NDJSON log events (like Kajol).
  // False/absent means the route returns a plain JSON summary.
  streaming?: boolean;
};

export const AGENTS: AgentInfo[] = [
  {
    name: "Kajol",
    role: "Image Generation",
    description: "Turns not-started designs' prompts into artwork and uploads it to storage, 1 per run.",
    runnable: true,
    streaming: true,
    apiRoute: "/api/agents/kajol",
  },
  {
    name: "Rani",
    role: "AI CEO",
    description: "Runs creative operations: status, priorities, and direction for the team.",
    href: "/rani",
  },
  {
    name: "Deepika",
    role: "Publishing",
    description: "Batch-publishes approved designs to Gelato. Runs up to 10 per batch.",
    runnable: true,
    apiRoute: "/api/agents/deepika",
  },
  {
    name: "Bipasha",
    role: "Lifestyle Mockups",
    description: "Uses gpt-image-1 to composite designs onto cultural lifestyle scenes (temple, Diwali, etc).",
    runnable: true,
    apiRoute: "/api/agents/mockup",
  },
  {
    name: "Disha",
    role: "Social Media",
    description: "Generates Instagram, TikTok, and Pinterest captions + hashtags and a content calendar.",
    runnable: true,
    apiRoute: "/api/agents/disha",
  },
  {
    name: "Aisha",
    role: "Content Writing",
    description: "Writes product descriptions (seo_description) and SEO blog posts saved to the blog_posts table in Supabase.",
    runnable: true,
    apiRoute: "/api/agents/aisha",
  },
  {
    name: "Priya",
    role: "Market Research",
    description: "Researches trending product categories, diaspora occasions, and competitor landscape. Saves reports to research_reports table.",
    runnable: true,
    apiRoute: "/api/agents/priya",
  },
  {
    name: "Vidya",
    role: "Finance",
    description: "Pulls pipeline + order data and produces a financial snapshot report with AI recommendations.",
    runnable: true,
    apiRoute: "/api/agents/vidya",
  },
  {
    name: "Katrina",
    role: "SEO",
    description: "Writes seo_title + seo_description for active assets and regenerates sitemap.xml + robots.txt.",
    runnable: true,
    apiRoute: "/api/agents/katrina",
  },
];
