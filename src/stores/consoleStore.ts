import { create } from "zustand";
import { CONSOLE_BUFFER_SIZE } from "@/shared/constants";
import { translateLine } from "@/shared/logTranslate";
import type { ConsoleLine } from "@/shared/types";

interface ConsoleState {
  lines: ConsoleLine[];
  history: string[];
  translateOn: boolean;
  appendRaw: (raw: string) => void;
  setTranslateOn: (on: boolean) => void;
  pushHistory: (cmd: string) => void;
  clear: () => void;
}

function levelOf(raw: string): ConsoleLine["level"] {
  if (/\bERROR\b|\bSEVERE\b|Exception|Error/i.test(raw)) return "error";
  if (/\bWARN\b|\bWARNING\b/i.test(raw)) return "warn";
  return "info";
}

export const useConsoleStore = create<ConsoleState>((set) => ({
  lines: [],
  history: [],
  translateOn: true,
  appendRaw: (raw) =>
    set((s) => {
      const line: ConsoleLine = {
        ts: Date.now(),
        raw,
        level: levelOf(raw),
        translated: s.translateOn ? translateLine(raw) : undefined,
      };
      const next = [...s.lines, line];
      return { lines: next.length > CONSOLE_BUFFER_SIZE ? next.slice(next.length - CONSOLE_BUFFER_SIZE) : next };
    }),
  setTranslateOn: (on) => {
    set({ translateOn: on });
    if (!on) return;
    // 开启时对已有行补充翻译
    set((s) => ({
      lines: s.lines.map((l) => ({ ...l, translated: translateLine(l.raw) })),
    }));
  },
  pushHistory: (cmd) =>
    set((s) => ({ history: [...s.history, cmd].slice(-50) })),
  clear: () => set({ lines: [] }),
}));
