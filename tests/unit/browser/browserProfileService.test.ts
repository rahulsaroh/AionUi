import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserProfileService, getBrowserAssignmentService } from '@process/services/browser/BrowserProfileService';
import { DEFAULT_BROWSER_PROFILE_ID } from '@/common/browser/constants';

describe('BrowserProfileService', () => {
  let tempDir: string;
  let service: BrowserProfileService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-browser-profile-test-'));
    service = new BrowserProfileService({
      userDataPath: tempDir,
      configFilePath: path.join(tempDir, 'browser_profiles.json'),
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it('initializes with default profile', () => {
    const profiles = service.getProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(1);
    const defaultProfile = service.getProfile(DEFAULT_BROWSER_PROFILE_ID);
    expect(defaultProfile).toBeDefined();
    expect(defaultProfile?.id).toBe(DEFAULT_BROWSER_PROFILE_ID);
    expect(defaultProfile?.backend).toBe('embedded');
  });

  it('creates and retrieves a new profile with sanitized id', () => {
    const created = service.createProfile({
      name: 'Instagram Brand Account',
      backend: 'embedded',
    });

    expect(created.name).toBe('Instagram Brand Account');
    expect(created.id).toContain('instagram-brand');
    expect(created.partition).toBe(`persist:aionui-browser-${created.id}`);
    expect(service.getProfile(created.id)).toEqual(created);
  });

  it('updates profile settings correctly', () => {
    const created = service.createProfile({ name: 'Work Profile' });
    const updated = service.updateProfile({
      id: created.id,
      name: 'Work Profile Renamed',
      backend: 'external-chrome',
      externalChrome: { port: 9333 },
    });

    expect(updated.name).toBe('Work Profile Renamed');
    expect(updated.backend).toBe('external-chrome');
    expect(updated.externalChrome?.port).toBe(9333);
  });

  it('switches active profile', () => {
    const created = service.createProfile({ name: 'Secondary' });
    expect(service.getActiveProfile().id).toBe(DEFAULT_BROWSER_PROFILE_ID);

    service.setActiveProfile(created.id);
    expect(service.getActiveProfile().id).toBe(created.id);
  });

  it('prevents deleting the default profile', () => {
    expect(() => service.deleteProfile(DEFAULT_BROWSER_PROFILE_ID)).toThrow('Cannot delete default profile');
  });

  it('deletes custom profile and resets active to default if deleted was active', () => {
    const created = service.createProfile({ name: 'Temp Profile' });
    service.setActiveProfile(created.id);

    const deleted = service.deleteProfile(created.id);
    expect(deleted).toBe(true);
    expect(service.getProfile(created.id)).toBeUndefined();
    expect(service.getActiveProfile().id).toBe(DEFAULT_BROWSER_PROFILE_ID);
  });

  it('clears profile data safely', async () => {
    const created = service.createProfile({ name: 'Clean Me' });
    const result = await service.clearProfileData(created.id);
    expect(result.success).toBe(true);
    expect(result.profileId).toBe(created.id);
  });

  it('guarantees isolated persistent storage partitions for different profiles', () => {
    const profileA = service.createProfile({ name: 'youtube-main' });
    const profileB = service.createProfile({ name: 'instagram-news' });

    expect(profileA.partition).not.toBe(profileB.partition);
    expect(profileA.partition).toContain('youtube-main');
    expect(profileB.partition).toContain('instagram-news');
    expect(profileA.partition.startsWith('persist:')).toBe(true);
    expect(profileB.partition.startsWith('persist:')).toBe(true);
  });

  it('prevents agents from accessing cookies or authorization tokens', () => {
    expect(() => {
      service.assertAgentCannotAccessCookies('evaluate', { script: 'return document.cookie;' });
    }).toThrow(/cookies, tokens, or credentials is prohibited/);

    expect(() => {
      service.assertAgentCannotAccessCookies('evaluate', { script: 'localStorage.getItem("authToken")' });
    }).toThrow(/cookies, tokens, or credentials is prohibited/);

    expect(() => {
      service.assertAgentCannotAccessCookies('type', { text: 'BearerToken123' });
    }).toThrow(/cookies, tokens, or credentials is prohibited/);

    const scrubbed = service.scrubAgentOutput({
      url: 'https://example.com',
      headers: 'Cookie: session=secret123\r\nAuthorization: Bearer myToken',
      data: { cookie: 'secret', token: 'token123' },
    });

    expect(JSON.stringify(scrubbed)).not.toContain('secret123');
    expect(JSON.stringify(scrubbed)).not.toContain('myToken');
    expect(JSON.stringify(scrubbed)).toContain('[REDACTED]');
  });

  it('enforces project and team profile assignments', () => {
    const assignmentService = getBrowserAssignmentService();
    assignmentService.clearAll();

    const profileYoutube = service.createProfile({
      name: 'youtube-main',
      assignedTeamIds: ['team-media'],
      assignedProjectIds: ['project-alpha'],
    });

    const profileInstagram = service.createProfile({
      name: 'instagram-news',
      assignedTeamIds: ['team-social'],
    });

    // team-media can use profileYoutube but NOT profileInstagram
    expect(assignmentService.canScopeUseProfile(profileYoutube.id, 'team', 'team-media')).toBe(true);
    expect(assignmentService.canScopeUseProfile(profileInstagram.id, 'team', 'team-media')).toBe(false);

    // team-social can use profileInstagram but NOT profileYoutube
    expect(assignmentService.canScopeUseProfile(profileInstagram.id, 'team', 'team-social')).toBe(true);
    expect(assignmentService.canScopeUseProfile(profileYoutube.id, 'team', 'team-social')).toBe(false);

    // project-alpha can use profileYoutube
    expect(assignmentService.canScopeUseProfile(profileYoutube.id, 'project', 'project-alpha')).toBe(true);
    expect(assignmentService.canScopeUseProfile(profileInstagram.id, 'project', 'project-alpha')).toBe(false);

    // An unassigned profile throws in assertScopeCanUseProfile
    expect(() => {
      assignmentService.assertScopeCanUseProfile(profileInstagram.id, 'team', 'team-media');
    }).toThrow(/Access denied: Profile/);
  });
});
