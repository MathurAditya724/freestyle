import { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      pasteText: (text: string) => Promise<void>;
      updateHotkey: (hotkey: string) => void;
    };
  }
}
