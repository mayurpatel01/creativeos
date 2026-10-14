import { getSupabaseAdmin } from "../lib/supabase.ts";

const GODS: Record<string, { name: string; description: string }> = {
  GANESH: {
    name: "Ganesh",
    description:
      "Lord Ganesh, the elephant-headed god with four arms, holding a modak and an axe, seated gracefully on a lotus",
  },
  SHIVA: {
    name: "Shiva",
    description:
      "Lord Shiva in meditation, with a crescent moon and the river Ganga in his matted hair, a serpent around his neck, and his trident at his side",
  },
  HANUMAN: {
    name: "Hanuman",
    description:
      "Lord Hanuman, the mighty monkey god, in a powerful heroic pose holding his golden mace",
  },
  KRISHNA: {
    name: "Krishna",
    description:
      "Lord Krishna with blue skin and a peacock feather in his crown, playing his flute",
  },
  LAKSHMI: {
    name: "Lakshmi",
    description:
      "Goddess Lakshmi seated on a pink lotus, holding lotus flowers, with gold coins flowing from her hand",
  },
  DURGA: {
    name: "Durga",
    description:
      "Goddess Durga riding a lion, with multiple arms each holding a divine weapon, fierce and radiant",
  },
  OM: {
    name: "Om",
    description:
      "a bold, glowing Om symbol at the center of a sacred lotus mandala",
  },
};

const COUNTRIES: Record<string, string> = {
  IND: "India",
  GUY: "Guyana",
  TRI: "Trinidad and Tobago",
  FIJ: "Fiji",
  MAU: "Mauritius",
  CAN: "Canada",
  UK: "United Kingdom",
  AUS: "Australia",
  SUR: "Suriname",
  RSA: "South Africa",
};

const supabase = getSupabaseAdmin();

const SIZES = ["FULL", "CHEST"] as const;

function buildPrompt(godDescription: string, country: string): string {
  return `T-shirt graphic art of ${godDescription}. The design seamlessly incorporates both the American flag and the ${country} flag — flag colors, patterns, and elements woven into the deity's clothing, mandala halo, and background. Airbrush illustration style, vibrant colors, transparent background, no text, print ready.`;
}

async function getId(
  table: "projects" | "collections",
  slug: string,
): Promise<string> {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("slug", slug)
    .single();
  if (error || !data) {
    throw new Error(`Could not find ${table} row with slug '${slug}': ${error?.message}`);
  }
  return data.id;
}

const projectId = await getId("projects", "hindu-tees");
const collectionId = await getId("collections", "flag-combos");

const rows = Object.entries(GODS).flatMap(([godCode, god]) =>
  Object.entries(COUNTRIES).flatMap(([countryCode, country]) =>
    SIZES.map((size) => ({
      project_id: projectId,
      collection_id: collectionId,
      name: `${god.name} × USA-${country} Flag Combo (${size === "FULL" ? "Full" : "Chest"})`,
      type: "illustration",
      style: "flag_combo",
      status: "not_started",
      god: godCode,
      country: countryCode,
      size_variant: size,
      subject: god.name,
      suggested_filename: `${godCode}_USA-${countryCode}_${size}_v1.png`,
      dalle_prompt: buildPrompt(god.description, country),
      tags: [god.name.toLowerCase(), "usa", country.toLowerCase(), "flag-combo", size.toLowerCase()],
      keywords: [god.name, "Hindu", "USA", country, "flag", "t-shirt"],
      brand_visibility: [],
      metadata: {},
    })),
  ),
);

// Skip designs already seeded so the script is safe to re-run.
const { data: existing, error: existingError } = await supabase
  .from("assets")
  .select("suggested_filename")
  .eq("collection_id", collectionId)
  .in("suggested_filename", rows.map((r) => r.suggested_filename));
if (existingError) throw existingError;

const seeded = new Set(existing.map((r) => r.suggested_filename));
const toInsert = rows.filter((r) => !seeded.has(r.suggested_filename));

if (toInsert.length === 0) {
  console.log(`All ${rows.length} flag combo designs already exist. Nothing to insert.`);
} else {
  const { error } = await supabase.from("assets").insert(toInsert);
  if (error) throw error;
  console.log(
    `Inserted ${toInsert.length} assets (${seeded.size} already existed, ${rows.length} total).`,
  );
}
