import type { Namespace } from '../../types';

export const login: Namespace<'login'> = {
  documentTitle: 'Sign in · LanQuarry',
  title: 'Sign-in required',
  passwordIntro:
    'This LanQuarry is protected by a password. Forgot it? On the server computer, set a new one with the command “craftmanager reset-password” (Linux) or via “Reset password” in the Start menu (Windows).',
  tokenIntro:
    'This LanQuarry is protected by an access token. The token is in the configuration (AUTH_TOKEN) on the server computer. It acts as the initial password and can be changed under System after signing in.',
  passwordLabel: 'Password',
  tokenLabel: 'Access token',
  retryIn: (seconds) => `You can try again in ${seconds} s.`,
  submit: 'Sign in',
};
