import { create } from 'zustand';
import {
  addArtifactVersion,
  applyHtmlPatch,
  createHtmlArtifact,
  restoreArtifactVersion,
  type ApplyPatchResult,
  type ArtifactSource,
  type HtmlArtifact,
  type HtmlPatch,
} from '@/domain/visualReport/htmlArtifacts';

interface ArtifactState {
  artifacts: Record<string, HtmlArtifact>;
  latestHtml: string | null;
  getOrCreateArtifact: (messageId: string, initialHtml: string, title?: string) => HtmlArtifact;
  updateArtifactWithHtml: (
    messageId: string,
    newHtml: string,
    source: ArtifactSource,
    summary?: string,
  ) => HtmlArtifact;
  updateArtifactWithPatch: (
    messageId: string,
    patches: HtmlPatch[],
    summary?: string,
  ) => ApplyPatchResult;
  restoreVersion: (messageId: string, targetVersion: number) => void;
  getArtifact: (messageId: string) => HtmlArtifact | undefined;
  setLatestHtml: (html: string) => void;
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  artifacts: {},
  latestHtml: null,

  setLatestHtml: (html: string) => {
    set({ latestHtml: html });
  },

  getOrCreateArtifact: (messageId: string, initialHtml: string, title?: string) => {
    const existing = get().artifacts[messageId];
    if (existing) {
      return existing;
    }

    const newArtifact = createHtmlArtifact(`art-${messageId}`, messageId, initialHtml, title);
    set((state) => ({
      artifacts: {
        ...state.artifacts,
        [messageId]: newArtifact,
      },
      latestHtml: initialHtml,
    }));
    return newArtifact;
  },

  updateArtifactWithHtml: (
    messageId: string,
    newHtml: string,
    source: ArtifactSource,
    summary?: string,
  ) => {
    const current = get().getOrCreateArtifact(messageId, newHtml);
    const updated = addArtifactVersion(current, newHtml, source, summary);

    set((state) => ({
      artifacts: {
        ...state.artifacts,
        [messageId]: updated,
      },
      latestHtml: newHtml,
    }));

    return updated;
  },

  updateArtifactWithPatch: (messageId: string, patches: HtmlPatch[], summary?: string) => {
    const current = get().artifacts[messageId] ?? (get().latestHtml ? createHtmlArtifact(`art-${messageId}`, messageId, get().latestHtml!) : null);
    if (!current) {
      return {
        success: false,
        html: '',
        appliedCount: 0,
        errors: ['No se encontró ningún artefacto HTML para este mensaje'],
      };
    }

    const patchResult = applyHtmlPatch(current.activeHtml, patches);
    if (patchResult.success) {
      const updated = addArtifactVersion(
        current,
        patchResult.html,
        'agent-patch',
        summary ?? `Aplicados ${patchResult.appliedCount} cambios quirúrgicos`,
      );

      set((state) => ({
        artifacts: {
          ...state.artifacts,
          [messageId]: updated,
        },
        latestHtml: patchResult.html,
      }));
    }

    return patchResult;
  },

  restoreVersion: (messageId: string, targetVersion: number) => {
    const current = get().artifacts[messageId];
    if (!current) return;

    const restored = restoreArtifactVersion(current, targetVersion);
    set((state) => ({
      artifacts: {
        ...state.artifacts,
        [messageId]: restored,
      },
      latestHtml: restored.activeHtml,
    }));
  },

  getArtifact: (messageId: string) => {
    return get().artifacts[messageId];
  },
}));
