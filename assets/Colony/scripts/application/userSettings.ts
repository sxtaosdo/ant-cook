export interface SettingsSavePort {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export interface UserSettingsSnapshot {
  readonly soundEnabled: boolean;
  readonly musicEnabled: boolean;
}

const SETTINGS_KEY = 'colony.settings.v1';

/** Small local preference store. It contains no gameplay or paid balance. */
export class UserSettings {
  private data: UserSettingsSnapshot;

  public constructor(private readonly port: SettingsSavePort) {
    this.data = this.load();
  }

  public snapshot(): UserSettingsSnapshot { return { ...this.data }; }

  public toggleSound(): UserSettingsSnapshot {
    return this.save({ ...this.data, soundEnabled: !this.data.soundEnabled });
  }

  public toggleMusic(): UserSettingsSnapshot {
    return this.save({ ...this.data, musicEnabled: !this.data.musicEnabled });
  }

  private save(next: UserSettingsSnapshot): UserSettingsSnapshot {
    this.port.write(SETTINGS_KEY, JSON.stringify(next));
    this.data = next;
    return this.snapshot();
  }

  private load(): UserSettingsSnapshot {
    try {
      const value = this.port.read(SETTINGS_KEY);
      if (!value) return { soundEnabled: true, musicEnabled: true };
      const parsed = JSON.parse(value) as Partial<UserSettingsSnapshot>;
      return { soundEnabled: parsed.soundEnabled !== false, musicEnabled: parsed.musicEnabled !== false };
    } catch {
      return { soundEnabled: true, musicEnabled: true };
    }
  }
}
