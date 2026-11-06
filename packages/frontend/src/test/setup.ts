import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { setCurrentLang } from '../i18n/current';

// jsdom has no <dialog> behaviour
if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

window.scrollTo = (): void => undefined;

// findBy*/waitFor wait up to 1 s by default; the first screen of a file is slow to render on a busy machine
configure({ asyncUtilTimeout: 5000 });

// The whole UI is tested against the German texts: pin the language before every test (jsdom's navigator.language is en-US).
// Tests of the language logic itself clear or overwrite this.
beforeEach(() => {
  window.localStorage.setItem('craftmanager.lang', 'de');
});
afterEach(() => {
  setCurrentLang('de');
  document.documentElement.lang = 'de';
});
