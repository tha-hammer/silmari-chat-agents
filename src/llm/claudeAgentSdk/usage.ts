import type {
  SDKResultMessage,
  ModelUsage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ResponseMetadata, UsageMetadata } from '@langchain/core/messages';

export interface ClaudeAgentSDKModelMetadata {
  canonical_model?: string;
  context_window: number;
  max_output_tokens: number;
}

export interface ClaudeAgentSDKUsageMetadata
  extends UsageMetadata,
    Partial<ClaudeAgentSDKModelMetadata> {}

export interface ClaudeAgentSDKResponseMetadata
  extends ResponseMetadata,
    Partial<ClaudeAgentSDKModelMetadata> {
  session_id: string;
  num_turns: number;
  total_cost_usd: number;
  model?: string;
}

export interface ClaudeAgentSDKMessageMetadata {
  usageMetadata?: ClaudeAgentSDKUsageMetadata;
  responseMetadata: ClaudeAgentSDKResponseMetadata;
}

interface ModelUsageCandidate {
  rawModel: string;
  usage: ModelUsage;
}

interface ModelUsageAnalysis {
  inputTokens: number;
  outputTokens: number;
  entryCount: number;
  soleCandidate?: ModelUsageCandidate;
  exactCandidate?: ModelUsageCandidate;
  canonicalCandidate?: ModelUsageCandidate;
  canonicalMatchCount: number;
}

function analyzeModelUsage(
  result: SDKResultMessage,
  preferredModel?: string
): ModelUsageAnalysis {
  let inputTokens = 0;
  let outputTokens = 0;
  let entryCount = 0;
  let soleCandidate: ModelUsageCandidate | undefined;
  let exactCandidate: ModelUsageCandidate | undefined;
  let canonicalCandidate: ModelUsageCandidate | undefined;
  let canonicalMatchCount = 0;

  for (const [rawModel, usage] of Object.entries(result.modelUsage)) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    entryCount += 1;

    const candidate = { rawModel, usage };
    if (entryCount === 1) {
      soleCandidate = candidate;
    }
    if (entryCount === 2) {
      soleCandidate = undefined;
    }

    if (preferredModel == null) {
      continue;
    }
    if (rawModel === preferredModel) {
      exactCandidate = candidate;
    }
    if (usage.canonicalModel === preferredModel) {
      canonicalCandidate = candidate;
      canonicalMatchCount += 1;
    }
  }

  return {
    inputTokens,
    outputTokens,
    entryCount,
    soleCandidate,
    exactCandidate,
    canonicalCandidate,
    canonicalMatchCount,
  };
}

function selectModelUsage(
  analysis: ModelUsageAnalysis
): ModelUsageCandidate | undefined {
  if (analysis.exactCandidate != null) {
    return analysis.exactCandidate;
  }
  if (
    analysis.canonicalMatchCount === 1 &&
    analysis.canonicalCandidate != null
  ) {
    return analysis.canonicalCandidate;
  }
  if (analysis.entryCount === 1) {
    return analysis.soleCandidate;
  }
  return undefined;
}

function modelMetadata(
  candidate: ModelUsageCandidate
): ClaudeAgentSDKModelMetadata {
  const { canonicalModel, contextWindow, maxOutputTokens } = candidate.usage;
  const limits = {
    context_window: contextWindow,
    max_output_tokens: maxOutputTokens,
  };
  if (canonicalModel == null) {
    return limits;
  }
  return { ...limits, canonical_model: canonicalModel };
}

function responseModelMetadata(
  candidate: ModelUsageCandidate
): ClaudeAgentSDKModelMetadata & { model: string } {
  return {
    ...modelMetadata(candidate),
    model: candidate.usage.canonicalModel ?? candidate.rawModel,
  };
}

export function resultMetadataFromResult(
  result: SDKResultMessage,
  preferredModel?: string
): ClaudeAgentSDKMessageMetadata {
  const responseMetadata: ClaudeAgentSDKResponseMetadata = {
    session_id: result.session_id,
    num_turns: result.num_turns,
    total_cost_usd: result.total_cost_usd,
  };
  const analysis = analyzeModelUsage(result, preferredModel);
  if (analysis.entryCount === 0) {
    return { responseMetadata };
  }

  const usageMetadata: ClaudeAgentSDKUsageMetadata = {
    input_tokens: analysis.inputTokens,
    output_tokens: analysis.outputTokens,
    total_tokens: analysis.inputTokens + analysis.outputTokens,
  };
  const selected = selectModelUsage(analysis);
  if (selected == null) {
    return { usageMetadata, responseMetadata };
  }

  return {
    usageMetadata: { ...usageMetadata, ...modelMetadata(selected) },
    responseMetadata: {
      ...responseMetadata,
      ...responseModelMetadata(selected),
    },
  };
}

export function usageMetadataFromResult(
  result: SDKResultMessage,
  preferredModel?: string
): ClaudeAgentSDKUsageMetadata | undefined {
  return resultMetadataFromResult(result, preferredModel).usageMetadata;
}

export function responseMetadataFromResult(
  result: SDKResultMessage,
  preferredModel?: string
): ClaudeAgentSDKResponseMetadata {
  return resultMetadataFromResult(result, preferredModel).responseMetadata;
}

function isModelMetadata(
  metadata: ClaudeAgentSDKUsageMetadata | undefined
): metadata is ClaudeAgentSDKUsageMetadata & ClaudeAgentSDKModelMetadata {
  return metadata?.context_window != null && metadata.max_output_tokens != null;
}

function modelMetadataFromUsage(
  left: UsageMetadata | undefined,
  right: UsageMetadata | undefined
): ClaudeAgentSDKModelMetadata | undefined {
  const rightMetadata: ClaudeAgentSDKUsageMetadata | undefined = right;
  if (isModelMetadata(rightMetadata)) {
    return modelMetadataFromFields(rightMetadata);
  }

  const leftMetadata: ClaudeAgentSDKUsageMetadata | undefined = left;
  if (isModelMetadata(leftMetadata)) {
    return modelMetadataFromFields(leftMetadata);
  }
  return undefined;
}

function modelMetadataFromFields(
  metadata: ClaudeAgentSDKModelMetadata
): ClaudeAgentSDKModelMetadata {
  const limits = {
    context_window: metadata.context_window,
    max_output_tokens: metadata.max_output_tokens,
  };
  if (metadata.canonical_model == null) {
    return limits;
  }
  return { ...limits, canonical_model: metadata.canonical_model };
}

export function preserveClaudeAgentSDKUsageMetadata(
  merged: UsageMetadata | undefined,
  left: UsageMetadata | undefined,
  right: UsageMetadata | undefined
): ClaudeAgentSDKUsageMetadata | undefined {
  if (merged == null) {
    return undefined;
  }
  const projection = modelMetadataFromUsage(left, right);
  if (projection == null) {
    return merged;
  }
  return { ...merged, ...projection };
}
