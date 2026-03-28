Place self-hosted MediaPipe assets here before running the Day 0 spike:

- `wasm/vision_wasm_internal.wasm`
- `wasm/vision_wasm_nosimd_internal.wasm`
- `wasm/vision_wasm_internal.js`
- `wasm/vision_wasm_module_internal.js`
- `wasm/vision_wasm_nosimd_internal.js`
- `pose_landmarker_lite.task`
- `pose_landmarker_full.task`

The worker expects:

- WASM resolver path: `/mediapipe/wasm`
- Model path: `/mediapipe/pose_landmarker_full.task`

Runtime note:

- `npm run sync:mediapipe` copies the WASM runtime from `node_modules/@mediapipe/tasks-vision/wasm`
- The pose model itself is not bundled in the npm package and must be downloaded separately
