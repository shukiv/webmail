import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Avatar } from '../avatar';

describe('Avatar', () => {
  it('renders initials from full name', () => {
    const { container } = render(<Avatar name="Alice Smith" />);
    expect(container.textContent).toBe('AS');
  });

  it('renders two letters from single-word name', () => {
    const { container } = render(<Avatar name="Alice" />);
    expect(container.textContent).toBe('AL');
  });

  it('renders single letter from email when no name', () => {
    const { container } = render(<Avatar email="bob@example.com" />);
    expect(container.textContent).toBe('B');
  });

  it('renders "?" when no name or email', () => {
    const { container } = render(<Avatar />);
    expect(container.textContent).toBe('?');
  });

  it('produces consistent background color for same input', () => {
    const { container: a } = render(<Avatar name="Alice" />);
    const { container: b } = render(<Avatar name="Alice" />);
    const colorA = (a.firstChild as HTMLElement).style.backgroundColor;
    const colorB = (b.firstChild as HTMLElement).style.backgroundColor;
    expect(colorA).toBe(colorB);
  });

  it('shows a given src before every other source', () => {
    const { container } = render(
      <Avatar name="Alice Smith" src="/api/account-avatar?slot=0" contactPhotoUri="data:image/png;base64,AA" disableFavicon />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/account-avatar?slot=0');
  });

  it('falls through a broken image to the next source, then to the initials', () => {
    const { container } = render(
      <Avatar name="Alice Smith" src="/api/account-avatar?slot=0" contactPhotoUri="data:image/png;base64,AA" disableFavicon />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA');
    // A broken contact photo used to stay on screen as an empty circle.
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('AS');
  });

  it('tries again for another address', () => {
    const { container, rerender } = render(
      <Avatar name="Alice Smith" email="alice@example.net" src="/api/account-avatar?slot=0" disableFavicon />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    rerender(<Avatar name="Bob Jones" email="bob@example.net" src="/api/account-avatar?slot=0" disableFavicon />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/account-avatar?slot=0');
  });

  it('shows no image at all with disableImages, src included', () => {
    const { container } = render(<Avatar name="Alice Smith" src="/api/account-avatar?slot=0" disableImages />);
    expect(container.querySelector('img')).toBeNull();
  });
});
