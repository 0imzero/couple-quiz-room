# Couple Quiz Web App Design

## Goal

Build a polished bilingual-ready Chinese couple questionnaire web app for two partners. Each room has two sides, `male` and `female`, with nicknames, live shared answers, editable notes, compact section scoring, and an AI-generated full evaluation through a server-side Netlify Function.

## Architecture

- Frontend: Vite + React + TypeScript.
- Deployment: Netlify static build with `dist` publish output and SPA fallback.
- Data sync: Supabase tables for rooms, participants, answers, and reports. Browser uses only public Supabase URL and anon key.
- AI analysis: `netlify/functions/analyze.ts` calls an OpenAI-compatible provider endpoint for DeepSeek or Qwen. API keys stay in Netlify environment variables.
- Local preview: if Supabase variables are missing, the app falls back to browser localStorage so the UI can still be reviewed.

## Data Model

- `couple_rooms`: random short room code.
- `couple_participants`: one participant per room side.
- `couple_answers`: one answer per participant and question, with a five-level value and optional note.
- `couple_reports`: optional cached AI report content.

Because the app has no account login, privacy relies on unguessable room codes. The schema includes permissive anon policies for simple setup; a production version can tighten this with auth or room secrets.

## User Flow

1. User creates or joins a room with a room code.
2. User chooses side and enters a nickname.
3. The question workspace shows five sections and 50 questions.
4. Each question has a five-step slider from complete no to complete yes.
5. The note button expands an editable note field under the question.
6. Scores update immediately. With Supabase configured, partner updates appear through realtime subscriptions.
7. The final view shows compact section scores and can request a full AI evaluation.

## UI Direction

The interface should feel like a shared relationship notebook rather than a survey form: soft paper base, ink-like headings, colored section rails, tactile sliders, and a side-by-side status panel for both partners. The distinctive element is a "two ribbons" progress strip that shows both sides' completion across the five sections.

## Error Handling

- Missing Supabase env: show local preview mode notice.
- Invalid room code: show a direct join error.
- Side already used: allow updating that side's nickname for lightweight recovery.
- AI key missing: return a deterministic local compatibility summary instead of failing.
- API failure: show the provider error and keep local score results visible.

## Testing

Run `npm run build` after dependencies are installed. Manual verification should cover creating a room, joining with code, editing an answer and note, switching sections, and generating an AI report with and without provider keys.
