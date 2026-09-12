import { defineDict } from '../index';

export const research = defineDict({
  es: {
    toggleLabel: 'Investigación',
    toggleUnavailable: 'La búsqueda web está desactivada en Ajustes.',
    openSettings: 'Abrir ajustes',

    warningBraveKey: 'Brave está seleccionado y no tiene API key guardada. Agrega la key o cambia a DuckDuckGo.',
    warningTavilyKey: 'Tavily está seleccionado y no tiene API key guardada. Agrega la key o cambia a DuckDuckGo.',
    warningProxyUrl: 'El proxy está en modo personalizado sin URL. Configúralo para que la búsqueda funcione.',
    warningInvalidProxyUrl: 'La URL del proxy personalizado no es válida. Debe ser una URL http o https.',
    warningBrowserProxy: 'En el navegador las búsquedas directas pueden bloquearse por CORS. Si fallan, configura el proxy.',

    panelTitle: 'Investigación',
    stepsTitle: 'Pasos',
    noSteps: 'Aún no hay pasos.',
    stepLabel: 'Paso {index}',
    stepStatusRunning: 'En curso',
    stepStatusComplete: 'Completado',
    stepStatusError: 'Error',
    durationMs: '{ms} ms',
    durationSeconds: '{seconds} s',

    sourcesTitle: 'Fuentes',
    sourcesEmpty: 'Aún no hay fuentes.',
    sourceCount: '{count} fuentes',
    sourceLinkLabel: '{title} (se abre en una pestaña nueva)',
    toggleSources: 'Mostrar fuentes',

    budgetTitle: 'Presupuesto',
    budgetSteps: 'Pasos',
    budgetToolCalls: 'Herramientas',
    budgetTokens: 'Tokens',
    budgetWallClock: 'Tiempo',
    budgetValue: '{used} / {max}',
  },
  en: {
    toggleLabel: 'Research',
    toggleUnavailable: 'Web search is disabled in Settings.',
    openSettings: 'Open settings',

    warningBraveKey: 'Brave is selected but has no stored API key. Add the key or switch to DuckDuckGo.',
    warningTavilyKey: 'Tavily is selected but has no stored API key. Add the key or switch to DuckDuckGo.',
    warningProxyUrl: 'The proxy is in custom mode without a URL. Configure it so search can work.',
    warningInvalidProxyUrl: 'The custom proxy URL is invalid. It must be an http or https URL.',
    warningBrowserProxy: 'Direct searches may be blocked by CORS in the browser. If they fail, configure the proxy.',

    panelTitle: 'Research',
    stepsTitle: 'Steps',
    noSteps: 'No steps yet.',
    stepLabel: 'Step {index}',
    stepStatusRunning: 'Running',
    stepStatusComplete: 'Completed',
    stepStatusError: 'Error',
    durationMs: '{ms} ms',
    durationSeconds: '{seconds} s',

    sourcesTitle: 'Sources',
    sourcesEmpty: 'No sources yet.',
    sourceCount: '{count} sources',
    sourceLinkLabel: '{title} (opens in a new tab)',
    toggleSources: 'Show sources',

    budgetTitle: 'Budget',
    budgetSteps: 'Steps',
    budgetToolCalls: 'Tools',
    budgetTokens: 'Tokens',
    budgetWallClock: 'Time',
    budgetValue: '{used} / {max}',
  },
});

export type ResearchMessages = (typeof research)['es'];

declare module '../types' {
  interface I18nSchema {
    research: ResearchMessages;
  }
}
