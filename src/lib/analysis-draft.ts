import type {
  AnalysisCue,
  AnalysisDraft,
  AnalysisRunResult,
  AnalysisScores,
  AnalyzePayload,
} from "./analysis-contract";
import { resolveExerciseMovementProfile } from "./exercise-profile";

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: Array<number | null>) {
  const numericValues = values.filter((value): value is number => value !== null);

  if (numericValues.length === 0) {
    return null;
  }

  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
}

function pushCue(cues: AnalysisCue[], cue: string, priority: AnalysisCue["priority"]) {
  if (!cues.some((item) => item.cue === cue)) {
    cues.push({ cue, priority });
  }
}

export function createAnalysisDraft(payload: AnalyzePayload): AnalysisDraft {
  if (payload.decision === "reject") {
    return {
      accepted: false,
      mode: payload.decision,
      confidence: "low",
      summary: "The clip is too incomplete for a trustworthy form analysis.",
      basicAnalysis: {
        summary: "Not enough of the body is visible to score this set reliably.",
        whatYoureDoingWell: [],
        whatToFix: payload.quality.windowIssues.length > 0
          ? payload.quality.windowIssues
          : ["Re-record with the torso, hips, knees, and ankles visible for most of the clip."],
      },
      nerdAnalysis: {
        summary: "The visible data is too incomplete for a useful kinematic breakdown.",
        movementDiagnosis: [],
        kinematicEvidence: [],
        likelyConstraints: payload.quality.windowIssues.slice(0, 3),
        cueRationale: [],
      },
      scores: {
        overall: null,
        rom: null,
        tensionProfile: null,
        tempo: null,
        symmetry: null,
        fatigueManagement: null,
      },
      cues: [],
      risks: ["Analysis rejected because critical joints are missing across too many frames."],
      nextStep: "Ask the user to re-record from farther back with the full lower body in frame.",
    };
  }

  const cues: AnalysisCue[] = [];
  const whatYoureDoingWell: string[] = [];
  const whatToFix: string[] = [];
  const risks: string[] = [];
  const exerciseProfile = resolveExerciseMovementProfile(payload.userContext.exerciseName ?? payload.clipName);
  const primaryMetricValue = payload.repStats.averageBottomPrimaryMetricValue;
  const depthIndicator = exerciseProfile.primaryMetric === "hip_flexion"
    ? primaryMetricValue ?? payload.motionSummary.primaryHip
    : average([payload.motionSummary.primaryKnee, payload.motionSummary.leftKnee, payload.motionSummary.rightKnee]);

  const landmarkCoverageScore = clampScore(payload.frameStats.averageVisibleLandmarks * 3);
  const symmetryGap =
    payload.motionSummary.leftKnee !== null && payload.motionSummary.rightKnee !== null
      ? Math.abs(payload.motionSummary.leftKnee - payload.motionSummary.rightKnee)
      : null;

  const symmetryScore =
    symmetryGap === null ? 60 : clampScore(100 - symmetryGap * 2.5);
  const trunkLeanScore =
    payload.motionSummary.trunkLean === null
      ? 65
      : clampScore(100 - Math.max(0, Math.abs(payload.motionSummary.trunkLean - (exerciseProfile.pattern === "hinge" ? 45 : 35)) * 2.2));
  const romScore =
    depthIndicator === null
      ? 60
      : clampScore(100 - Math.min(45, Math.abs(depthIndicator - exerciseProfile.romIdeal) * 1.4));
  const tensionProfileScore = clampScore((trunkLeanScore * 0.45) + (romScore * 0.25) + (landmarkCoverageScore * 0.3));
  const tempoScore =
    payload.repStats.averageRepDurationMs === null
      ? clampScore(Math.min(85, 45 + payload.frameStats.sampledFrames * 1.5))
      : clampScore(100 - Math.min(35, Math.abs(payload.repStats.averageRepDurationMs - 1800) / 60));
  const fatigueManagementScore =
    payload.repStats.detectedRepCount >= 3
      ? (payload.decision === "best_effort" ? 58 : 74)
      : (payload.decision === "best_effort" ? 50 : 66);
  const overall = clampScore(
    ((romScore * 0.3) +
      (tensionProfileScore * 0.25) +
      (tempoScore * 0.2) +
      (symmetryScore * 0.15) +
      (fatigueManagementScore * 0.1)) * (payload.decision === "best_effort" ? 0.9 : 1),
  );

  if (payload.cameraAngle.label === "sagittal") {
    whatYoureDoingWell.push("The camera setup is close to a useful side view for lower-body form checks.");
  } else if (payload.cameraAngle.label === "coronal") {
    whatYoureDoingWell.push("The clip still captures enough front-view information to estimate symmetry cues.");
  }

  if (payload.frameStats.averageVisibleLandmarks >= 20) {
    whatYoureDoingWell.push("Most frames keep a good portion of the body visible, which supports more stable scoring.");
  }

  if (payload.repStats.detectedRepCount >= 2) {
    whatYoureDoingWell.push(`The pose window captures ${payload.repStats.detectedRepCount} provisional reps, which gives the analysis more movement context.`);
  }

  if (payload.decision === "best_effort") {
    whatToFix.push("This read is lower confidence because the clip is partially cropped or occluded.");
    pushCue(cues, "Re-record from slightly farther back so Gemini can see the full lower body for every rep.", "high");
  }

  if (payload.motionSummary.trunkLean !== null && payload.motionSummary.trunkLean > (exerciseProfile.pattern === "hinge" ? 72 : 55)) {
    whatToFix.push("Your torso angle looks aggressive, which can shift the movement away from the intended pattern.");
    pushCue(cues, exerciseProfile.pattern === "hinge"
      ? "Keep the hinge controlled so the torso angle does not run away faster than the hips travel back."
      : "Try to keep the torso more stacked so the rep does not fold forward early.", "high");
    risks.push("Excess forward trunk angle can make load distribution harder to judge and may increase low-back demand.");
  } else if (payload.motionSummary.trunkLean !== null && payload.motionSummary.trunkLean < (exerciseProfile.pattern === "hinge" ? 20 : 15)) {
    pushCue(cues, "A little more controlled forward torso travel may help you reach the intended bottom position.", "medium");
  }

  if (symmetryGap !== null && symmetryGap > 15) {
    whatToFix.push("Left-right knee behavior looks uneven across the visible frames.");
    pushCue(cues, "Watch for one side dropping or extending faster than the other.", "high");
    risks.push("Asymmetry across visible frames suggests the set may be shifting more load to one side.");
  } else if (symmetryGap !== null && symmetryGap <= 8) {
    whatYoureDoingWell.push("The visible knee angles look relatively balanced side to side.");
  }

  if (depthIndicator !== null && depthIndicator > exerciseProfile.shallowThreshold) {
    whatToFix.push(exerciseProfile.pattern === "hinge"
      ? "The hinge range looks short in the visible frames, so the posterior-chain stretch may be limited."
      : "The movement looks shallow in the visible frames, so range of motion may be limited.");
    pushCue(cues, exerciseProfile.pattern === "hinge"
      ? "If the goal is hamstrings or erectors, reach a deeper hinge without losing control or visibility."
      : "If the goal is a full rep, sit deeper while keeping the same balance and control.", "medium");
  } else if (depthIndicator !== null && depthIndicator <= exerciseProfile.romIdeal) {
    whatYoureDoingWell.push(exerciseProfile.pattern === "hinge"
      ? "The visible frames show a more meaningful hinge depth for posterior-chain work."
      : "You are reaching a deeper knee position in the captured frames.");
  }

  if (payload.repStats.detectedRepCount === 0) {
    whatToFix.push("No clean reps were segmented yet, so this read relies on general motion patterns instead of rep-by-rep evidence.");
  } else if (payload.repStats.averageRepDurationMs !== null && payload.repStats.averageRepDurationMs < 900) {
    pushCue(cues, "Slow the rep down slightly so the bottom position and transition are easier to assess and control.", "medium");
  }

  if (payload.quality.windowIssues.length > 0) {
    for (const issue of payload.quality.windowIssues.slice(0, 2)) {
      whatToFix.push(issue);
    }
  }

  if (cues.length === 0) {
    pushCue(cues, "Keep the same framing and repeat a few clean reps so the analysis can become more specific.", "low");
  }

  const scores: AnalysisScores = {
    overall,
    rom: romScore,
    tensionProfile: tensionProfileScore,
    tempo: tempoScore,
    symmetry: symmetryScore,
    fatigueManagement: fatigueManagementScore,
  };

  return {
    accepted: true,
    mode: payload.decision,
    confidence: payload.confidence,
      summary:
        payload.decision === "best_effort"
          ? "Best-effort analysis generated from a partially usable clip window."
          : "Standard analysis draft generated from the buffered pose window.",
    basicAnalysis: {
      summary:
        payload.decision === "best_effort"
          ? "This draft is useful, but it should be delivered with crop and confidence warnings."
          : "The clip has enough visible data for a normal first-pass technique summary.",
      whatYoureDoingWell,
      whatToFix,
    },
    nerdAnalysis: {
      summary: exerciseProfile.pattern === "hinge"
        ? "Posterior-chain pattern quality is being estimated from the visible hinge depth, trunk angle, and clip quality window."
        : "Lower-body pattern quality is being estimated from visible joint depth, trunk position, and clip quality window.",
      movementDiagnosis: [
        `Primary metric: ${payload.repStats.primaryMetric}`,
        payload.cameraAngle.label === "sagittal"
          ? "Camera angle is close to a useful side view."
          : `Camera angle currently reads as ${payload.cameraAngle.label}.`,
      ],
      kinematicEvidence: [
        payload.motionSummary.trunkLean !== null ? `Trunk lean: ${payload.motionSummary.trunkLean}deg.` : "Trunk lean unavailable.",
        payload.repStats.averageBottomPrimaryMetricValue !== null
          ? `Bottom ${payload.repStats.primaryMetric}: ${payload.repStats.averageBottomPrimaryMetricValue}deg.`
          : `Bottom ${payload.repStats.primaryMetric} could not be stabilized from the visible reps.`,
      ],
      likelyConstraints: payload.quality.windowIssues.slice(0, 3),
      cueRationale: cues.slice(0, 3).map((cue) => cue.cue),
    },
    scores,
    cues,
    risks,
    nextStep:
      payload.decision === "best_effort"
        ? "Send to Gemini with explicit lower-confidence instructions and visible-joint caveats."
        : "Send to Gemini with standard scoring instructions and use this draft as a fallback baseline.",
  };
}

export function createLocalAnalysisRun(payload: AnalyzePayload): AnalysisRunResult {
  const fallbackDraft = createAnalysisDraft(payload);

  return {
    accepted: fallbackDraft.accepted,
    mode: fallbackDraft.mode,
    confidence: fallbackDraft.confidence,
    summary: fallbackDraft.summary,
    nextStep: fallbackDraft.nextStep,
    provider: "local",
    geminiError: null,
    draft: fallbackDraft,
    fallbackDraft,
    payload,
  };
}
