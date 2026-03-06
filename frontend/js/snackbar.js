import { state } from "./state.js";

export function showSnackbar(text, { seconds = 1.4, kind = "info" } = {}) {
  state.snackbar.text = String(text || "").trim();
  state.snackbar.time = Math.max(0, Number(seconds) || 0);
  state.snackbar.kind = kind === "error" || kind === "success" ? kind : "info";
}

export function tickSnackbar(dt) {
  if (state.snackbar.time <= 0) return;
  state.snackbar.time = Math.max(0, state.snackbar.time - dt);
  if (state.snackbar.time === 0) {
    state.snackbar.text = "";
    state.snackbar.kind = "info";
  }
}
