/**
 * Dictado por voz, portado del patrón de OpenHer:
 * - Android/iOS nativo: `@capacitor-community/speech-recognition` (reconocedor del sistema).
 * - Windows/desktop web: Web Speech API del navegador (`webkitSpeechRecognition`).
 *
 * El dictado **acumula**: nunca borra el texto previo y sobrevive a las pausas
 * (reinicio automático) sin perder lo dictado. La acumulación vive en
 * `dictationBuffer` (pura y testeada).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechRecognition as CapSpeechRecognition } from '@capacitor-community/speech-recognition';
import type { PluginListenerHandle } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

import { getLocale } from '@/i18n';

import { appendWebFinal, combineDisplay, mergeNativePartial } from './dictationBuffer';

// --- Tipado mínimo de la Web Speech API (el prefijo `webkit` no está en lib.dom) ---

interface SpeechAlternativeLike {
  transcript: string;
}

interface SpeechResultLike {
  isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternativeLike | undefined;
}

interface SpeechResultListLike {
  readonly length: number;
  [index: number]: SpeechResultLike | undefined;
}

interface SpeechResultEventLike {
  results: SpeechResultListLike;
}

interface SpeechErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

/** Lectura perezosa: WebView2/Capacitor exponen la API tarde y los tests la instalan antes del render. */
function getWebSpeechAPI(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as SpeechWindow;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const LANG_MAP: Record<string, string> = { es: 'es-ES', en: 'en-US' };

function resolveLanguage(): string {
  return LANG_MAP[getLocale()] ?? 'en-US';
}

export interface UseSpeechRecognition {
  isListening: boolean;
  supported: boolean;
  start(onResult: (text: string) => void, onError?: (message: string) => void): Promise<void>;
  stop(): void;
}

export function useSpeechRecognition(): UseSpeechRecognition {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const currentTranscript = useRef('');
  const onResultRef = useRef<((text: string) => void) | null>(null);
  const onErrorRef = useRef<((message: string) => void) | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const cleanupListenersRef = useRef<(() => void) | null>(null);
  const manuallyStoppedRef = useRef(false);
  // Buffer de finales acumulados: sobrevive a pausas y reinicios. Solo crece.
  const finalBufferRef = useRef('');
  // Web: nº de finales ya volcados (por conteo, no por contenido).
  const committedFinalsRef = useRef(0);
  // Web: último interim visto; se consolida si la sesión muere en silencio.
  const pendingInterimRef = useRef('');
  // Nativo: longitud del buffer al empezar la utterance (solo se reescribe la cola).
  const utteranceBaseRef = useRef(0);
  const speechEndedRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isNative = Capacitor.isNativePlatform();
  const availableRef = useRef<boolean | null>(null);

  const emit = useCallback((text: string) => {
    currentTranscript.current = text;
    onResultRef.current?.(text);
  }, []);

  const detachNative = useCallback(() => {
    if (restartTimerRef.current !== null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    speechEndedRef.current = false;
    try {
      cleanupListenersRef.current?.();
    } catch {
      /* noop */
    }
    cleanupListenersRef.current = null;
  }, []);

  useEffect(() => {
    const language = resolveLanguage();
    if (isNative) {
      // Optimista: el botón se muestra siempre en nativo; si el servicio no está,
      // se avisa al tocar (nunca un botón oculto).
      setSupported(true);
      CapSpeechRecognition.available()
        .then(({ available }) => {
          availableRef.current = available;
          if (!available) setSupported(false);
        })
        .catch(() => {
          /* mantener optimista */
        });
      return () => {
        manuallyStoppedRef.current = true;
        detachNative();
        void CapSpeechRecognition.stop().catch(() => undefined);
      };
    }

    const WebSpeechAPI = getWebSpeechAPI();
    if (WebSpeechAPI === null) {
      setSupported(false);
      return undefined;
    }

    setSupported(true);
    const rec = new WebSpeechAPI();
    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      const results = event.results;
      const finals: string[] = [];
      let interim = '';
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal === true) finals.push(transcript);
        else if (transcript !== '') interim += (interim === '' ? '' : ' ') + transcript;
      }
      let buffer = finalBufferRef.current;
      for (let index = committedFinalsRef.current; index < finals.length; index += 1) {
        buffer = appendWebFinal(buffer, finals[index] ?? '');
      }
      committedFinalsRef.current = finals.length;
      finalBufferRef.current = buffer;
      pendingInterimRef.current = interim.trim();
      emit(combineDisplay(buffer, interim));
    };

    const flushAndRestart = (): void => {
      // La sesión murió (pausa larga): consolidar el interim pendiente antes de
      // reiniciar, o la última frase se pierde.
      const pending = pendingInterimRef.current;
      if (pending !== '') {
        const next = appendWebFinal(finalBufferRef.current, pending);
        if (next !== finalBufferRef.current) {
          finalBufferRef.current = next;
          emit(next);
        }
        pendingInterimRef.current = '';
      }
      committedFinalsRef.current = 0;
      try {
        rec.start();
      } catch {
        /* noop */
      }
    };

    rec.onend = () => {
      if (manuallyStoppedRef.current) {
        setIsListening(false);
        return;
      }
      flushAndRestart();
    };

    rec.onerror = (event) => {
      const code = event.error;
      if (code === 'no-speech' || code === 'aborted') {
        if (!manuallyStoppedRef.current) {
          try {
            rec.start();
          } catch {
            /* noop */
          }
        }
        return;
      }
      // Error fatal (permiso, red, servicio): no reintentar en bucle.
      manuallyStoppedRef.current = true;
      setIsListening(false);
      onErrorRef.current?.(code === '' ? 'unavailable' : code);
    };

    recognitionRef.current = rec;
    return () => {
      manuallyStoppedRef.current = true;
      try {
        rec.abort();
      } catch {
        /* noop */
      }
    };
  }, [isNative, emit, detachNative]);

  const start = useCallback(
    async (onResult: (text: string) => void, onError?: (message: string) => void): Promise<void> => {
      const language = resolveLanguage();
      manuallyStoppedRef.current = false;
      onResultRef.current = onResult;
      onErrorRef.current = onError ?? null;
      currentTranscript.current = '';
      finalBufferRef.current = '';
      committedFinalsRef.current = 0;
      pendingInterimRef.current = '';
      utteranceBaseRef.current = 0;
      speechEndedRef.current = false;

      if (isNative) {
        if (availableRef.current === false) {
          throw new Error('Speech service is not available on this device');
        }
        detachNative();
        try {
          const partialHandler: PluginListenerHandle = await CapSpeechRecognition.addListener(
            'partialResults',
            (data) => {
              const text = (data.matches?.[0] ?? '').trim();
              if (text === '') return;
              const previous = finalBufferRef.current;
              const wasEnded = speechEndedRef.current;
              const next = mergeNativePartial(previous, utteranceBaseRef.current, text);
              if (next !== previous) {
                finalBufferRef.current = next;
                emit(next);
              }
              // `onEndOfSpeech` ("stopped") llega antes del resultado final: la
              // base se cierra recién al llegar el final, para no duplicar.
              if (wasEnded) {
                speechEndedRef.current = false;
                utteranceBaseRef.current = finalBufferRef.current.length;
              }
            },
          );
          const stateHandler: PluginListenerHandle = await CapSpeechRecognition.addListener(
            'listeningState',
            (data) => {
              if (data.status === 'started') {
                setIsListening(true);
                return;
              }
              if (manuallyStoppedRef.current) {
                setIsListening(false);
                return;
              }
              speechEndedRef.current = true;
              if (restartTimerRef.current !== null) clearTimeout(restartTimerRef.current);
              restartTimerRef.current = setTimeout(() => {
                if (manuallyStoppedRef.current) return;
                if (speechEndedRef.current) {
                  speechEndedRef.current = false;
                  utteranceBaseRef.current = finalBufferRef.current.length;
                }
                void CapSpeechRecognition.start({
                  language,
                  partialResults: true,
                  popup: false,
                  maxResults: 5,
                }).catch((error: unknown) => {
                  manuallyStoppedRef.current = true;
                  setIsListening(false);
                  onErrorRef.current?.(error instanceof Error ? error.message : 'unavailable');
                });
              }, 400);
            },
          );
          cleanupListenersRef.current = () => {
            void partialHandler.remove();
            void stateHandler.remove();
          };

          const permission = await CapSpeechRecognition.requestPermissions();
          if (permission.speechRecognition !== 'granted') {
            detachNative();
            throw new Error('Microphone permission denied — enable it in system settings');
          }
          await CapSpeechRecognition.start({ language, partialResults: true, popup: false, maxResults: 5 });
          setIsListening(true);
          return;
        } catch (error) {
          detachNative();
          throw error;
        }
      }

      const rec = recognitionRef.current;
      if (rec === null) return;
      try {
        await navigator.mediaDevices?.getUserMedia?.({ audio: true });
      } catch {
        /* el reconocedor pedirá el permiso */
      }
      rec.lang = language;
      rec.start();
      setIsListening(true);
    },
    [isNative, detachNative, emit],
  );

  const stop = useCallback((): void => {
    manuallyStoppedRef.current = true;
    if (isNative) {
      detachNative();
      void CapSpeechRecognition.stop().catch(() => undefined);
      setIsListening(false);
      return;
    }
    const rec = recognitionRef.current;
    if (rec === null) return;
    try {
      rec.stop();
    } catch {
      /* noop */
    }
    setIsListening(false);
  }, [isNative, detachNative]);

  return { isListening, supported, start, stop };
}
