import type { ReferenceClipRequest, ReferenceClipResult } from "./reference-clip-contract";

function joinList(items: string[]) {
  return items.length > 0 ? items.join(", ") : "bodyweight";
}

export function createReferenceClipDraft(request: ReferenceClipRequest): ReferenceClipResult {
  const equipmentLabel = joinList(request.equipment);
  const musclesLabel = joinList(request.muscles);
  const title = `${request.exercise} reference clip`;
  const summary = `A clean ${request.cameraAngle} demo clip showing ideal ${request.variant} ${request.exercise.toLowerCase()} execution for booth playback and Explore-page reference.`;

  return {
    provider: "heuristic",
    status: "prompt_ready",
    title,
    summary,
    visualDirection: [
      "bright training-floor lighting with clear subject separation",
      "single athlete performing technically crisp repetitions with no distractions",
      "camera locked off at hip height with steady framing and neutral gym background",
    ],
    shotPlan: [
      {
        label: "Setup",
        durationSeconds: 2,
        description: `Athlete stands in starting position with ${equipmentLabel}, full body visible from a ${request.cameraAngle} view.`,
      },
      {
        label: "Rep one",
        durationSeconds: 4,
        description: `Show one slow perfect rep emphasizing ${musclesLabel} mechanics and smooth eccentric control.`,
      },
      {
        label: "Rep two",
        durationSeconds: 4,
        description: "Show a second perfect rep with consistent tempo and no camera movement.",
      },
    ],
    veoPrompt: [
      `Create a polished coaching reference video for ${request.exercise}.`,
      `Variant: ${request.variant}.`,
      `Equipment: ${equipmentLabel}.`,
      `Primary muscles: ${musclesLabel}.`,
      `Camera angle: ${request.cameraAngle}.`,
      "Show one athlete performing 2 technically ideal repetitions.",
      "Full body visible at all times, locked camera, realistic gym environment, clean lighting, no text overlays, no watermarks.",
      "Movement should look deliberate, research-demo ready, and easy for users to compare against their own clip.",
      request.notes ? `Extra notes: ${request.notes}` : "",
    ].filter(Boolean).join(" "),
    negativePrompt: "no shaky camera, no extra people, no cropped joints, no dramatic cinematic motion, no text, no logos, no unrealistic anatomy, no poor exercise form",
    aspectRatio: "16:9",
    durationSeconds: 8,
    error: null,
  };
}
