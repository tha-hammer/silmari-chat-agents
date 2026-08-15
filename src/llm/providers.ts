// src/llm/providers.ts
import type {
  ChatModelConstructorMap,
  ProviderOptionsMap,
  ChatModelMap,
} from '@/types';
import {
  AzureChatOpenAI,
  ChatDeepSeek,
  ChatMoonshot,
  ChatOpenAI,
  ChatXAI,
} from '@/llm/openai';
import { ChatClaudeAgentSDK } from '@/llm/claudeAgentSdk/ChatClaudeAgentSDK';
import { CustomChatGoogleGenerativeAI } from '@/llm/google';
import { CustomChatBedrockConverse } from '@/llm/bedrock';
import { CustomChatMistralAI } from '@/llm/mistral';
import { CustomAnthropic } from '@/llm/anthropic';
import { ChatOpenRouter } from '@/llm/openrouter';
import { ChatVertexAI } from '@/llm/vertexai';
import { Providers } from '@/common';

export const llmProviders: Partial<ChatModelConstructorMap> = {
  [Providers.XAI]: ChatXAI,
  [Providers.OPENAI]: ChatOpenAI,
  [Providers.AZURE]: AzureChatOpenAI,
  [Providers.VERTEXAI]: ChatVertexAI,
  [Providers.DEEPSEEK]: ChatDeepSeek,
  [Providers.MISTRALAI]: CustomChatMistralAI,
  [Providers.MISTRAL]: CustomChatMistralAI,
  [Providers.ANTHROPIC]: CustomAnthropic,
  [Providers.OPENROUTER]: ChatOpenRouter,
  [Providers.BEDROCK]: CustomChatBedrockConverse,
  // [Providers.ANTHROPIC]: ChatAnthropic,
  [Providers.GOOGLE]: CustomChatGoogleGenerativeAI,
  [Providers.MOONSHOT]: ChatMoonshot,
  [Providers.CLAUDE_AGENT_SDK]: ChatClaudeAgentSDK,
};

// ChatClaudeAgentSDK never emits `tool_calls` (B10) — its streamed content has
// no tool-use chunks to reconcile, so it needs no entry here.
export const manualToolStreamProviders = new Set<Providers | string>([
  Providers.ANTHROPIC,
  Providers.BEDROCK,
]);

/**
 * Adds a provider to the registry without the root barrel naming it. Writing
 * the same constructor twice is a no-op so a module's registration side-effect
 * is safe to re-run; a different constructor is refused rather than clobbered.
 */
export function registerChatModel<P extends Providers>(
  provider: P,
  ctor: ChatModelConstructorMap[P]
): void {
  const existing = llmProviders[provider];
  if (existing === ctor) {
    return;
  }
  if (existing != null) {
    throw new Error(`Provider already registered: ${provider}`);
  }

  llmProviders[provider] = ctor;
}

/**
 * Test-only. Snapshots the registry and returns a function that restores it,
 * so registry tests can register, delete, and clobber freely without leaking
 * state into each other through the process-global map.
 */
export function __resetChatModelRegistry(): () => void {
  const snapshot = { ...llmProviders };

  return (): void => {
    for (const provider of Object.values(Providers)) {
      delete llmProviders[provider];
    }
    Object.assign(llmProviders, snapshot);
  };
}

export const getChatModelClass = <P extends Providers>(
  provider: P
): new (config: ProviderOptionsMap[P]) => ChatModelMap[P] => {
  const ChatModelClass = llmProviders[provider];
  if (!ChatModelClass) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  return ChatModelClass;
};
