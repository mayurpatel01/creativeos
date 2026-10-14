export type AgentInfo = {
  // Matches agent_runs.agent_name.
  name: string;
  role: string;
  description: string;
  // Where the agent is used today, if it's built.
  href?: string;
  runnable?: boolean;
};

export const AGENTS: AgentInfo[] = [
  {
    name: "Kajol",
    role: "Image Generation",
    description: "Turns not-started designs' prompts into artwork and uploads it to storage, 1 per run.",
    runnable: true,
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
    description: "Gets approved designs listed and live on sales platforms.",
  },
  {
    name: "Disha",
    role: "Social Media",
    description: "Plans and posts content that promotes the products.",
  },
  {
    name: "Aisha",
    role: "Content Writing",
    description: "Writes product copy, descriptions, and marketing content.",
  },
  {
    name: "Vidya",
    role: "Finance",
    description: "Tracks costs, pricing, and revenue across projects.",
  },
  {
    name: "Katrina",
    role: "SEO",
    description: "Optimizes titles, descriptions, and keywords for search.",
  },
];
