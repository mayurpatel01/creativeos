/**
 * Generate DALL-E 3 illustrated avatars for all 9 agents.
 * Run once from your local machine (needs OPENAI_API_KEY in .env.local):
 *
 *   node --env-file=.env.local scripts/gen-avatars.mjs
 *
 * Outputs PNG files to public/agents/<name>.png
 * Skip already-generated files (safe to re-run).
 */

import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../public/agents");
fs.mkdirSync(OUT, { recursive: true });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AGENTS = [
  {
    name: "Kajol",
    prompt: "Stylized flat-color illustrated portrait of a South Asian woman artist named Kajol. Creative, expressive energy. Paintbrush motif. Warm terracotta and gold color palette. Goddess aesthetic. Circular frame. Soft inner glow. Clean dark gradient background. No text. Square canvas.",
  },
  {
    name: "Rani",
    prompt: "Stylized flat-color illustrated portrait of a South Asian queen and CEO named Rani. Regal, commanding presence. Small crown motif. Deep burgundy and gold color palette. Goddess aesthetic. Circular frame. Soft inner glow. Clean dark gradient background. No text. Square canvas.",
  },
  {
    name: "Deepika",
    prompt: "Stylized flat-color illustrated portrait of a South Asian publishing executive named Deepika. Confident, professional energy. Open book motif. Sapphire blue and gold color palette. Goddess aesthetic. Circular frame. Soft inner glow. Clean dark gradient background. No text. Square canvas.",
  },
  {
    name: "Bipasha",
    prompt: "Stylized flat-color illustrated portrait of a South Asian lifestyle photographer named Bipasha. Warm, observant expression. Camera lens motif. Warm amber and terracotta color palette. Goddess aesthetic. Circular frame. Soft inner glow. Clean dark gradient background. No text. Square canvas.",
  },
  {
    name: "Disha",
    prompt: "Stylized flat-color illustrated portrait of a South Asian social media strategist named Disha. Energetic, vibrant personality. Lotus and network motif. Coral and gold color palette. Goddess aesthetic. Circular frame. Soft inner glow. Clean dark gradient background. No text. Square canvas.",
  },
  {
    name: "Aisha",
    prompt: "Stylized flat-color illustrated portrait of a South Asian writer and poet named Aisha. Thoughtful, literary expression. Quill and scroll motif. Sage green and warm gold color palette. Goddess aesthetic. Circular frame. Soft inner glow. Clean dark gradient background. No text. Square canvas.",
  },
  {
    name: "Priya",
    prompt: "Stylized flat-color illustrated portrait of a South Asian market research analyst named Priya. Analytical, insightful expression. Compass and rising chart motif. Ocean teal and gold color palette. Goddess aesthetic. Circular frame. Soft inner glow. Clean dark gradient background. No text. Square canvas.",
  },
  {
    name: "Vidya",
    prompt: "Stylized flat-color illustrated portrait of a South Asian finance CFO named Vidya. Precise, trustworthy expression. Balance scales and coin motif. Deep emerald and gold color palette. Goddess aesthetic. Circular frame. Soft inner glow. Clean dark gradient background. No text. Square canvas.",
  },
  {
    name: "Katrina",
    prompt: "Stylized flat-color illustrated portrait of a South Asian SEO strategist named Katrina. Sharp, perceptive expression. Magnifying glass and star motif. Violet and gold color palette. Goddess aesthetic. Circular frame. Soft inner glow. Clean dark gradient background. No text. Square canvas.",
  },
];

for (const agent of AGENTS) {
  const outPath = path.join(OUT, `${agent.name.toLowerCase()}.png`);
  if (fs.existsSync(outPath)) {
    console.log(`✓ skip ${agent.name} (already exists)`);
    continue;
  }
  try {
    process.stdout.write(`Generating ${agent.name}... `);
    const res = await openai.images.generate({
      model: "gpt-image-1",
      prompt: agent.prompt,
      size: "1024x1024",
      quality: "high",
      n: 1,
    });
    const b64 = res.data[0].b64_json;
    if (!b64) throw new Error("No b64_json in response");
    fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    console.log(`✓ saved to public/agents/${agent.name.toLowerCase()}.png`);
    // Brief pause between calls
    await new Promise(r => setTimeout(r, 2_000));
  } catch (err) {
    console.error(`\n✗ ${agent.name}:`, err.message);
  }
}
console.log("\nDone. Commit the new files in public/agents/ and push.");
