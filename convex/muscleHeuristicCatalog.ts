export type MuscleHeuristicEntry = {
  targetMuscle: string;
  muscleRegion?: string;
  aliases: string[];
  movementPatterns: string[];
  primaryJoints: string[];
  primaryJointActions: string[];
  lineOfForceTags: string[];
  whyItMatters: string;
  mechanicalTensionSummary: string;
  sarcomerogenesisSummary: string;
  evidenceLevel: "best-supported" | "likely superior" | "plausible bias" | "insufficient evidence" | "moderate";
  keyHeuristics: Array<Record<string, unknown>>;
  researchChunks: Array<{
    source: string;
    sourceType: "paper_summary";
    exercises: string[];
    muscles: string[];
    text: string;
  }>;
};

export const RESEARCH_FRAMEWORK = {
  name: "hypertrophy-inference-v1",
  mechanicalTensionPrinciples: [
    {
      title: "Mechanical tension is the main hypertrophy-relevant signal",
      summary:
        "Current reviews place load-induced mechanical tension ahead of pump-centric or metabolite-centric explanations when selecting exercises for hypertrophy.",
      application:
        "Prioritize metadata that estimates where and how an exercise loads a muscle: joint angle, torque curve, stability, loaded range, and how repeatably the target can be trained hard.",
      evidenceSource: "Van Every et al. 2025; Lawson et al. 2022",
    },
    {
      title: "Long-length loading often improves the hypertrophy signal",
      summary:
        "Human evidence increasingly suggests exercises or ROMs that challenge the target muscle at longer lengths often match or outperform shorter-length loading, though results remain muscle- and protocol-specific.",
      application:
        "Store whether an exercise is meaningfully challenging in the stretched position instead of treating ROM size alone as the key variable.",
      evidenceSource: "Warneke et al. 2023; Wolf et al. 2025",
    },
    {
      title: "Effort and exercise stability still matter",
      summary:
        "An exercise with strong biomechanics is less useful if balance, skill, grip, or systemic fatigue limits local tension before the target muscle is trained hard.",
      application:
        "Keep fields for stability demand, skill constraint, and whether failure is likely local-muscular versus limited elsewhere.",
      evidenceSource: "Recent human hypertrophy mechanism reviews, 2025 synthesis",
    },
  ],
  sarcomerogenesisPrinciples: [
    {
      title: "Fascicle-length change is a proxy, not proof",
      summary:
        "In humans, longitudinal growth is usually inferred from fascicle-length changes, which are useful but not the same as directly proving serial sarcomere addition.",
      application:
        "If the app uses sarcomerogenesis logic, mark it as proxy-based and lower confidence than direct hypertrophy evidence.",
      evidenceSource: "Wolf et al. 2025",
    },
    {
      title: "Long-length high-force loading is more defensible than eccentric-only claims",
      summary:
        "The best current summary is that long-length loading with meaningful force is a more credible driver of longitudinal adaptation than simply labeling a rep eccentric.",
      application:
        "Reward exercises that are hardest when the target is long, not just exercises with slow negatives.",
      evidenceSource: "Blazevich et al. 2025; Pedrosa et al. 2026",
    },
    {
      title: "Hamstrings have the strongest architecture evidence",
      summary:
        "Hamstrings are better supported than most muscles for fascicle-length adaptation claims, so do not generalize hamstring architecture findings equally to delts, pecs, or triceps.",
      application:
        "Use muscle-specific confidence weighting for any longitudinal-growth inference.",
      evidenceSource: "Pecci et al. 2026; Maeo et al. 2021-2024",
    },
  ],
  caveats: [
    "Direct human evidence for serial sarcomere addition is sparse; most app-usable evidence relies on fascicle-length and regional-hypertrophy proxies.",
    "Long-length studies are often small, short, and use single-joint exercises, so generalization to all gym movements is limited.",
    "Biomechanical plausibility alone is not enough; unstable or skill-limited exercises can underperform despite favorable moment-arm logic.",
  ],
  recommendedFields: [
    "targetMuscles",
    "primaryJointActions",
    "loadedLengthExposure",
    "peakTensionRegion",
    "challengingAtLongLength",
    "resistanceProfile",
    "stabilityDemand",
    "skillConstraint",
    "localFailureLikelihood",
    "fascicleLengthProxyPotential",
  ],
};

export const MUSCLE_HEURISTIC_CATALOG: MuscleHeuristicEntry[] = [
  {
    targetMuscle: "Quadriceps",
    muscleRegion: "Vasti > rectus femoris in many squat patterns",
    aliases: ["quads", "vasti", "front thigh", "knee extensors"],
    movementPatterns: ["squat", "split squat", "lunge", "leg press", "leg extension"],
    primaryJoints: ["knee", "hip", "ankle"],
    primaryJointActions: ["knee extension"],
    lineOfForceTags: ["vertical", "machine_path", "angled"],
    whyItMatters:
      "Quadriceps-friendly setup usually means creating substantial knee-extensor demand while the knee is fairly flexed. Direct squat ROM studies support deeper knee flexion better than top-end partials for front-thigh growth.",
    mechanicalTensionSummary:
      "The strongest signal is high knee-extensor torque in deeper knee flexion, especially when external torque is still meaningful near the bottom.",
    sarcomerogenesisSummary:
      "There is no strong quadriceps-specific human proof of serial sarcomere addition from standard hypertrophy training. Longer-length loading is useful, but the structural mechanism remains unresolved.",
    evidenceLevel: "moderate",
    keyHeuristics: [
      {
        metric: "bottomKneeFlexionDeg",
        optimalRange: { min: 100, max: 130 },
        acceptableRange: { min: 80, max: 140 },
        why: "Deeper knee flexion is the clearest pose-level sign that quads are being challenged at longer lengths instead of only near lockout.",
        evidenceSource: "Bloomquist et al. 2013; Kubo et al. 2019; Kassiano et al. 2023",
      },
      {
        metric: "kneeTravelRelativeToToes",
        target: "allow forward knee travel when pain-free and controlled",
        why: "More forward knee travel usually increases knee-extensor moment and helps keep a squat or split squat quad-friendly.",
        evidenceSource: "Biomechanics support; indirect hypertrophy inference",
      },
      {
        metric: "torsoLeanDegFromVertical",
        optimalRange: { min: 10, max: 35 },
        acceptableRange: { min: 0, max: 45 },
        why: "A relatively upright torso often preserves knee demand better than a very hip-dominant strategy.",
        evidenceSource: "Biomechanics layered onto squat ROM trials",
      },
      {
        metric: "peakTensionRegion",
        target: "bottom-half or full-ROM tension, not top-half partials only",
        why: "Top-half knee-dominant partials miss the position most associated with stronger quad hypertrophy signals in direct ROM studies.",
        evidenceSource: "Bloomquist et al. 2013; Kassiano et al. 2023",
      },
    ],
    researchChunks: [
      {
        source: "Bloomquist et al. 2013 - deep vs shallow squat quads",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Quadriceps"],
        text: "Title: Effect of range of motion in heavy load squatting on muscle and tendon adaptations. Year: 2013. DOI: 10.1007/s00421-013-2642-7. PMID: 23604798. Deep squats to about 120 degrees knee flexion produced superior front-thigh growth compared with shallow squats to about 60 degrees. Limitation: loaded squat intervention in young men, not every quad exercise.",
      },
      {
        source: "Kubo et al. 2019 - full vs half squat hypertrophy",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Quadriceps", "Gluteus Maximus"],
        text: "Title: Effects of squat training with different depths on lower limb muscle volumes. Year: 2019. Full and half squats both increased knee extensor volume, but only full squats clearly outperformed for glute max and adductors. Limitation: depth is useful but does not guarantee uniform growth across all thigh muscles.",
      },
      {
        source: "Kassiano et al. 2023 - ROM review for longer lengths",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Quadriceps"],
        text: "Systematic review evidence suggests full ROM or partials performed in the initial ROM where muscles are longer tend to outperform end-range partials for several muscles including quadriceps. Limitation: mixed protocols and not exclusively squat studies.",
      },
    ],
  },
  {
    targetMuscle: "Gluteus Maximus",
    aliases: ["glutes", "glute max", "hip extensors"],
    movementPatterns: ["squat", "split squat", "hinge", "hip thrust", "bridge"],
    primaryJoints: ["hip", "knee"],
    primaryJointActions: ["hip extension"],
    lineOfForceTags: ["vertical", "horizontal", "angled"],
    whyItMatters:
      "Glute max is a prime hip extensor, so coaching should look for movements that create meaningful hip-extensor torque with sufficient hip flexion or a clearly hard end-range hip extension segment.",
    mechanicalTensionSummary:
      "Multiple exercise families can grow glutes. What matters most is meaningful hip-extensor loading, either from deeper hip flexion or from a resistance profile that strongly challenges end-range hip extension.",
    sarcomerogenesisSummary:
      "There is no convincing glute-max-specific human evidence demonstrating serial sarcomere addition from common hypertrophy exercises.",
    evidenceLevel: "moderate",
    keyHeuristics: [
      {
        metric: "bottomHipFlexionDeg",
        optimalRange: { min: 60, max: 110 },
        acceptableRange: { min: 45, max: 120 },
        why: "Glute max tends to become more relevant when the exercise loads the hip through meaningful flexion instead of tiny hip excursions.",
        evidenceSource: "Kubo et al. 2019; Krause Neto et al. 2025",
      },
      {
        metric: "hipExtensionDemandPattern",
        target: "meaningful load either in deep flexion or near full extension depending on exercise",
        why: "Both deep squats and hip thrusts can grow glutes, so the app should not assume one fixed joint-angle strategy.",
        evidenceSource: "Plotkin et al. 2023; Krause Neto et al. 2025",
      },
      {
        metric: "hipROMUsedUnderLoad",
        target: "full or near-full hip excursion in squat or hinge families; controlled end-range extension in hip thrust",
        why: "Glute hypertrophy appears achievable from both multi-joint and single-joint patterns when substantial loaded hip motion or high end-range hip torque is present.",
        evidenceSource: "Plotkin et al. 2023; Kassiano et al. 2023",
      },
    ],
    researchChunks: [
      {
        source: "Krause Neto et al. 2025 - glute meta-analysis",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Gluteus Maximus"],
        text: "Title: The impact of resistance training on gluteus maximus hypertrophy: a systematic review and meta-analysis. Year: 2025. DOI: 10.3389/fphys.2025.1542334. PMID: 40276368. Several exercise categories can grow glute max, including hip thrusts, squats, leg press, and mixed programs. Limitation: the exercise-specific evidence base is still small.",
      },
      {
        source: "Plotkin et al. 2023 - squat vs hip thrust glutes",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Gluteus Maximus", "Quadriceps"],
        text: "Title: Hip thrust and back squat training elicit similar gluteus muscle hypertrophy and transfer similarly to the deadlift. Year: 2023. DOI: 10.3389/fphys.2023.1279170. PMID: 37877099. Squats and hip thrusts produced similar glute hypertrophy, despite higher acute glute EMG in hip thrusts. Limitation: short intervention in untrained participants.",
      },
      {
        source: "Kassiano et al. 2023 - ROM review for glute max",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Gluteus Maximus"],
        text: "Review-level evidence suggests full ROM or longer-length ROM exposure tends to outperform final-ROM partials for glute max. Limitation: mostly indirect and pooled across exercise families.",
      },
    ],
  },
  {
    targetMuscle: "Hamstrings",
    muscleRegion: "Biarticular hamstrings, especially biceps femoris long head and semitendinosus",
    aliases: ["hamstrings", "biceps femoris", "posterior thigh"],
    movementPatterns: ["hinge", "leg curl", "nordic", "deadlift"],
    primaryJoints: ["hip", "knee"],
    primaryJointActions: ["hip extension", "knee flexion"],
    lineOfForceTags: ["vertical", "machine_path", "horizontal"],
    whyItMatters:
      "Hamstrings are highly exercise-specific because they cross both hip and knee. Coaching should distinguish knee-flexion patterns from hip-hinge patterns and pay special attention to whether the hamstrings are loaded in a hip-flexed, lengthened position.",
    mechanicalTensionSummary:
      "The best-supported pattern is meaningful tension when the biarticular hamstrings are long, especially with hip-flexed curls or hip hinges that keep the knees only softly bent.",
    sarcomerogenesisSummary:
      "Hamstrings are the strongest case for discussing longitudinal adaptations, but even here human serial-sarcomere evidence is indirect. Longer-length high-force loading is more defensible than eccentric-only claims.",
    evidenceLevel: "moderate",
    keyHeuristics: [
      {
        metric: "hipFlexionDuringKneeFlexionExercise",
        optimalRange: { min: 70, max: 100 },
        acceptableRange: { min: 60, max: 110 },
        why: "Compared with prone curls, hip-flexed curls place the biarticular hamstrings at longer lengths and directly improved hamstring hypertrophy more in MRI studies.",
        evidenceSource: "Maeo et al. 2021",
      },
      {
        metric: "hingeBottomHipFlexionDeg",
        optimalRange: { min: 60, max: 100 },
        acceptableRange: { min: 45, max: 110 },
        why: "In hinge patterns, more hip flexion with load usually increases hamstring length and hip-extensor demand.",
        evidenceSource: "Pedrosa et al. 2026; biomechanics synthesis",
      },
      {
        metric: "hingeKneeFlexionDeg",
        optimalRange: { min: 10, max: 30 },
        acceptableRange: { min: 5, max: 40 },
        why: "Too much knee bend shortens hamstrings and shifts a hinge toward a squat; slight bend preserves hamstring length while allowing control.",
        evidenceSource: "Biomechanics support; practical inference",
      },
      {
        metric: "peakTensionPosition",
        target: "exercise hardest when hamstrings are long",
        why: "Current review-level evidence favors meaningful external torque at longer muscle lengths more than simply labeling a rep eccentric.",
        evidenceSource: "Wolf et al. 2025; Blazevich et al. 2025",
      },
    ],
    researchChunks: [
      {
        source: "Maeo et al. 2021 - seated vs prone hamstring hypertrophy",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Hamstrings"],
        text: "Title: Greater Hamstrings Muscle Hypertrophy but Similar Damage Protection after Training at Long versus Short Muscle Lengths. Year: 2021. DOI: 10.1249/MSS.0000000000002523. PMID: 33009197. Seated leg curls increased whole hamstrings more than prone curls, with greater gains in each biarticular hamstring. Limitation: machine-curl comparison, not every hamstring exercise.",
      },
      {
        source: "Maeo et al. 2024 - lengthened-state hamstring eccentric training",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Hamstrings"],
        text: "Lengthened-state eccentric training in a hip-flexed position produced more overall hamstrings and biceps femoris long head growth than Nordic hamstring training. Limitation: exercise-specific comparison, not a universal hamstring hierarchy.",
      },
      {
        source: "Wolf et al. 2025 - longer-muscle-length review",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Hamstrings"],
        text: "Systematic review suggests longer-length resistance training may produce greater hypertrophy and fascicle-length increases, but evidence is mixed and serial sarcomere changes in humans remain unverified. Limitation: proxy-based architecture evidence.",
      },
      {
        source: "Blazevich et al. 2025 - sarcomerogenesis review",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Hamstrings"],
        text: "Review argued that high active or passive forces at long fiber lengths are the likely key stimulus for sarcomerogenesis, whereas eccentric contraction by itself does not appear to be the decisive driver. Limitation: mechanistic synthesis rather than direct hypertrophy proof.",
      },
    ],
  },
  {
    targetMuscle: "Pectoralis Major",
    muscleRegion: "Chest overall / sternocostal default",
    aliases: ["chest", "pecs", "pectorals"],
    movementPatterns: ["bench press", "press", "machine press", "push-up"],
    primaryJoints: ["shoulder", "elbow"],
    primaryJointActions: ["horizontal adduction", "elbow extension"],
    lineOfForceTags: ["horizontal", "slight_incline"],
    whyItMatters:
      "This is the best-supported default chest target for classifying novel horizontal presses before making more specific regional claims.",
    mechanicalTensionSummary:
      "Horizontal or near-horizontal pressing remains the safest whole-chest default. The key is preserving a true horizontal press with meaningful bottom-range loading rather than drifting into steep incline or shortened-partial patterns.",
    sarcomerogenesisSummary:
      "Direct chest evidence is limited. Long-length exposure in pressing is probably relevant, but there is not enough direct human evidence to claim chest sarcomerogenesis from any specific press variant.",
    evidenceLevel: "likely superior",
    keyHeuristics: [
      {
        metric: "benchAngleDegrees",
        optimalRange: { min: 0, max: 15 },
        acceptableRange: { min: 0, max: 30 },
        why: "Horizontal or near-horizontal pressing is the most defensible whole-pec benchmark.",
        evidenceSource: "Lauver et al. 2015",
      },
      {
        metric: "barTouchHeightProxy",
        target: "lower-to-mid sternum touch zone",
        why: "Higher touch points usually increase shoulder-flexion demands and reduce chest-specific leverage.",
        evidenceSource: "Larsen et al. 2021",
      },
      {
        metric: "bottomElbowFlexionCategory",
        target: "clear loaded bottom rather than shortened top-half pressing",
        why: "Long-length loading is likely more informative than simply labeling ROM as full or partial.",
        evidenceSource: "Wolf et al. 2023",
      },
    ],
    researchChunks: [
      {
        source: "Lauver et al. 2015 - bench angle and chest activation",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Pectoralis Major"],
        text: "Title: Influence of bench angle on upper extremity muscular activation during bench press exercise. Year: 2015. DOI: 10.1080/17461391.2015.1022605. PMID: 25799093. Horizontal bench produced strong overall pec activation, while steeper inclines shifted the pattern away from lower pec contribution. Limitation: acute EMG, not longitudinal hypertrophy.",
      },
      {
        source: "Wolf et al. 2023 - partial vs full ROM review for pressing",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Pectoralis Major"],
        text: "Across resistance-training studies, long-muscle-length loading can be at least as important as full ROM itself, supporting classification of bottom-range loading rather than ROM labels alone. Limitation: not bench-specific only.",
      },
      {
        source: "Larsen et al. 2021 - bench mechanics and leverage",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Pectoralis Major"],
        text: "Grip width materially changed bar path, ROM, and horizontal kinetics, so leverage fields like touch point and forearm alignment are worth storing. Limitation: 1RM biomechanics, not hypertrophy.",
      },
    ],
  },
  {
    targetMuscle: "Latissimus Dorsi",
    aliases: ["lats", "latissimus", "back width"],
    movementPatterns: ["pull-up", "pulldown", "row", "vertical pull", "horizontal pull"],
    primaryJoints: ["shoulder", "elbow", "scapula"],
    primaryJointActions: ["shoulder extension", "shoulder adduction", "elbow flexion"],
    lineOfForceTags: ["vertical", "horizontal"],
    whyItMatters:
      "Novel pulls vary a lot, so lat inference is stronger when the app tracks whether the rep behaves like loaded shoulder extension or adduction from an overhead or reached start rather than relying on grip folklore.",
    mechanicalTensionSummary:
      "The most defensible cross-exercise rule is to prioritize meaningful tension when the shoulder is more flexed and the lat is longer, then preserve an elbow path that keeps the movement in shoulder extension or adduction rather than a high-elbow upper-back pull.",
    sarcomerogenesisSummary:
      "Long-length loading is a reasonable mechanistic hypothesis for lats, but direct evidence for fascicle-length or sarcomerogenesis adaptations in common lat exercises is not established enough to overclaim.",
    evidenceLevel: "plausible bias",
    keyHeuristics: [
      {
        metric: "overheadStartQuality",
        target: "full overhead hang or stretch versus shortened start",
        why: "Likely the most useful proxy for long-length loading in vertical pulls.",
        evidenceSource: "Kassiano et al. 2026",
      },
      {
        metric: "elbowPathRelativeToTorso",
        target: "tucked or scapular-plane rather than clearly flared",
        why: "Better indicates a shoulder-extension or adduction pattern that plausibly biases lats over upper back or posterior delt.",
        evidenceSource: "Marcolin et al. 2025; Muyor et al. 2025",
      },
      {
        metric: "torsoLeanCategory",
        target: "upright or slight lean in pulldowns; only moderate hinge in rows when lat bias is intended",
        why: "Large layback or excessive hinge changes the line of force and can turn the rep into a hybrid row.",
        evidenceSource: "Marcolin et al. 2025; Muyor et al. 2025",
      },
    ],
    researchChunks: [
      {
        source: "Kassiano et al. 2026 - long-length exercise selection review",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Latissimus Dorsi"],
        text: "Across direct and indirect literature, hypertrophy tends to favor exercises and ROMs that load muscles at longer lengths when external torque is meaningful there. Limitation: review-level and not lat-specific only.",
      },
      {
        source: "Marcolin et al. 2025 - pulldown grip variations",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Latissimus Dorsi"],
        text: "Across seven pulldown variants, lat EMG did not differ meaningfully, suggesting grip folklore is weaker than path and setup context. Limitation: acute EMG, not hypertrophy.",
      },
      {
        source: "Muyor et al. 2025 - regional lat activation",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Latissimus Dorsi"],
        text: "Shoulder extension preferentially recruited the thoracic lat region more than adduction or trunk tasks, supporting elbow-path and torso-angle fields in rows. Limitation: isometric lab study, not dynamic hypertrophy.",
      },
    ],
  },
  {
    targetMuscle: "Deltoid",
    muscleRegion: "Medial deltoid",
    aliases: ["side delts", "middle delts", "shoulders"],
    movementPatterns: ["lateral raise", "raise", "overhead press"],
    primaryJoints: ["shoulder", "elbow"],
    primaryJointActions: ["shoulder abduction"],
    lineOfForceTags: ["vertical", "angled"],
    whyItMatters:
      "This is a common physique target, but strong exercise-specific superiority claims are still weak, so the app should classify likely bias rather than pretend certainty.",
    mechanicalTensionSummary:
      "The best-supported practical pattern is shoulder abduction with a stable lever, usually around shoulder height, in a scapular or slight-forward plane.",
    sarcomerogenesisSummary:
      "No strong direct hypertrophy evidence supports fascicle-length or sarcomerogenesis claims in medial-delt training.",
    evidenceLevel: "insufficient evidence",
    keyHeuristics: [
      {
        metric: "humeralAbductionDegrees",
        optimalRange: { min: 80, max: 100 },
        acceptableRange: { min: 60, max: 120 },
        why: "Shoulder-height peak is the clearest practical target; higher peaks may add trap contribution without clear hypertrophy proof.",
        evidenceSource: "Coratella et al. 2020",
      },
      {
        metric: "humeralPlaneCategory",
        target: "slight forward or scapular-plane raise",
        why: "Plane changes recruitment patterns, making it more useful than ROM alone.",
        evidenceSource: "Reed et al. 2016",
      },
      {
        metric: "elbowBendConsistency",
        target: "small stable bend",
        why: "Changing elbow bend changes lever length and effective shoulder loading even if motion looks similar.",
        evidenceSource: "Hik et al. 2019",
      },
    ],
    researchChunks: [
      {
        source: "Pinto et al. 2025 - dumbbell vs cable lateral raise",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Deltoid"],
        text: "When ROM was standardized and matched, dumbbell and cable lateral raises produced similar lateral-deltoid hypertrophy in trained lifters. Limitation: does not settle optimal plane or peak height.",
      },
      {
        source: "Coratella et al. 2020 - lateral raise variations",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Deltoid"],
        text: "Neutral lateral raises favored medial deltoid more than some other variants, while internal rotation increased upper-trap and other non-target activity. Limitation: acute EMG.",
      },
      {
        source: "Reed et al. 2016 - plane of abduction",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Deltoid"],
        text: "Changing the plane of shoulder abduction altered recruitment patterns, supporting scapular-plane categorization. Limitation: recruitment study, not hypertrophy.",
      },
    ],
  },
  {
    targetMuscle: "Triceps Brachii",
    muscleRegion: "Long head",
    aliases: ["triceps", "long head triceps"],
    movementPatterns: ["overhead extension", "pushdown", "press"],
    primaryJoints: ["shoulder", "elbow"],
    primaryJointActions: ["elbow extension"],
    lineOfForceTags: ["vertical", "angled", "cable"],
    whyItMatters:
      "This is one of the clearer upper-body cases where joint position strongly changes likely hypertrophy stimulus, so it is high value for novel-exercise inference.",
    mechanicalTensionSummary:
      "Because the long head crosses the shoulder, overhead elbow extensions likely increase tension by lengthening it more than by-side elbow extensions do.",
    sarcomerogenesisSummary:
      "Long-length loading is likely part of the mechanism, but direct human evidence for sarcomerogenesis specifically in the triceps long head remains limited.",
    evidenceLevel: "likely superior",
    keyHeuristics: [
      {
        metric: "shoulderPositionCategory",
        target: "overhead or near-overhead upper arm",
        why: "Direct hypertrophy evidence supports overhead training over neutral-arm training for long-head growth.",
        evidenceSource: "Maeo et al. 2023",
      },
      {
        metric: "elbowFlexionCategory",
        target: "deep bottom stretch rather than shortened top-half partials",
        why: "This preserves the long-length exposure that likely underpins the long-head advantage.",
        evidenceSource: "Maeo et al. 2023",
      },
      {
        metric: "upperArmDriftProxy",
        target: "upper arm mostly fixed overhead",
        why: "Excessive shoulder swing changes the movement pattern and muddies long-head inference.",
        evidenceSource: "Stasinaki et al. 2018",
      },
    ],
    researchChunks: [
      {
        source: "Maeo et al. 2023 - overhead vs neutral triceps",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Triceps Brachii"],
        text: "Title: Triceps brachii hypertrophy is substantially greater after elbow extension training performed in the overhead versus neutral arm position. Year: 2023. DOI: 10.1080/17461391.2022.2100279. PMID: 35819335. Overhead elbow extensions produced greater long-head triceps hypertrophy than neutral-arm training. Limitation: directly supports long-head bias, not every triceps exercise equally.",
      },
      {
        source: "Stasinaki et al. 2018 - triceps architecture context",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Triceps Brachii"],
        text: "Early training at short or long fascicle length improved triceps size similarly, so the long-length mechanism was not settled by older evidence. Limitation: small novice sample and weaker than the later direct long-head study.",
      },
      {
        source: "Kassiano et al. 2026 - general long-length review for triceps context",
        sourceType: "paper_summary",
        exercises: [],
        muscles: ["Triceps Brachii"],
        text: "Across exercises, meaningful torque at longer muscle lengths often appears favorable for hypertrophy, which is consistent with overhead long-head logic. Limitation: general review, not triceps-long-head-specific only.",
      },
    ],
  },
];
