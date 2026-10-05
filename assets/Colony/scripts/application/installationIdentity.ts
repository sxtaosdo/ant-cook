import type { SettingsSavePort } from './userSettings';

export const INSTALLATION_ID_KEY = 'colony.installation.v1';
export const INSTALLATION_ID_BACKUP_KEY = `${INSTALLATION_ID_KEY}.backup`;
const VALID_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Separate from progress: an installation identity survives progress recovery and test profiles. */
export class InstallationIdentity {
  private candidate: string | null = null;
  private saved: string | null = null;
  public constructor(private readonly port: SettingsSavePort, private readonly randomBytes: () => Uint8Array) {}
  public read(): string | null {
    if (this.saved) return this.saved;
    try {
      const primary = this.port.read(INSTALLATION_ID_KEY);
      const backup = this.port.read(INSTALLATION_ID_BACKUP_KEY);
      if (primary && VALID_ID.test(primary)) {
        this.saved = primary;
        if (backup !== primary) this.port.write(INSTALLATION_ID_BACKUP_KEY, primary);
        return this.saved;
      }
      this.candidate ??= backup && VALID_ID.test(backup) ? backup : this.generate();
      this.port.write(INSTALLATION_ID_BACKUP_KEY, this.candidate);
      this.port.write(INSTALLATION_ID_KEY, this.candidate);
      this.saved = this.candidate;
      return this.saved;
    } catch { return this.saved; }
  }
  private generate(): string {
    const bytes = this.randomBytes();
    if (bytes.length !== 16) throw new Error('Invalid identity entropy');
    bytes[6] = (bytes[6]! & 15) | 64;
    bytes[8] = (bytes[8]! & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}
