import { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      pasteText: (text: string) => Promise<void>;
      updateHotkey: (hotkey: string) => void;
      hidePill: () => void;
      getServerPort: () => Promise<number>;
      onHotkeyDown: (callback: () => void) => () => void;
      onHotkeyUp: (callback: () => void) => () => void;
      checkMicPermission: () => Promise<string>;
      requestMicPermission: () => Promise<string>;
      checkAccessibilityPermission: () => Promise<boolean>;
      openAccessibilitySettings: () => void;
      getOnboardingComplete: () => Promise<boolean>;
      setOnboardingComplete: () => void;
      startHotkeyRecording: () => void;
      stopHotkeyRecording: () => void;
      onHotkeyRecordModifiers: (
        callback: (modifiers: string[]) => void,
      ) => () => void;
      onHotkeyRecordCaptured: (
        callback: (combo: { modifiers: string[]; key: string }) => void,
      ) => () => void;
      onHotkeyRecordCancel: (callback: () => void) => () => void;
    };
  }
}
