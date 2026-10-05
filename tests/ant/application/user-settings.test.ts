import assert from 'node:assert/strict';
import test from 'node:test';
import { UserSettings } from '../../assets/Colony/scripts/application/userSettings.js';

test('sound preference persists and malformed data falls back enabled', () => {
  const storage = new Map<string, string>();
  const port = { read: (key: string) => storage.get(key) ?? null, write: (key: string, value: string) => { storage.set(key, value); } };
  const settings = new UserSettings(port);
  assert.equal(settings.snapshot().soundEnabled, true);
  settings.toggleSound();
  assert.equal(new UserSettings(port).snapshot().soundEnabled, false);
  storage.set('colony.settings.v1', '{bad');
  assert.equal(new UserSettings(port).snapshot().soundEnabled, true);
});

test('failed preference write leaves the in-memory value unchanged', () => {
  const settings = new UserSettings({ read: () => null, write: () => { throw new Error('disk full'); } });
  assert.throws(() => settings.toggleSound(), /disk full/);
  assert.equal(settings.snapshot().soundEnabled, true);
  assert.throws(() => settings.toggleMusic(), /disk full/);
  assert.equal(settings.snapshot().musicEnabled, true);
});

test('music preference is independent and old sound-only settings retain their choice', () => {
  const storage = new Map<string, string>([['colony.settings.v1', '{"soundEnabled":false}']]);
  const port = { read: (key: string) => storage.get(key) ?? null, write: (key: string, value: string) => { storage.set(key, value); } };
  const settings = new UserSettings(port);
  assert.deepEqual(settings.snapshot(), { soundEnabled: false, musicEnabled: true });
  settings.toggleMusic();
  assert.deepEqual(new UserSettings(port).snapshot(), { soundEnabled: false, musicEnabled: false });
  settings.toggleSound();
  assert.deepEqual(new UserSettings(port).snapshot(), { soundEnabled: true, musicEnabled: false });
});
