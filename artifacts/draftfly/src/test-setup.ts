import "@testing-library/jest-dom";

// jsdom implements no media queries at all, so any component reaching for
// matchMedia — the sidebar's mobile breakpoint hook, for one — throws on mount
// and takes the whole render down with it. Report "does not match" for
// everything, which is the desktop layout the tests assume.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
