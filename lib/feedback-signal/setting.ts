import { SettingError, tokenValue, type SettingDef } from '@/lib/settings/types';

/**
 * The feedback signal (docs/deploy/04-feedback-signal.md): after the feedback box files an issue, this
 * server fires one Claude Code routine, which wakes the project's feedback thread. Both settings unset,
 * nothing is sent. The URL is the routine's API trigger; the token is the one claude.ai showed once
 * when the trigger was added.
 */
export const FEEDBACK_SIGNAL_URL_SETTING: SettingDef = {
  key: 'feedback.signalUrl',
  label: 'Feedback signal URL',
  group: 'tokens',
  secret: false,
  env: 'FEEDBACK_SIGNAL_URL',
  help: 'The routine’s API trigger: claude.ai/code/routines → PLC OS feedback signal → Edit → Add another trigger → API. New feedback wakes the project’s feedback thread; unset, nothing is sent.',
  placeholder: 'https://api.anthropic.com/v1/claude_code/routines/trig_…/fire',
  validate: (v) => {
    const t = v.trim();
    if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]{8,64}\/fire$/.test(t)) {
      throw new SettingError('feedback.signalUrl', 'Paste the routine’s API trigger URL: https://api.anthropic.com/v1/claude_code/routines/trig_…/fire');
    }
    return t;
  },
};

export const FEEDBACK_SIGNAL_TOKEN_SETTING: SettingDef = {
  key: 'feedback.signalToken',
  label: 'Feedback signal token',
  group: 'tokens',
  secret: true,
  env: 'FEEDBACK_SIGNAL_TOKEN',
  help: 'The token claude.ai showed once when the API trigger was added. It can only fire that one routine. It also signs the read link the signal carries.',
  placeholder: 'sk-ant-oat01-…',
  validate: (v) => tokenValue('feedback.signalToken', 'The signal token', v, { min: 20, max: 400, pattern: /^[A-Za-z0-9_-]+$/, patternWhy: 'The token is letters, digits, - and _ only.' }),
};
