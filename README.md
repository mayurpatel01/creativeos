This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment variables

Set these in `.env.local`:

| Variable | Used by |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client (browser and server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser uploads from the designer portal |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin client (never exposed to the browser) |
| `ADMIN_KEY` | Admin login, `/api/agents/*` routes |
| `OPENAI_API_KEY` | Kajol image generation agent |
| `CLIPDROP_API_KEY` | Kajol background removal via Clipdrop (optional; without it images stay on white). Get a key at https://clipdrop.co/apis |
| `ANTHROPIC_API_KEY` | Rani chat (`/rani`) |
| `GELATO_API_KEY` | Gelato product creation |
| `GELATO_STORE_ID` | Gelato store that products are created in |
| `GELATO_TEMPLATE_ID_FULL` | Gelato template for FULL (full-front) designs. Falls back to the original template if unset |
| `GELATO_TEMPLATE_ID_CHEST` | Gelato template for CHEST designs. Required to send CHEST designs to Gelato |

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
