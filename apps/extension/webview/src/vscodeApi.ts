import type { OutgoingMessage } from "./types";

interface VsCodeApi {
  postMessage(message: OutgoingMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Singleton — acquireVsCodeApi can only be called once
let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}
