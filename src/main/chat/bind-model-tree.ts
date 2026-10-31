import type { SandboxTree } from '#internal/llm/create-read-only-sandbox.ts';
import type {
  LanguageModel,
  ModelError,
  ModelOutput,
  ModelRequest,
  TextModelRequest,
} from '#internal/llm/language-model.ts';
import type { Result } from '#x/result/result.ts';

/**
 * `model` with every request reading `tree` (ADR 0087): the chat domain builds requests without
 * knowing where files come from, and an adapter whose tools read git objects gets them here.
 */
export function bindModelTree(model: LanguageModel, tree: SandboxTree): LanguageModel {
  return {
    capabilities: model.capabilities,
    run: async <T>(request: ModelRequest<T>): Promise<Result<ModelOutput<T>, ModelError>> => {
      return model.run({ ...request, tree });
    },
    runText: async (
      request: TextModelRequest,
    ): Promise<Result<ModelOutput<string>, ModelError>> => {
      return model.runText({ ...request, tree });
    },
  };
}
