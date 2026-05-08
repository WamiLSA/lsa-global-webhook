export const mobileAreas = [
  {
    key: 'inbox',
    label: 'Inbox / Communications Hub',
    shortLabel: 'Inbox',
    route: 'Inbox',
    webPath: '/inbox',
    description: 'Client and operational conversation threads, live/test visibility, multilingual replies, attachments, and follow-up handling.',
    nativeStatus: 'Native mobile thread list and conversation reader'
  },
  {
    key: 'kb',
    label: 'Knowledge Base',
    shortLabel: 'Knowledge',
    route: 'FeatureArea',
    webPath: '/kb',
    description: 'Official knowledge records, quick capture, assisted extraction, duplicate review, and publishing workflows.',
    nativeStatus: 'Mobile entry point with web module handoff'
  },
  {
    key: 'providers',
    label: 'Providers',
    shortLabel: 'Providers',
    route: 'FeatureArea',
    webPath: '/providers',
    description: 'Provider records, provider intelligence, document vault, duplicate handling, and matching workflows.',
    nativeStatus: 'Mobile entry point with web module handoff'
  },
  {
    key: 'automation',
    label: 'Automation Hub',
    shortLabel: 'Automation',
    route: 'FeatureArea',
    webPath: '/automation',
    description: 'Controlled automation oversight, safe operational workflows, and supervised internal process support.',
    nativeStatus: 'Mobile entry point with web module handoff'
  },
  {
    key: 'settings',
    label: 'Settings',
    shortLabel: 'Settings',
    route: 'Settings',
    webPath: '/settings',
    description: 'Mobile diagnostics, account/session controls, runtime configuration, branding, and system settings.',
    nativeStatus: 'Native mobile diagnostics plus web settings access'
  },
  {
    key: 'ai-tools',
    label: 'AI Tools',
    shortLabel: 'AI Tools',
    route: 'FeatureArea',
    webPath: '/ai-tools',
    description: 'Internal AI tooling catalog, guarded assistance, analytics, and controlled support utilities.',
    nativeStatus: 'Mobile entry point with web module handoff'
  },
  {
    key: 'reports',
    label: 'Reports',
    shortLabel: 'Reports',
    route: 'FeatureArea',
    webPath: '/reports',
    description: 'Operational reports for messaging, providers, knowledge operations, and system health.',
    nativeStatus: 'Mobile entry point with web module handoff'
  }
];

export function getAreaByKey(key) {
  return mobileAreas.find((area) => area.key === key);
}
