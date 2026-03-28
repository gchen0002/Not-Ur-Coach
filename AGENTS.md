# Not Ur Coach — Universal Agent Context
> Single source of truth for all AI agents (Claude Code, Codex, Cursor, etc.)
> For full decision rationale see: `docs/final-spec.md` | `docs/viable-options.md` | `docs/gemini-usage.md`
> Skills & rules: `./skills/` folder (shared across all agents) | `skills/convex_rules.txt`

---

## What This App Does
Upload training clip → MediaPipe extracts pose → Gemini analyzes biomechanics → scores + research-backed coaching cues. Hackathon demo: bodyweight squats live at booth, SLDL pre-loaded history.

---

## Stack
| Layer | Choice |
|---|---|
| Frontend | Vite + React 19 + TanStack Router + Tailwind + Material Tailwind (MD3) |
| Backend | Convex — DB, vector search, file storage, real-time, actions |
| Auth | Clerk — `DEMO_MODE=true` during hackathon (skip all auth checks) |
| Pose | MediaPipe Pose Landmarker — Web Worker, self-hosted WASM `/public/mediapipe/` |
| AI Core | `gemini-3-flash-preview` — analysis, chat, exercise gen |
| Embeddings | `gemini-embedding-2` — 768d multimodal (text + images same space) |
| Deploy | Cloudflare Pages |

---

## Gemini SDK (NEW — legacy deprecated)
```bash
npm install @google/genai
```
```typescript
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// DO NOT use @google/generative-ai — it is deprecated
```

---

## Model IDs
```
Analysis/Chat/ExerciseGen:  gemini-3-flash-preview        (1M in / 65K out, multimodal, thinking)
Embeddings:                 gemini-embedding-2             (768d, multimodal)
Live API (Block 10):        gemini-3.1-flash-live-preview  (WebSocket, client-side)
TTS (Block 10):             gemini-2.5-flash-preview-tts
Image Gen (Block 10):       gemini-3-pro-image-preview     (Nano Banana Pro)
                            gemini-3.1-flash-image-preview (Nano Banana 2, fast)
Video (Block 10):           veo-3.1
Music (Block 10):           lyria-3 / lyria-3-clip
⚠️ Confirm IDs in Google AI Studio on build day — preview IDs shift
```

---

## File Structure (key files only)
```
docs/                     reference docs (final-spec, gemini-usage, viable-options, skills)
skills/                   shared agent skills + convex_rules.txt
convex/
  schema.ts               full DB schema
  analyze.ts              core pipeline: pose data + key frames → Gemini → sanity check → store
  embed.ts                Embedding 2 for text + images
  chat.ts                 RAG + Google Search grounding
  generateExercise.ts     auto-create exercise profiles for unknown exercises
  identifyEquipment.ts    Gemini vision: photo → equipment list (Explore page)
  similarity.ts           frame embedding → vector search
  tts.ts                  TTS generation + cache (Block 10)
  generateTempoTrack.ts   Lyria tempo music (Block 10)
  generateReferenceClip.ts Veo ideal form clips (Block 10)
  liveSession.ts          store Live API transcripts (Block 10)
  seed.ts                 15 exercises + equipment seed data

src/
  workers/pose-worker.ts  MediaPipe Web Worker
  routes/explore/          Explore page (exercise library + equipment filter)
  lib/
    angles.ts             joint angle math
    reps.ts               rep detection (Savitzky-Golay + peak/valley on primaryJoints[0])
    tempo.ts              per-rep timing
    symmetry.ts           bilateral balance (sagittal: hip drift + trunk rotation)
    resistance.ts         moment arms (free_weight only for MVP)
    compress.ts           video compression + normalizeVideoOrientation() ← EXIF fix
    keyframes.ts          extract best-confidence frames
    camera-angle.ts       Phase 0: detect sagittal/coronal/angled from landmark geometry
```

---

## Architecture Flow
```
[Browser]
  MediaPipe Web Worker (phases 0-3)
    → pose data (~100KB) + key frames (4 JPEGs ~50KB each) + rep data + camera angle
    → upload key frames to Convex storage

[Convex action: analyze.ts]
  1. Fetch key frames from Convex storage
  2. Upload frames to Gemini Files API → get fileURIs (reusable 48h)
  3. Parallel: vector search researchChunks + last 3 user analyses
  4. Build prompt: angle table + fileURIs + RAG + history + exercise thresholds
  5. Call gemini-3-flash-preview (thinkingBudget: 8000, structured output)
  6. Sanity check → retry once if flagged → store with confidence: high/medium/low
  7. Embed analysis summary + key frames via gemini-embedding-2
  8. Store everything → client real-time subscription updates
```

---

## Scoring System
```typescript
// Per dimension:
deviation = max(0, angle - range_max, range_min - angle)
score = 100 - clamp((deviation / (range_max - range_min)) * 100, 0, 100)

// Sub-score weights:
{ rom: 30%, tensionProfile: 25%, tempo: 20%, symmetry: 15%, fatigueManagement: 10% }

// Overall cap: overall ≤ avg(subScores) + 10
// Nerd mode: tight optimalRange | Basic mode: wide acceptableRange
// repCount < 3 → fatigueManagement = null → redistribute 10% to others
```

---

## Gemini Structured Output Schema
```typescript
AnalysisResponse = {
  overallScore: number,
  subScores: { rom, tensionProfile, tempo, symmetry, fatigueManagement },
  perRepScores: [{ repNumber, scores, flags: string[] }],
  nerdAnalysis: { summary, romBreakdown, tensionAnalysis, tempoAnalysis,
                  fatiguePattern, resistanceProfileAnalysis,
                  researchCitations: [{ paper, finding, doi? }] },
  basicAnalysis: { summary, whatYoureDoingWell: string[], whatToFix: string[] },
  cues: [{ cue, priority: "high"|"medium"|"low", appliesToRep? }],
  risks: string[],
  optimalAngles: { [joint]: { min, max } },
  confidenceNote: string | null,        // Gemini writes this
  confidence: "high"|"medium"|"low",    // sanity checker writes this
  inferredIntent?: "form_check"|"work_set"|"1rm_attempt",  // if sessionIntent was null
}
```

---

## Convex Schema (tables summary)
```
users           clerkId, name, mode: "nerd"|"basic", savedEquipment: equipmentId[]
clips           userId, exercise, resistanceType, cameraAngle, jointConfidence,
                sessionIntent?, status: "processing"|"analyzed"|"failed"
poseData        clipId, landmarkData (compressed JSON), angleTimeSeries
reps            clipId, repNumber, angles (4 positions), tempo, ROM, symmetry,
                momentArms?, peakTensionPosition?
analyses        clipId, userId, scores (5), nerdAnalysis, basicAnalysis, cues, risks,
                confidence, embedding (768d), inferredIntent?
researchChunks  source, sourceType, text?, imageStorageId?, exercises[], muscles[],
                embedding (768d)
clipFrameEmbeddings  clipId, exercise, position, embedding (768d)
exercises       name, primaryJoints[], keyAngleChecks (optimalRange + acceptableRange),
                evidenceLevel, isAiGenerated, requiredEquipment: equipmentId[],
                muscles[], referenceClipStorageId?
equipment       name, aliases[], icon?
messages        userId, clipId?, role, content, groundingMetadata?
```

---

## Key Decisions (locked)
- **One Gemini call** generates BOTH nerd + basic analysis. Mode toggle is pure UI switch.
- **Key frames via Files API** — not base64, not Convex storage URLs
- **Rep detection** — Savitzky-Golay smooth → peak/valley on `exercise.primaryJoints[0]`
- **Resistance MVP** — `free_weight` + `bodyweight` only. Cable/band/machine deferred.
- **Bilateral balance (sagittal)** — hip lateral drift (<3cm=100, ≥10cm=0) + trunk rotation (<5°=100, ≥15°=0)
- **Tempo scoring** — eccentric control (binary ≥1s) × 0.4 + rep consistency (std dev) × 0.4 + concentric intent × 0.2
- **iPhone portrait EXIF** — `normalizeVideoOrientation()` in compress.ts before any canvas ops
- **Phase 0 thresholds** — must be empirically calibrated against real footage (not hardcoded)
- **DEMO_MODE=true** — skip all Clerk auth checks during hackathon
- **Explore page** — top-level nav tab. Browsable exercise library filtered by muscle group (2-level picker) + equipment. Veo reference clips per exercise. Equipment input: photo (Gemini vision) optional, text/checklist fallback. Equipment saved to user profile.
- **Equipment table** — separate `equipment` table with `name` + `aliases[]`. Seeded with ~10 entries for 15 exercises. Grows dynamically.
- **Unknown exercises** — auto-generated via `generateExercise.ts` + Veo clip generation kicked off immediately. Stored permanently with `isAiGenerated: true`, `evidenceLevel: "insufficient"`.
- **One Veo clip per exercise** for hackathon — schema supports multiple (angle, variant) for later.
- **Exercise variants** — primary equipment version only for hackathon. New exercise entries for variants post-hackathon (e.g., "Dumbbell Squat" = separate entry from "Barbell Squat").

---

## 15 Seed Exercises
Squat, RDL, SLDL, Hip Thrust, Leg Press, Leg Curl, Bench Press, Incline Press,
Pull-Up/Lat Pulldown, Row, Overhead Press, Bicep Curl, Tricep Overhead, Lateral Raise, RFESS

Thresholds sourced from: EMG studies (proxy) → length-tension theory → "insufficient evidence" flag
Lateral Raise = intentional insufficient evidence showcase (tracked, not scored)

---

## Build Order
```
Day 0 first: MediaPipe WASM spike (Web Worker loads WASM, processes 1 frame, posts landmarks)
Block 1:  Scaffold (Vite + Convex + Clerk shell + MD3 theme + deploy)
Block 2:  Exercise DB + Research RAG + Explore page
          (seed 15 exercises + equipment table + requiredEquipment tags +
           muscle group picker + equipment checklist UI + ingest 8 papers)
Block 3:  MediaPipe pipeline (phases 0-3, skeleton overlay, live angle display)
Block 4:  In-app camera (live skeleton at 10fps during recording)
Block 5:  Gemini analysis pipeline (analyze.ts, sanity checker, embeddings)
          → Process all SLDL demo clips here, don't wait until Block 9
Block 6:  Results UI (ScoreCard, RepBreakdown, AngleComparison, CueList, ModeToggle)
Block 7:  Progress + similarity (history, charts, vector search)
Block 8:  Chat (RAG + Google Search grounding)
Block 9:  Landing + demo prep (empty states, error handling, mobile pass, rehearsal)
Block 10: Hackathon tracks in priority order:
          TTS (1hr) → Lyria (1.5hr) → Veo (1.5hr) → Live API (3hr) → Nano Banana (1.5hr)
          Veo track includes: generate clips for 15 exercises + attach to Explore page +
          equipment photo recognition (identifyEquipment.ts) + on-demand generation for unknown exercises
```

---

## Pre-Hackathon Checklist
- [ ] Angle thresholds spreadsheet for all 15 exercises (with sources)
- [ ] 8 research paper structured summaries written (300-500 words each, see final-spec.md)
- [ ] Phase 0 calibration: log `|leftHip.x - rightHip.x|` from real SLDL clips
- [ ] SLDL clips collected + permissions confirmed + MOV→MP4 converted if needed
- [ ] Confirm API access: Lyria, Veo available in hackathon environment
- [ ] Pre-generate Veo reference clips for all 15 exercises (slow — minutes per clip)
- [ ] Backup squat clip pre-recorded at correct floor-level sagittal angle
