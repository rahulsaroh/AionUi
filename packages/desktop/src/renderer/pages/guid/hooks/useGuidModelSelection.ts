/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useGoogleAuthModels } from '@/renderer/hooks/agent/useGoogleAuthModels';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { hasAvailableModels } from '../utils/modelUtils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GUID_LAST_MODEL_STORAGE_KEY = 'aionui:guid-last-model';

function getStoredModelPreference(): { providerId: string; modelId: string } | null {
  try {
    const raw = localStorage.getItem(GUID_LAST_MODEL_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setStoredModelPreference(pref: { providerId: string; modelId: string } | null): void {
  try {
    if (pref) {
      localStorage.setItem(GUID_LAST_MODEL_STORAGE_KEY, JSON.stringify(pref));
    } else {
      localStorage.removeItem(GUID_LAST_MODEL_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Build a unique key for a provider/model pair.
 */
const buildModelKey = (providerId?: string, modelName?: string) => {
  if (!providerId || !modelName) return null;
  return `${providerId}:${modelName}`;
};

/**
 * Check if a model key still exists in the provider list.
 */
const isModelKeyAvailable = (key: string | null, providers?: IProvider[]) => {
  if (!key || !providers || providers.length === 0) return false;
  return providers.some((provider) => {
    if (!provider.id || !provider.models?.length) return false;
    return provider.models.some((modelName) => buildModelKey(provider.id, modelName) === key);
  });
};

/** Provider-based agent keys that share the model list UI */
type ProviderAgentKey = 'aionrs';

export type GuidModelSelectionResult = {
  modelList: IProvider[];
  isGoogleAuth: boolean;
  formatGeminiModelLabel: (provider: { platform?: string } | undefined, modelName?: string) => string;
  current_model: TProviderWithModel | undefined;
  setCurrentModel: (model_info: TProviderWithModel, options?: { persistPreference?: boolean }) => Promise<void>;
  resetCurrentModel: (options?: { persistPreference?: boolean }) => Promise<void>;
};

/**
 * Hook that manages the provider-backed model selection state for the Guid page.
 * Assistant-driven defaults are applied by the caller; this hook only owns the
 * transient in-page selection.
 * @param agentKey - current provider-based agent (currently only 'aionrs')
 */
export const useGuidModelSelection = (agentKey: ProviderAgentKey = 'aionrs'): GuidModelSelectionResult => {
  const { isGoogleAuth } = useGoogleAuthModels();
  const { providers } = useModelProviderList();

  const modelList = useMemo(() => {
    const allProviders: IProvider[] = (providers || []).filter((platform) => !!platform.models?.length);
    return allProviders.filter(hasAvailableModels);
  }, [providers]);

  const formatGeminiModelLabel = useCallback(
    (provider: { platform?: string; id?: string } | undefined, modelName?: string) => {
      if (!modelName) return '';
      if (provider?.id === 'aionui-native-gateway' || provider?.platform === 'custom') {
        if (modelName.includes(':')) {
          const [accName, mName] = modelName.split(':');
          return `${mName} (${accName})`;
        }
      }
      return modelName;
    },
    []
  );

  const [current_model, _setCurrentModel] = useState<TProviderWithModel>();
  const selectedModelKeyRef = useRef<string | null>(null);

  const setCurrentModel = useCallback(
    async (model_info: TProviderWithModel, options?: { persistPreference?: boolean }) => {
      selectedModelKeyRef.current = buildModelKey(model_info.id, model_info.use_model);
      _setCurrentModel(model_info);
      if (options?.persistPreference !== false && model_info.id && model_info.use_model) {
        setStoredModelPreference({ providerId: model_info.id, modelId: model_info.use_model });
      }
    },
    []
  );

  const resetCurrentModel = useCallback(
    async (options?: { persistPreference?: boolean }) => {
      if (!modelList || modelList.length === 0) {
        return;
      }

      // Check stored user preference first
      const storedPref = getStoredModelPreference();
      if (storedPref) {
        const storedKey = buildModelKey(storedPref.providerId, storedPref.modelId);
        if (isModelKeyAvailable(storedKey, modelList)) {
          const provider = modelList.find((p) => p.id === storedPref.providerId);
          if (provider) {
            await setCurrentModel(
              {
                ...provider,
                use_model: storedPref.modelId,
              },
              options
            );
            return;
          }
        }
      }

      selectedModelKeyRef.current = null;

      const defaultModel = modelList[0];
      const resolvedUseModel = defaultModel?.models[0] ?? '';

      if (!defaultModel || !resolvedUseModel) return;

      await setCurrentModel(
        {
          ...defaultModel,
          use_model: resolvedUseModel,
        },
        options
      );
    },
    [modelList, setCurrentModel]
  );

  // Set default model when modelList or agent changes
  useEffect(() => {
    const setDefaultModel = async () => {
      if (!modelList || modelList.length === 0) {
        return;
      }
      const currentKey = selectedModelKeyRef.current || buildModelKey(current_model?.id, current_model?.use_model);
      if (isModelKeyAvailable(currentKey, modelList)) {
        if (!selectedModelKeyRef.current && currentKey) {
          selectedModelKeyRef.current = currentKey;
        }
        return;
      }

      // If current key is not available, check stored preference before resetting to 0
      const storedPref = getStoredModelPreference();
      if (storedPref) {
        const storedKey = buildModelKey(storedPref.providerId, storedPref.modelId);
        if (isModelKeyAvailable(storedKey, modelList)) {
          const provider = modelList.find((p) => p.id === storedPref.providerId);
          if (provider) {
            await setCurrentModel({ ...provider, use_model: storedPref.modelId }, { persistPreference: true });
            return;
          }
        }
      }

      await resetCurrentModel();
    };

    setDefaultModel().catch((error) => {
      console.error('Failed to set default model:', error);
    });
  }, [agentKey, current_model?.id, current_model?.use_model, modelList, resetCurrentModel, setCurrentModel]);
  return {
    modelList,
    isGoogleAuth,
    formatGeminiModelLabel,
    current_model,
    setCurrentModel,
    resetCurrentModel,
  };
};
