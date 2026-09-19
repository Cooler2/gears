// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
// Module worker: builds pulleys off the main thread so the form stays responsive.
// Protocol: { type: "build", id, description } → { type: "built" | "crashed", id, … }.
import { handleBuildRequest } from "./build.js";

self.addEventListener("message", ({ data }) => {
  if (data?.type !== "build") return;
  const { reply, transfer } = handleBuildRequest(data);
  self.postMessage(reply, transfer);
});
