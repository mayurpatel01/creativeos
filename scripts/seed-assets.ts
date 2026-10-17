import { getSupabaseAdmin } from "../lib/supabase.ts";

function makeSlug(...parts: (string | number | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

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
  GBR: "United Kingdom",
  AUS: "Australia",
  SUR: "Suriname",
  RSA: "South Africa",
  TZA: "Tanzania",
  KEN: "Kenya",
  ZMB: "Zambia",
  NZL: "New Zealand",
  NLD: "Netherlands",
  MEX: "Mexico",
};

// Optional flag details added to the prompt for newly inserted designs. Existing
// designs keep the prompts they were seeded with (the original 10 had none).
const FLAG_DESCRIPTIONS: Record<string, string> = {
  GBR: "red, white and blue Union Jack",
  CAN: "red and white with a maple leaf",
  SUR: "green, white and red horizontal stripes with a yellow star",
  TZA: "green, yellow and black diagonal stripe with blue triangles",
  KEN: "black, red and green horizontal stripes with a Maasai shield and spears",
  ZMB: "green with red, black and orange vertical stripes and an eagle",
  NZL: "blue with the Union Jack and four red Southern Cross stars",
  NLD: "red, white and blue horizontal stripes",
  MEX: "green, white and red vertical stripes with an eagle and serpent emblem",
};

// design_number has no database default; new designs continue from the highest.
const FIRST_DESIGN_NUMBER = 1001;

const supabase = getSupabaseAdmin();

const SIZES = ["FULL", "CHEST"] as const;

function buildPrompt(godDescription: string, country: string, flagDescription?: string): string {
  const flag = flagDescription ? `${country} flag (${flagDescription})` : `${country} flag`;
  return `T-shirt graphic art of ${godDescription}. The design seamlessly incorporates both the American flag and the ${flag} — flag colors, patterns, and elements woven into the deity's clothing, mandala halo, and background. Airbrush illustration style, vibrant colors, transparent background, no text, print ready.`;
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
      dalle_prompt: buildPrompt(god.description, country, FLAG_DESCRIPTIONS[countryCode]),
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

// Number new designs after the highest existing one, in god → country → size order.
const { data: highest, error: highestError } = await supabase
  .from("assets")
  .select("design_number")
  .eq("project_id", projectId)
  .not("design_number", "is", null)
  .order("design_number", { ascending: false })
  .limit(1)
  .maybeSingle();
if (highestError) throw highestError;

let nextNumber = (highest?.design_number ?? FIRST_DESIGN_NUMBER - 1) + 1;
const toInsert = rows
  .filter((r) => !seeded.has(r.suggested_filename))
  .map((r) => {
    const num = nextNumber++;
    return {
      ...r,
      design_number: num,
      slug: makeSlug(r.god, r.country, r.size_variant, num),
    };
  });

if (toInsert.length === 0) {
  console.log(`All ${rows.length} flag combo designs already exist. Nothing to insert.`);
} else {
  const { error } = await supabase.from("assets").insert(toInsert);
  if (error) throw error;
  console.log(
    `Inserted ${toInsert.length} assets #${toInsert[0].design_number}–#${toInsert.at(-1)!.design_number} ` +
      `(${seeded.size} already existed, ${rows.length} total).`,
  );
}
