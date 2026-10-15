import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cfg = { senderAvatarEnabled: true };
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ devMode: false, senderAvatarEnabled: cfg.senderAvatarEnabled }) }));

const known = new Map<string, string | null>();
let answer: (src: string | null) => void = () => {};
const senderAvatar = vi.fn((email: string) => new Promise<string | null>((resolve) => {
  answer = (src) => { known.set(email, src); resolve(src); };
}));
vi.mock('@/lib/sender-avatar', () => ({
  knownSenderAvatar: (email: string) => (known.has(email) ? known.get(email) : undefined),
  senderAvatar: (email: string) => senderAvatar(email),
}));

import { Avatar } from '../avatar';

const PIC = 'data:image/jpeg;base64,/9j/4A==';
const img = (c: HTMLElement) => c.querySelector('img')?.getAttribute('src') ?? null;

beforeEach(() => {
  cfg.senderAvatarEnabled = true;
  known.clear();
  senderAvatar.mockClear();
});

describe('Avatar with sender pictures', () => {
  it('shows the sender picture, and not the domain icon before it', async () => {
    const { container } = render(<Avatar name="Dana Levi" email="dana@acme.net" />);
    expect(senderAvatar).toHaveBeenCalledWith('dana@acme.net');
    expect(img(container)).toBeNull();
    expect(container.textContent).toBe('DL');
    await act(async () => answer(PIC));
    expect(img(container)).toBe(PIC);
  });

  it('goes on to the domain icon when there is none', async () => {
    const { container } = render(<Avatar name="Dana Levi" email="dana@acme.net" />);
    await act(async () => answer(null));
    expect(img(container)).toContain('/api/favicon?domain=acme.net');
  });

  it('shows a known picture at once, without asking', () => {
    known.set('dana@acme.net', PIC);
    const { container } = render(<Avatar name="Dana Levi" email="dana@acme.net" />);
    expect(img(container)).toBe(PIC);
    expect(senderAvatar).not.toHaveBeenCalled();
  });

  it('puts a contact photo first', async () => {
    const { container } = render(<Avatar name="Dana Levi" email="dana@acme.net" contactPhotoUri="data:image/png;base64,AA" />);
    await act(async () => answer(PIC));
    expect(img(container)).toBe('data:image/png;base64,AA');
  });

  it('does not ask for the account itself, with images off, or when the server has no service', () => {
    render(<Avatar name="Dana Levi" email="dana@acme.net" src="/api/account-avatar?slot=0" />);
    render(<Avatar name="Dana Levi" email="dana@acme.net" disableImages />);
    cfg.senderAvatarEnabled = false;
    const { container } = render(<Avatar name="Dana Levi" email="dana@acme.net" />);
    expect(senderAvatar).not.toHaveBeenCalled();
    expect(img(container)).toContain('/api/favicon?domain=acme.net');
  });
});
