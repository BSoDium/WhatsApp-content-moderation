import { beforeEach, describe, expect, it, vi } from 'vitest';
import { popUrlStateIfPrevious, readUrlState, writeUrlState } from './urlState';

function setLocation(url: string): void {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  setLocation('http://localhost/');
});

describe('readUrlState', () => {
  it('reads a supported openPanel value', () => {
    setLocation('http://localhost/?openPanel=policy');
    expect(readUrlState().openPanel).toBe('policy');
  });

  it.each(['activity', 'policy', 'settings'] as const)('accepts %s as a supported panel', (panel) => {
    setLocation(`http://localhost/?openPanel=${panel}`);
    expect(readUrlState().openPanel).toBe(panel);
  });

  it('treats an invalid openPanel value as absent', () => {
    setLocation('http://localhost/?openPanel=bogus');
    expect(readUrlState().openPanel).toBeNull();
  });

  it('treats a missing openPanel as no global panel open', () => {
    setLocation('http://localhost/');
    expect(readUrlState().openPanel).toBeNull();
  });

  it('reads the contact param independently of openPanel', () => {
    setLocation('http://localhost/?contact=abc%40s.whatsapp.net&openPanel=settings');
    const state = readUrlState();
    expect(state.contactId).toBe('abc@s.whatsapp.net');
    expect(state.openPanel).toBe('settings');
  });

  it('reads activityContact only when openPanel is activity', () => {
    setLocation('http://localhost/?openPanel=activity&activityContact=xyz%40s.whatsapp.net');
    expect(readUrlState().activityContactId).toBe('xyz@s.whatsapp.net');
  });

  it('ignores activityContact when openPanel is not activity', () => {
    setLocation('http://localhost/?openPanel=policy&activityContact=xyz%40s.whatsapp.net');
    expect(readUrlState().activityContactId).toBeNull();
  });

  it('supports a contact selected with no panel open', () => {
    setLocation('http://localhost/?contact=abc%40s.whatsapp.net');
    const state = readUrlState();
    expect(state.contactId).toBe('abc@s.whatsapp.net');
    expect(state.openPanel).toBeNull();
  });
});

describe('writeUrlState', () => {
  it('writes the contact and openPanel params', () => {
    writeUrlState({ contactId: 'abc@s.whatsapp.net', openPanel: 'activity', activityContactId: null });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('contact')).toBe('abc@s.whatsapp.net');
    expect(params.get('openPanel')).toBe('activity');
  });

  it('removes openPanel when closing the panel, keeping the contact param', () => {
    writeUrlState({ contactId: 'abc@s.whatsapp.net', openPanel: 'settings', activityContactId: null });
    writeUrlState({ contactId: 'abc@s.whatsapp.net', openPanel: null, activityContactId: null });
    const params = new URLSearchParams(window.location.search);
    expect(params.has('openPanel')).toBe(false);
    expect(params.get('contact')).toBe('abc@s.whatsapp.net');
  });

  it('removes only the contact param when closing contact details', () => {
    writeUrlState({ contactId: 'abc@s.whatsapp.net', openPanel: 'policy', activityContactId: null });
    writeUrlState({ contactId: null, openPanel: 'policy', activityContactId: null });
    const params = new URLSearchParams(window.location.search);
    expect(params.has('contact')).toBe(false);
    expect(params.get('openPanel')).toBe('policy');
  });

  it('never writes more than one panel at a time (openPanel is a single value)', () => {
    writeUrlState({ contactId: null, openPanel: 'activity', activityContactId: null });
    const params = new URLSearchParams(window.location.search);
    expect(params.getAll('openPanel')).toEqual(['activity']);
  });

  it('drops an invalid openPanel value left over from a stale link on the first sync', () => {
    setLocation('http://localhost/?openPanel=bogus&contact=abc%40s.whatsapp.net');
    const state = readUrlState();
    writeUrlState(state);
    const params = new URLSearchParams(window.location.search);
    expect(params.has('openPanel')).toBe(false);
    expect(params.get('contact')).toBe('abc@s.whatsapp.net');
  });

  it('preserves unrelated query params and the hash', () => {
    setLocation('http://localhost/?foo=bar&baz=1#section');
    writeUrlState({ contactId: 'abc@s.whatsapp.net', openPanel: null, activityContactId: null });
    expect(window.location.search).toContain('foo=bar');
    expect(window.location.search).toContain('baz=1');
    expect(window.location.hash).toBe('#section');
  });

  it('pushes a history entry by default', () => {
    const before = window.history.length;
    writeUrlState({ contactId: 'abc@s.whatsapp.net', openPanel: 'activity', activityContactId: null });
    writeUrlState({ contactId: 'def@s.whatsapp.net', openPanel: 'policy', activityContactId: null });
    expect(window.history.length).toBe(before + 2);
  });

  it('rewrites the current entry in replace mode', () => {
    const before = window.history.length;
    writeUrlState({ contactId: 'abc@s.whatsapp.net', openPanel: null, activityContactId: null }, 'replace');
    expect(window.history.length).toBe(before);
    expect(new URLSearchParams(window.location.search).get('contact')).toBe('abc@s.whatsapp.net');
  });

  it('writes nothing when the state already matches the URL', () => {
    setLocation('http://localhost/?contact=abc%40s.whatsapp.net');
    const before = window.history.length;
    writeUrlState({ contactId: 'abc@s.whatsapp.net', openPanel: null, activityContactId: null });
    expect(window.history.length).toBe(before);
  });

  describe('popUrlStateIfPrevious', () => {
    const LIST = { contactId: null, openPanel: null, activityContactId: null } as const;
    const CONTACT = { contactId: 'abc@s.whatsapp.net', openPanel: null, activityContactId: null } as const;

    it('steps back when the previous entry is the target', () => {
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      writeUrlState(LIST, 'replace');
      writeUrlState(CONTACT);
      expect(popUrlStateIfPrevious(LIST)).toBe(true);
      expect(back).toHaveBeenCalledOnce();
      back.mockRestore();
    });

    it('does nothing when the previous entry is a different state', () => {
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      writeUrlState(LIST, 'replace');
      writeUrlState(CONTACT);
      writeUrlState({ contactId: 'def@s.whatsapp.net', openPanel: null, activityContactId: null });
      expect(popUrlStateIfPrevious(LIST)).toBe(false);
      expect(back).not.toHaveBeenCalled();
      back.mockRestore();
    });

    it('does nothing when there is no previous entry of this page load', () => {
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      writeUrlState(CONTACT, 'replace');
      expect(popUrlStateIfPrevious(LIST)).toBe(false);
      expect(back).not.toHaveBeenCalled();
      back.mockRestore();
    });
  });

  it('round-trips through readUrlState for a refresh/deep-link scenario', () => {
    writeUrlState({ contactId: 'abc@s.whatsapp.net', openPanel: 'activity', activityContactId: 'def@s.whatsapp.net' });
    const reloaded = readUrlState();
    expect(reloaded).toEqual({
      contactId: 'abc@s.whatsapp.net',
      openPanel: 'activity',
      activityContactId: 'def@s.whatsapp.net',
    });
  });
});
