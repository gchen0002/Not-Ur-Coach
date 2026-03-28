import { useRef, useState } from "react";
import { SurfaceCard } from "@/components/ui/surface-card";
import PoseWorker from "@/workers/pose-worker?worker";

type SpikeResult =
  | { status: "idle"; message: string }
  | { status: "running"; message: string }
  | { status: "success"; message: string; landmarks: number }
  | { status: "error"; message: string };

export function DayZeroPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [result, setResult] = useState<SpikeResult>({
    status: "idle",
    message: "Worker is ready. Upload a frame with a visible full-body subject, then run the spike.",
  });

  async function handleRunSpike(file?: File | null) {
    if (!file) {
      setResult({
        status: "error",
        message: "Select a test image first. Use a clear full-body frame from a squat or hinge clip.",
      });
      return;
    }

    setResult({ status: "running", message: "Booting worker and loading MediaPipe assets..." });
    const imageBitmap = await createImageBitmap(file);

    const worker = new PoseWorker();

    worker.onmessage = (event: MessageEvent<SpikeResult>) => {
      setResult(event.data);
      worker.terminate();
    };

    worker.onerror = () => {
      setResult({
        status: "error",
        message: "Worker failed before reporting back. Check the browser console for the underlying error.",
      });
      worker.terminate();
    };

    worker.postMessage({
      type: "RUN_SPIKE",
      payload: {
        wasmPath: "/mediapipe/wasm",
        image: imageBitmap,
      },
    }, [imageBitmap]);
  }

  return (
    <div className="space-y-6">
      <SurfaceCard
        eyebrow="Day 0"
        title="MediaPipe worker spike"
        description="Non-negotiable first proof: load the Pose Landmarker in a Web Worker, process one frame, and get landmarks back into the app."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="rounded-full border border-[var(--outline)] bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-1)] transition hover:bg-[var(--surface-2)]">
              Choose test frame
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setImageFileName(nextFile?.name ?? null);
                  setResult({
                    status: "idle",
                    message: nextFile
                      ? "Frame selected. Run the spike to verify worker boot, model load, and landmark extraction."
                      : "Worker is ready. Upload a frame with a visible full-body subject, then run the spike.",
                  });
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                void handleRunSpike(fileInputRef.current?.files?.[0] ?? null);
              }}
              className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-1)] transition hover:brightness-95"
            >
              Run spike
            </button>
          </div>

          <p className="text-sm text-[var(--ink-soft)]">
            {imageFileName ? `Selected frame: ${imageFileName}` : "No test frame selected yet."}
          </p>
          <p className="text-sm text-[var(--ink-soft)]">
            Requires self-hosted MediaPipe WASM assets at <code>/public/mediapipe/wasm</code>.
          </p>
        </div>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Result"
        title={result.status === "success" ? "Spike passed" : "Spike status"}
        description={result.message}
      >
        <div className="rounded-[24px] bg-[var(--surface-2)] p-5 font-mono text-sm text-[var(--ink-soft)]">
          <p>status: {result.status}</p>
          {"landmarks" in result ? <p>landmarks: {result.landmarks}</p> : null}
        </div>
      </SurfaceCard>
    </div>
  );
}
